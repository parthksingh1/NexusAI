from __future__ import annotations

import math
from collections import defaultdict

from .schemas import CaseDelta, CaseResult, CompareResult, RunSummary


def percentile(values: list[int], pct: float) -> int:
    """Nearest-rank percentile. Eval runs are small (tens of cases), so interpolation
    would imply precision the sample size doesn't support."""
    if not values:
        return 0
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100.0 * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


def summarize(results: list[CaseResult]) -> RunSummary:
    total = len(results)
    errored = sum(1 for r in results if r.error)
    passed = sum(1 for r in results if r.passed)
    latencies = [r.latencyMs for r in results]

    by_assertion: dict[str, dict[str, float]] = {}
    buckets: dict[str, list[tuple[bool, float]]] = defaultdict(list)
    for r in results:
        for s in r.scores:
            buckets[s.type].append((s.passed, s.score))
    for name, entries in buckets.items():
        n = len(entries)
        by_assertion[name] = {
            "count": float(n),
            "passRate": round(sum(1 for p, _ in entries if p) / n, 4),
            "meanScore": round(sum(sc for _, sc in entries) / n, 4),
        }

    return RunSummary(
        total=total,
        passed=passed,
        failed=total - passed,
        errored=errored,
        passRate=round(passed / total, 4) if total else 0.0,
        meanScore=round(sum(r.score for r in results) / total, 4) if total else 0.0,
        p50LatencyMs=percentile(latencies, 50),
        p95LatencyMs=percentile(latencies, 95),
        totalCostUsd=round(sum(r.costUsd for r in results), 6),
        byAssertion=by_assertion,
    )


def compare(
    baseline_id: str,
    candidate_id: str,
    baseline: list[CaseResult],
    candidate: list[CaseResult],
    *,
    min_pass_rate_delta: float | None = None,
    max_regressions: int = 0,
    max_cost_increase: float | None = None,
) -> CompareResult:
    """Diff two runs case-by-case and decide whether the candidate is safe to ship.

    The gate is deliberately conservative: any case that got worse counts as a regression,
    even if the aggregate pass rate improved, because averages hide the case you broke.
    """
    b_by_key = {r.caseKey: r for r in baseline}
    c_by_key = {r.caseKey: r for r in candidate}

    deltas: list[CaseDelta] = []
    for key in sorted(set(b_by_key) | set(c_by_key)):
        b, c = b_by_key.get(key), c_by_key.get(key)
        if b is None:
            deltas.append(CaseDelta(caseKey=key, baselineScore=None, candidateScore=c.score, scoreDelta=0.0, verdict="added"))
            continue
        if c is None:
            deltas.append(CaseDelta(caseKey=key, baselineScore=b.score, candidateScore=None, scoreDelta=0.0, verdict="removed"))
            continue
        delta = round(c.score - b.score, 4)
        if b.passed and not c.passed:
            verdict = "regressed"
        elif not b.passed and c.passed:
            verdict = "fixed"
        elif delta < -1e-9:
            verdict = "regressed"
        elif delta > 1e-9:
            verdict = "fixed"
        else:
            verdict = "unchanged"
        deltas.append(CaseDelta(caseKey=key, baselineScore=b.score, candidateScore=c.score, scoreDelta=delta, verdict=verdict))

    b_sum, c_sum = summarize(baseline), summarize(candidate)
    regressions = [d for d in deltas if d.verdict == "regressed"]
    fixes = [d for d in deltas if d.verdict == "fixed"]
    cost_delta = round(c_sum.totalCostUsd - b_sum.totalCostUsd, 6)
    pass_rate_delta = round(c_sum.passRate - b_sum.passRate, 4)

    reasons: list[str] = []
    if len(regressions) > max_regressions:
        reasons.append(f"{len(regressions)} regressed case(s), limit {max_regressions}: {[d.caseKey for d in regressions][:10]}")
    if min_pass_rate_delta is not None and pass_rate_delta < min_pass_rate_delta:
        reasons.append(f"pass rate moved {pass_rate_delta:+.4f}, minimum {min_pass_rate_delta:+.4f}")
    if max_cost_increase is not None and cost_delta > max_cost_increase:
        reasons.append(f"cost rose ${cost_delta:.6f}, limit ${max_cost_increase:.6f}")
    removed = [d.caseKey for d in deltas if d.verdict == "removed"]
    if removed:
        reasons.append(f"cases missing from candidate run: {removed[:10]}")

    return CompareResult(
        baselineRunId=baseline_id,
        candidateRunId=candidate_id,
        passRateDelta=pass_rate_delta,
        meanScoreDelta=round(c_sum.meanScore - b_sum.meanScore, 4),
        costDelta=cost_delta,
        p95LatencyDelta=c_sum.p95LatencyMs - b_sum.p95LatencyMs,
        regressions=regressions,
        fixes=fixes,
        unchanged=sum(1 for d in deltas if d.verdict == "unchanged"),
        gatePassed=not reasons,
        gateReasons=reasons,
    )
