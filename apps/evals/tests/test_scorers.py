from __future__ import annotations

import pytest

from app.schemas import Assertion
from app.scorers import aggregate_case_score, apply_assertion, score_case


async def run(assertion: Assertion, output: str, expected: str | None = None, latency: int = 10, cost: float = 0.0):
    return await apply_assertion(
        assertion, task="t", output=output, expected=expected, latency_ms=latency, cost_usd=cost
    )


# ─── exact ──────────────────────────────────────────────────────


async def test_exact_ignores_case_and_whitespace_by_default():
    d = await run(Assertion(type="exact", value="Paris"), "  paris ")
    assert d.passed and d.score == 1.0


async def test_exact_respects_case_sensitivity_when_asked():
    d = await run(Assertion(type="exact", value="Paris", options={"caseSensitive": True}), "paris")
    assert not d.passed


async def test_exact_falls_back_to_case_expected():
    d = await run(Assertion(type="exact"), "42", expected="42")
    assert d.passed


async def test_exact_without_any_target_fails_cleanly():
    d = await run(Assertion(type="exact"), "42")
    assert not d.passed and "no expected value" in d.detail


# ─── contains ───────────────────────────────────────────────────


async def test_contains_gives_partial_credit_but_only_passes_on_all():
    d = await run(Assertion(type="contains", value=["alpha", "beta", "gamma"]), "alpha and beta only")
    assert not d.passed
    assert d.score == pytest.approx(2 / 3)
    assert "gamma" in d.detail


async def test_contains_passes_when_every_needle_present():
    d = await run(Assertion(type="contains", value=["alpha", "beta"]), "beta then alpha")
    assert d.passed and d.score == 1.0


async def test_not_contains_flags_forbidden_text():
    d = await run(Assertion(type="not_contains", value=["password", "secret"]), "here is the SECRET")
    assert not d.passed and "secret" in d.detail.lower()


# ─── regex ──────────────────────────────────────────────────────


async def test_regex_matches():
    d = await run(Assertion(type="regex", value=r"\d{4}-\d{2}-\d{2}"), "due on 2026-09-04")
    assert d.passed


async def test_invalid_regex_scores_zero_instead_of_raising():
    d = await run(Assertion(type="regex", value="([unclosed"), "anything")
    assert not d.passed and "invalid regex" in d.detail


# ─── json_path ──────────────────────────────────────────────────


async def test_json_path_reads_nested_list_index():
    a = Assertion(type="json_path", value="ok", options={"path": "items.1.status"})
    d = await run(a, '{"items": [{"status": "bad"}, {"status": "ok"}]}')
    assert d.passed


async def test_json_path_reports_missing_path():
    a = Assertion(type="json_path", options={"path": "a.b"})
    d = await run(a, '{"a": {}}')
    assert not d.passed and "not found" in d.detail


async def test_json_path_without_path_just_validates_json():
    assert (await run(Assertion(type="json_path"), '{"a":1}')).passed
    assert not (await run(Assertion(type="json_path"), "not json")).passed


# ─── numeric ────────────────────────────────────────────────────


async def test_numeric_extracts_number_from_prose_and_honours_tolerance():
    a = Assertion(type="numeric", value=3.14, options={"tolerance": 0.01})
    assert (await run(a, "The answer is about 3.142 units.")).passed


async def test_numeric_strips_thousands_separators():
    a = Assertion(type="numeric", value=1234567)
    assert (await run(a, "revenue was 1,234,567 dollars")).passed


async def test_numeric_fails_outside_tolerance():
    a = Assertion(type="numeric", value=100, options={"tolerance": 1})
    assert not (await run(a, "roughly 150")).passed


async def test_numeric_with_no_number_in_output():
    d = await run(Assertion(type="numeric", value=5), "no digits here")
    assert not d.passed and "no number" in d.detail


# ─── budgets ────────────────────────────────────────────────────


async def test_latency_budget_passes_under_budget():
    d = await run(Assertion(type="latency_budget", options={"maxMs": 1000}), "x", latency=800)
    assert d.passed and d.score == 1.0


async def test_latency_budget_degrades_linearly_then_bottoms_out():
    a = Assertion(type="latency_budget", options={"maxMs": 1000})
    near = await run(a, "x", latency=1500)
    blown = await run(a, "x", latency=5000)
    assert not near.passed and near.score == pytest.approx(0.5)
    assert blown.score == 0.0


async def test_cost_budget():
    a = Assertion(type="cost_budget", options={"maxUsd": 0.01})
    assert (await run(a, "x", cost=0.005)).passed
    assert not (await run(a, "x", cost=0.05)).passed


# ─── unknown / error handling ───────────────────────────────────


async def test_unknown_assertion_type_is_reported_not_raised():
    a = Assertion.model_construct(type="does_not_exist", value=None, options={}, weight=1.0, required=True)
    d = await apply_assertion(a, task="t", output="o", expected=None, latency_ms=1, cost_usd=0.0)
    assert not d.passed and "unknown assertion type" in d.detail


# ─── aggregation ────────────────────────────────────────────────


async def test_case_score_is_weighted_mean_of_assertions():
    _, score, details = await score_case(
        [
            Assertion(type="contains", value="alpha", weight=3.0),
            Assertion(type="contains", value="missing", weight=1.0),
        ],
        task="t",
        output="alpha",
        expected=None,
        latency_ms=1,
        cost_usd=0.0,
    )
    assert len(details) == 2
    assert score == pytest.approx(0.75)


async def test_optional_assertion_does_not_fail_the_case():
    passed, _, _ = await score_case(
        [
            Assertion(type="contains", value="alpha"),
            Assertion(type="contains", value="nope", required=False),
        ],
        task="t",
        output="alpha",
        expected=None,
        latency_ms=1,
        cost_usd=0.0,
    )
    assert passed


async def test_required_assertion_failure_fails_the_case():
    passed, _, _ = await score_case(
        [Assertion(type="contains", value="nope")],
        task="t",
        output="alpha",
        expected=None,
        latency_ms=1,
        cost_usd=0.0,
    )
    assert not passed


def test_case_with_no_assertions_aggregates_as_pass():
    assert aggregate_case_score([]) == (True, 1.0)
