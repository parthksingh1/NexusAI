from __future__ import annotations

from ..schemas import Assertion, ScoreDetail
from . import deterministic as det
from .llm_judge import score_llm_judge
from .semantic import score_embedding_similarity

__all__ = ["apply_assertion", "score_case", "aggregate_case_score"]

# Assertions that only need the output text (plus the case's expected value).
_TEXT_SCORERS = {
    "exact": det.score_exact,
    "contains": det.score_contains,
    "not_contains": det.score_not_contains,
    "regex": det.score_regex,
    "json_path": det.score_json_path,
    "numeric": det.score_numeric,
}


async def apply_assertion(
    assertion: Assertion,
    *,
    task: str,
    output: str,
    expected: str | None,
    latency_ms: int,
    cost_usd: float,
) -> ScoreDetail:
    """Run one assertion. Never raises — a broken assertion scores zero with the reason attached,
    so one bad check cannot take down an entire eval run."""
    try:
        if assertion.type in _TEXT_SCORERS:
            return _TEXT_SCORERS[assertion.type](assertion, output, expected)
        if assertion.type == "latency_budget":
            return det.score_latency_budget(assertion, latency_ms)
        if assertion.type == "cost_budget":
            return det.score_cost_budget(assertion, cost_usd)
        if assertion.type == "embedding_similarity":
            return await score_embedding_similarity(assertion, output, expected)
        if assertion.type == "llm_judge":
            return await score_llm_judge(assertion, task, output, expected)
    except Exception as exc:
        return ScoreDetail(
            type=assertion.type, passed=False, score=0.0, weight=assertion.weight,
            required=assertion.required, detail=f"scorer error: {exc}",
        )
    return ScoreDetail(
        type=assertion.type, passed=False, score=0.0, weight=assertion.weight,
        required=assertion.required, detail=f"unknown assertion type {assertion.type!r}",
    )


def aggregate_case_score(scores: list[ScoreDetail]) -> tuple[bool, float]:
    """Case score is the weight-weighted mean of its assertion scores; a case passes only when
    every *required* assertion passes. A case with no assertions is a smoke test — it passes
    if it produced any output at all, which the caller decides."""
    if not scores:
        return True, 1.0
    total_weight = sum(s.weight for s in scores)
    mean = sum(s.score * s.weight for s in scores) / total_weight if total_weight else 0.0
    passed = all(s.passed for s in scores if s.required)
    return passed, max(0.0, min(1.0, mean))


async def score_case(
    assertions: list[Assertion],
    *,
    task: str,
    output: str,
    expected: str | None,
    latency_ms: int,
    cost_usd: float,
) -> tuple[bool, float, list[ScoreDetail]]:
    details: list[ScoreDetail] = []
    for a in assertions:
        details.append(
            await apply_assertion(
                a, task=task, output=output, expected=expected, latency_ms=latency_ms, cost_usd=cost_usd
            )
        )
    passed, score = aggregate_case_score(details)
    return passed, score, details
