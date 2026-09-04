"""End-to-end coverage of the store, runner and HTTP surface against a real Postgres.

Skipped automatically when EVALS_TEST_DATABASE_URL is unset, so the unit suite still
runs in environments without a database.
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("EVALS_TEST_DATABASE_URL"),
    reason="EVALS_TEST_DATABASE_URL not set — skipping database-backed tests",
)

os.environ.setdefault("DATABASE_URL", os.getenv("EVALS_TEST_DATABASE_URL", ""))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def owner() -> str:
    return f"test-owner-{uuid.uuid4().hex[:8]}"


def _suite_body(owner: str, name: str = "smoke") -> dict:
    return {
        "ownerId": owner,
        "name": name,
        "description": "e2e suite",
        "target": {"type": "echo"},
        "cases": [
            {
                "key": "capital",
                "input": "The capital of France is Paris.",
                "assertions": [{"type": "contains", "value": "Paris"}],
            },
            {
                "key": "arithmetic",
                "input": "The result is 42",
                "assertions": [{"type": "numeric", "value": 42}],
            },
            {
                "key": "should-fail",
                "input": "nothing useful here",
                "assertions": [{"type": "contains", "value": "unicorn"}],
            },
        ],
    }


# Note on schema idempotency: entering the app runs init_schema, so every test in this
# module depends on it. Re-running this file against the same database exercises the
# "tables already exist" path — which is the only way that path can honestly be tested,
# since a second TestClient would dispose the connection pool this one is using.


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_metrics_exposes_prometheus_text(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "nexus_evals_runs_total" in resp.text


def test_suite_crud_roundtrip(client, owner):
    created = client.post("/suites", json=_suite_body(owner))
    assert created.status_code == 201, created.text
    suite = created.json()
    assert len(suite["cases"]) == 3
    assert [c["key"] for c in suite["cases"]] == ["capital", "arithmetic", "should-fail"]
    # Assertions survive the jsonb roundtrip.
    assert suite["cases"][0]["assertions"][0]["type"] == "contains"

    fetched = client.get(f"/suites/{suite['id']}").json()
    assert fetched == suite

    listed = client.get("/suites", params={"ownerId": owner}).json()
    assert len(listed) == 1 and listed[0]["caseCount"] == 3

    assert client.delete(f"/suites/{suite['id']}").status_code == 204
    assert client.get(f"/suites/{suite['id']}").status_code == 404


def test_creating_a_suite_twice_updates_it_rather_than_duplicating(client, owner):
    first = client.post("/suites", json=_suite_body(owner)).json()
    body = _suite_body(owner)
    body["description"] = "updated"
    second = client.post("/suites", json=body).json()
    assert first["id"] == second["id"]
    assert second["description"] == "updated"
    assert len(client.get("/suites", params={"ownerId": owner}).json()) == 1


def test_duplicate_case_keys_are_rejected(client, owner):
    body = _suite_body(owner)
    body["cases"].append(dict(body["cases"][0]))
    resp = client.post("/suites", json=body)
    assert resp.status_code == 400
    assert "duplicate case keys" in resp.json()["detail"]


def test_replacing_cases_swaps_the_whole_set(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()
    resp = client.put(
        f"/suites/{suite['id']}/cases",
        json=[{"key": "only", "input": "hi", "assertions": []}],
    )
    assert resp.status_code == 200
    assert [c["key"] for c in resp.json()["cases"]] == ["only"]


def test_run_against_echo_target_scores_and_persists(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()

    started = client.post(f"/suites/{suite['id']}/runs", json={"label": "baseline"})
    assert started.status_code == 202
    run_id = started.json()["runId"]

    # TestClient runs BackgroundTasks synchronously before returning, so the run is done.
    run = client.get(f"/runs/{run_id}").json()
    assert run["status"] == "completed"
    assert run["summary"]["total"] == 3
    assert run["summary"]["passed"] == 2
    assert run["summary"]["failed"] == 1
    assert run["summary"]["passRate"] == pytest.approx(0.6667, abs=1e-3)

    by_key = {r["caseKey"]: r for r in run["results"]}
    assert by_key["capital"]["passed"] is True
    assert by_key["should-fail"]["passed"] is False
    assert by_key["should-fail"]["scores"][0]["type"] == "contains"
    # The echo target hands the input straight back.
    assert by_key["capital"]["output"] == "The capital of France is Paris."


def test_run_can_be_restricted_to_selected_cases(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()
    run_id = client.post(
        f"/suites/{suite['id']}/runs", json={"caseKeys": ["capital"]}
    ).json()["runId"]
    run = client.get(f"/runs/{run_id}").json()
    assert run["summary"]["total"] == 1
    assert run["results"][0]["caseKey"] == "capital"


def test_unknown_case_key_is_rejected(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()
    resp = client.post(f"/suites/{suite['id']}/runs", json={"caseKeys": ["nope"]})
    assert resp.status_code == 400


def test_compare_two_runs_and_gate(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()
    baseline = client.post(f"/suites/{suite['id']}/runs", json={"label": "base"}).json()["runId"]

    # Break a previously-passing case, then re-run: the gate must catch it.
    client.put(
        f"/suites/{suite['id']}/cases",
        json=[
            {"key": "capital", "input": "nothing", "assertions": [{"type": "contains", "value": "Paris"}]},
            {"key": "arithmetic", "input": "The result is 42", "assertions": [{"type": "numeric", "value": 42}]},
            {"key": "should-fail", "input": "nothing useful", "assertions": [{"type": "contains", "value": "unicorn"}]},
        ],
    )
    candidate = client.post(f"/suites/{suite['id']}/runs", json={"label": "cand"}).json()["runId"]

    cmp = client.get(f"/runs/{candidate}/compare", params={"baseline": baseline}).json()
    assert cmp["gatePassed"] is False
    assert [r["caseKey"] for r in cmp["regressions"]] == ["capital"]
    assert cmp["passRateDelta"] < 0

    # Comparing a run to itself is always clean.
    same = client.get(f"/runs/{baseline}/compare", params={"baseline": baseline}).json()
    assert same["gatePassed"] is True and same["unchanged"] == 3


def test_compare_with_unknown_run_is_404(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()
    run_id = client.post(f"/suites/{suite['id']}/runs", json={}).json()["runId"]
    missing = str(uuid.uuid4())
    assert client.get(f"/runs/{run_id}/compare", params={"baseline": missing}).status_code == 404


def test_run_history_is_listed_newest_first(client, owner):
    suite = client.post("/suites", json=_suite_body(owner)).json()
    client.post(f"/suites/{suite['id']}/runs", json={"label": "one"})
    client.post(f"/suites/{suite['id']}/runs", json={"label": "two"})
    runs = client.get(f"/suites/{suite['id']}/runs").json()
    assert len(runs) == 2
    assert runs[0]["label"] == "two"
    assert all(r["summary"]["total"] == 3 for r in runs)


def test_http_target_failure_is_recorded_as_a_failed_case(client, owner):
    body = _suite_body(owner, name="http-suite")
    # Port 9 is the discard port — nothing listens, so the target reliably fails.
    body["target"] = {"type": "http", "url": "http://127.0.0.1:9/nope"}
    body["cases"] = [{"key": "unreachable", "input": "hello", "assertions": []}]
    suite = client.post("/suites", json=body).json()

    run_id = client.post(f"/suites/{suite['id']}/runs", json={}).json()["runId"]
    run = client.get(f"/runs/{run_id}").json()
    assert run["status"] == "completed"
    assert run["summary"]["errored"] == 1
    assert run["results"][0]["passed"] is False
    assert run["results"][0]["error"]


def _case_metric_total(client) -> float:
    """Sum the nexus_evals_cases_total counter across all outcome labels."""
    total = 0.0
    for line in client.get("/metrics").text.splitlines():
        if line.startswith("nexus_evals_cases_total{"):
            total += float(line.rsplit(" ", 1)[1])
    return total


def test_polling_a_run_does_not_inflate_case_metrics(client, owner):
    """GET /runs/{id} is a poll endpoint — it must not re-count cases on every call."""
    suite = client.post("/suites", json=_suite_body(owner, name="metrics-suite")).json()
    run_id = client.post(f"/suites/{suite['id']}/runs", json={}).json()["runId"]

    after_run = _case_metric_total(client)
    for _ in range(5):
        client.get(f"/runs/{run_id}")
    assert _case_metric_total(client) == after_run
