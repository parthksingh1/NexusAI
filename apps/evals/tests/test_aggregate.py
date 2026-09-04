from __future__ import annotations

import pytest

from app.aggregate import compare, percentile, summarize
from app.schemas import CaseResult, ScoreDetail


def result(key: str, *, passed: bool, score: float, latency: int = 100, cost: float = 0.001, types=("exact",), error=None):
    return CaseResult(
        caseKey=key,
        output="out",
        passed=passed,
        score=score,
        latencyMs=latency,
        costUsd=cost,
        scores=[
            ScoreDetail(type=t, passed=passed, score=score, weight=1.0, required=True, detail="") for t in types
        ],
        error=error,
    )


# ─── percentile ─────────────────────────────────────────────────


def test_percentile_of_empty_is_zero():
    assert percentile([], 95) == 0


def test_percentile_uses_nearest_rank():
    values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    assert percentile(values, 50) == 50
    assert percentile(values, 95) == 100
    assert percentile(values, 100) == 100


def test_percentile_of_single_value():
    assert percentile([42], 95) == 42


# ─── summarize ──────────────────────────────────────────────────


def test_summarize_counts_and_rates():
    s = summarize([
        result("a", passed=True, score=1.0, latency=100),
        result("b", passed=False, score=0.0, latency=300),
        result("c", passed=True, score=0.5, latency=200),
    ])
    assert s.total == 3
    assert s.passed == 2
    assert s.failed == 1
    assert s.passRate == pytest.approx(0.6667, abs=1e-4)
    assert s.meanScore == pytest.approx(0.5)
    assert s.totalCostUsd == pytest.approx(0.003)


def test_summarize_counts_errored_cases_separately_from_failed():
    s = summarize([
        result("a", passed=True, score=1.0),
        result("b", passed=False, score=0.0, error="target timed out"),
    ])
    assert s.errored == 1
    assert s.failed == 1


def test_summarize_of_empty_run_does_not_divide_by_zero():
    s = summarize([])
    assert s.total == 0 and s.passRate == 0.0 and s.meanScore == 0.0


def test_summarize_breaks_down_by_assertion_type():
    s = summarize([
        result("a", passed=True, score=1.0, types=("exact", "llm_judge")),
        result("b", passed=False, score=0.0, types=("exact",)),
    ])
    assert s.byAssertion["exact"]["count"] == 2
    assert s.byAssertion["exact"]["passRate"] == pytest.approx(0.5)
    assert s.byAssertion["llm_judge"]["count"] == 1


# ─── compare / regression gate ──────────────────────────────────


def test_gate_passes_when_nothing_regressed():
    baseline = [result("a", passed=True, score=1.0), result("b", passed=False, score=0.0)]
    candidate = [result("a", passed=True, score=1.0), result("b", passed=True, score=1.0)]
    c = compare("base", "cand", baseline, candidate)
    assert c.gatePassed
    assert [d.caseKey for d in c.fixes] == ["b"]
    assert c.passRateDelta == pytest.approx(0.5)


def test_gate_blocks_on_a_single_regression_even_if_pass_rate_improves():
    # 'a' broke, but 'b' and 'c' got fixed — the average improves while a real case broke.
    baseline = [
        result("a", passed=True, score=1.0),
        result("b", passed=False, score=0.0),
        result("c", passed=False, score=0.0),
    ]
    candidate = [
        result("a", passed=False, score=0.0),
        result("b", passed=True, score=1.0),
        result("c", passed=True, score=1.0),
    ]
    c = compare("base", "cand", baseline, candidate)
    assert c.passRateDelta > 0
    assert not c.gatePassed
    assert [d.caseKey for d in c.regressions] == ["a"]


def test_gate_tolerates_regressions_up_to_the_configured_limit():
    baseline = [result("a", passed=True, score=1.0)]
    candidate = [result("a", passed=False, score=0.0)]
    assert not compare("b", "c", baseline, candidate).gatePassed
    assert compare("b", "c", baseline, candidate, max_regressions=1).gatePassed


def test_score_drop_without_a_pass_flip_still_counts_as_regression():
    baseline = [result("a", passed=True, score=1.0)]
    candidate = [result("a", passed=True, score=0.8)]
    c = compare("b", "c", baseline, candidate)
    assert c.regressions[0].scoreDelta == pytest.approx(-0.2)
    assert not c.gatePassed


def test_missing_case_in_candidate_blocks_the_gate():
    baseline = [result("a", passed=True, score=1.0), result("b", passed=True, score=1.0)]
    candidate = [result("a", passed=True, score=1.0)]
    c = compare("base", "cand", baseline, candidate)
    assert not c.gatePassed
    assert any("missing from candidate" in r for r in c.gateReasons)


def test_new_case_is_added_not_regressed():
    baseline = [result("a", passed=True, score=1.0)]
    candidate = [result("a", passed=True, score=1.0), result("new", passed=False, score=0.0)]
    c = compare("base", "cand", baseline, candidate)
    assert not c.regressions
    assert c.gatePassed


def test_cost_ceiling_blocks_an_otherwise_clean_candidate():
    baseline = [result("a", passed=True, score=1.0, cost=0.001)]
    candidate = [result("a", passed=True, score=1.0, cost=0.050)]
    clean = compare("b", "c", baseline, candidate)
    gated = compare("b", "c", baseline, candidate, max_cost_increase=0.01)
    assert clean.gatePassed
    assert not gated.gatePassed
    assert gated.costDelta == pytest.approx(0.049)


def test_unchanged_cases_are_counted():
    baseline = [result("a", passed=True, score=1.0), result("b", passed=True, score=1.0)]
    c = compare("base", "cand", baseline, list(baseline))
    assert c.unchanged == 2
    assert c.gatePassed and c.meanScoreDelta == 0.0
