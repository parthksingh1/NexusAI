from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from nexus_agents_shared import Plan, RunEvent, Task, TaskType, WorkerResult

from nexus_manager.workers import WORKERS
from nexus_manager.workers.base import BaseWorker


class StubWorker(BaseWorker):
    name = "stub"

    async def run(self, task, ctx):
        return WorkerResult(
            ok=True,
            output={"answer": f"answer for {task.id}", "summary": "a summary"},
            citations=[f"https://src/{task.id}"],
            tokens_used=25,
        )


def stub_plan(goal: str = "a goal") -> Plan:
    return Plan(
        goal=goal,
        reasoning="decomposed into one research task and a synthesis",
        tasks=[
            Task(id="t_res001", type=TaskType.RESEARCH, goal="research the question"),
            Task(id="t_syn001", type=TaskType.SYNTHESIZE, goal="merge the findings", depends_on=["t_res001"]),
        ],
        estimated_cost_usd=0.02,
    )


@pytest.fixture
def client(monkeypatch):
    """A client whose planner and workers are stubbed, so routing is what is under test."""
    for task_type in TaskType:
        monkeypatch.setitem(WORKERS, task_type, StubWorker)

    async def fake_plan(goal, provider=None, **kwargs):
        return stub_plan(goal), 0.0

    monkeypatch.setattr("nexus_manager.api.runs.make_plan", fake_plan)

    async def fake_providers(self):
        return {"ollama": True, "anthropic": False, "openai": False, "gemini": False}

    async def fake_models(self):
        return ["llama3:8b"]

    monkeypatch.setattr("nexus_manager.llm.router.LLMRouter.available_providers", fake_providers)
    monkeypatch.setattr("nexus_manager.llm.router.LLMRouter.ollama_models", fake_models)

    from nexus_manager.main import app

    with TestClient(app) as c:
        yield c


def wait_for_terminal(client, run_id: str, tries: int = 60) -> dict:
    for _ in range(tries):
        body = client.get(f"/runs/{run_id}").json()
        if body["status"] in {"done", "partial", "error"}:
            return body
        import time as _t

        _t.sleep(0.05)
    return client.get(f"/runs/{run_id}").json()


# ─── Health and readiness ───────────────────────────────────────


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_readyz_reports_available_providers(client):
    body = client.get("/readyz").json()
    assert body["status"] == "ready"
    assert body["providers"]["ollama"] is True


def test_metrics_exposes_manager_collectors(client):
    text = client.get("/metrics").text
    assert "nexus_manager_llm_latency_ms" in text
    assert "nexus_manager_runs_total" in text
    assert "nexus_manager_tool_calls_total" in text


def test_every_response_carries_a_request_id(client):
    assert client.get("/healthz").headers.get("x-request-id")


def test_a_supplied_request_id_is_echoed(client):
    resp = client.get("/healthz", headers={"x-request-id": "abc123"})
    assert resp.headers["x-request-id"] == "abc123"


# ─── Providers ──────────────────────────────────────────────────


def test_providers_lists_all_four_with_labels(client):
    body = client.get("/providers").json()
    assert {p["id"] for p in body} == {"ollama", "anthropic", "openai", "gemini"}
    labels = {p["id"]: p["label"] for p in body}
    assert labels["ollama"] == "Local (Ollama)"
    assert labels["anthropic"] == "Claude"


def test_providers_distinguishes_local_from_cloud(client):
    body = {p["id"]: p for p in client.get("/providers").json()}
    assert body["ollama"]["kind"] == "local"
    assert body["gemini"]["kind"] == "cloud"


def test_an_unavailable_provider_says_what_to_set(client):
    body = {p["id"]: p for p in client.get("/providers").json()}
    assert body["gemini"]["available"] is False
    assert "GOOGLE_API_KEY" in body["gemini"]["reason"]


def test_available_ollama_lists_its_models(client):
    body = {p["id"]: p for p in client.get("/providers").json()}
    assert body["ollama"]["models"] == ["llama3:8b"]


# ─── Starting a run ─────────────────────────────────────────────


def test_chat_returns_the_plan_with_the_run_id(client):
    resp = client.post("/chat", json={"goal": "compare vector databases on benchmarks"})
    assert resp.status_code == 202
    body = resp.json()
    assert body["run_id"].startswith("r_")
    assert len(body["plan"]["tasks"]) == 2
    assert body["plan"]["reasoning"]


def test_a_goal_that_is_too_short_is_rejected(client):
    assert client.post("/chat", json={"goal": "hi"}).status_code == 422


def test_an_unknown_provider_is_rejected(client):
    assert client.post("/chat", json={"goal": "a real goal here", "provider": "mistral"}).status_code == 422


def test_a_negative_budget_is_rejected(client):
    assert client.post("/chat", json={"goal": "a real goal here", "max_usd": -1}).status_code == 422


def test_a_run_completes_and_carries_an_answer(client):
    run_id = client.post("/chat", json={"goal": "a goal worth answering"}).json()["run_id"]
    body = wait_for_terminal(client, run_id)
    assert body["status"] == "done"
    assert body["answer"] == "answer for t_syn001"
    assert body["citations"] == ["https://src/t_syn001"]
    assert set(body["results"]) == {"t_res001", "t_syn001"}


def test_run_detail_reports_the_budget(client):
    run_id = client.post("/chat", json={"goal": "a goal worth answering"}).json()["run_id"]
    body = wait_for_terminal(client, run_id)
    assert body["budget"]["agents_spawned"] == 2
    assert body["budget"]["max_tokens"] > 0


def test_a_per_run_budget_override_is_applied(client):
    run_id = client.post("/chat", json={"goal": "a goal worth answering", "max_usd": 0.25}).json()["run_id"]
    body = wait_for_terminal(client, run_id)
    assert body["budget"]["max_usd"] == 0.25


def test_an_unknown_run_is_404(client):
    assert client.get("/runs/r_doesnotexist").status_code == 404


def test_runs_are_listed_newest_first(client):
    first = client.post("/chat", json={"goal": "the first goal here"}).json()["run_id"]
    second = client.post("/chat", json={"goal": "the second goal here"}).json()["run_id"]
    wait_for_terminal(client, first)
    wait_for_terminal(client, second)
    listed = [r["run_id"] for r in client.get("/runs").json()]
    assert listed.index(second) < listed.index(first)


# ─── Resume ─────────────────────────────────────────────────────


def test_resuming_an_unknown_run_is_404(client):
    assert client.post("/runs/r_missing/resume").status_code == 404


def test_a_finished_run_can_be_resumed_without_error(client):
    run_id = client.post("/chat", json={"goal": "a goal worth answering"}).json()["run_id"]
    wait_for_terminal(client, run_id)
    assert client.post(f"/runs/{run_id}/resume").status_code == 202


# ─── Streaming ──────────────────────────────────────────────────


def test_sse_streams_the_run_to_completion(client):
    run_id = client.post("/chat", json={"goal": "a goal worth answering"}).json()["run_id"]
    wait_for_terminal(client, run_id)

    with client.stream("GET", f"/runs/{run_id}/events") as stream:
        assert stream.headers["content-type"].startswith("text/event-stream")
        kinds = []
        for line in stream.iter_lines():
            if line.startswith("data: "):
                kinds.append(json.loads(line[6:])["kind"])
            if kinds and kinds[-1] == "done":
                break

    assert "plan" in kinds
    assert "worker_start" in kinds
    assert "worker_done" in kinds
    assert kinds[-1] == "done"


def test_sse_for_an_unknown_run_is_404(client):
    assert client.get("/runs/r_missing/events").status_code == 404


def test_websocket_delivers_the_same_events(client):
    run_id = client.post("/chat", json={"goal": "a goal worth answering"}).json()["run_id"]
    wait_for_terminal(client, run_id)

    with client.websocket_connect(f"/ws/runs/{run_id}") as socket:
        kinds = []
        for _ in range(50):
            message = socket.receive_json()
            kinds.append(message["kind"])
            if message["kind"] == "done":
                break

    assert "plan" in kinds
    assert kinds[-1] == "done"


def test_websocket_reports_an_unknown_run_rather_than_hanging(client):
    with client.websocket_connect("/ws/runs/r_missing") as socket:
        message = socket.receive_json()
        assert message["kind"] == "error"
        assert "not found" in message["payload"]["error"]


# ─── Event framing ──────────────────────────────────────────────


def test_events_serialise_as_unnamed_sse_frames():
    """Frames must stay unnamed.

    A frame carrying an `event:` line dispatches only to a matching addEventListener and
    never fires EventSource.onmessage. Naming frames after their kind silently delivered
    nothing to the web UI, which is how the live graph stopped updating.
    """
    event = RunEvent(run_id="r_1", kind="plan", payload={"a": 1})
    frame = event.to_sse()
    assert frame.startswith("data: ")
    assert "event:" not in frame
    assert frame.endswith("\n\n")
    body = json.loads(frame.split("data: ", 1)[1].strip())
    assert body["run_id"] == "r_1"
    assert body["kind"] == "plan"
