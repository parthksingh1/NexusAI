from __future__ import annotations

import asyncio
import time

import httpx
import structlog

from . import store
from .aggregate import summarize
from .config import settings
from .metrics import case_counter, pass_rate_gauge, run_counter, run_latency
from .schemas import CaseOut, CaseResult, RunSummary, SuiteOut, Target
from .scorers import score_case
from .target import execute, parse_target

log = structlog.get_logger()


async def _run_one(
    case: CaseOut,
    target: Target,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    run_id: str,
) -> CaseResult:
    async with semaphore:
        execution = await execute(target, case.input, client)

        if execution.error:
            # A target failure is a failed case, not a lost one — record it with whatever
            # partial output came back so the report shows what actually happened.
            result = CaseResult(
                caseKey=case.key,
                output=execution.output or None,
                passed=False,
                score=0.0,
                latencyMs=execution.latency_ms,
                costUsd=execution.cost_usd,
                scores=[],
                error=execution.error,
            )
        else:
            passed, score, details = await score_case(
                case.assertions,
                task=case.input,
                output=execution.output,
                expected=case.expected,
                latency_ms=execution.latency_ms,
                cost_usd=execution.cost_usd,
            )
            # A case with no assertions is a smoke test: it passes if it produced output.
            if not case.assertions:
                passed = bool(execution.output.strip())
                score = 1.0 if passed else 0.0
            result = CaseResult(
                caseKey=case.key,
                output=execution.output,
                passed=passed,
                score=round(score, 4),
                latencyMs=execution.latency_ms,
                costUsd=execution.cost_usd,
                scores=details,
                error=None,
            )

        # Persist per case rather than in one batch at the end, so a run that dies
        # halfway still has usable partial results.
        await store.save_result(run_id, case.id, result)
        return result


async def execute_run(
    run_id: str,
    suite: SuiteOut,
    target: Target,
    cases: list[CaseOut],
    concurrency: int | None = None,
) -> RunSummary:
    """Run every case against the target, score it, persist it, and summarize.
    Case weights scale their contribution to the run's mean score."""
    limit = concurrency or settings.eval_concurrency
    semaphore = asyncio.Semaphore(limit)
    started = time.perf_counter()

    timeout = httpx.Timeout(settings.agent_run_timeout_s + 30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        results = await asyncio.gather(
            *(_run_one(case, target, client, semaphore, run_id) for case in cases)
        )

    summary = summarize(list(results))

    # Re-derive the mean using case weights, which summarize() cannot see.
    total_weight = sum(c.weight for c in cases)
    if total_weight > 0:
        by_key = {c.key: c.weight for c in cases}
        weighted = sum(r.score * by_key.get(r.caseKey, 1.0) for r in results)
        summary.meanScore = round(weighted / total_weight, 4)

    await store.finish_run(run_id, "completed", summary, None)

    # Recorded here, once, rather than in the read path — GET /runs/{id} is polled.
    for r in results:
        case_counter.labels("errored" if r.error else ("passed" if r.passed else "failed")).inc()
    # Wall time, not the sum of case latencies — cases run concurrently.
    run_latency.observe((time.perf_counter() - started) * 1000)
    run_counter.labels("completed").inc()
    pass_rate_gauge.labels(suite.name).set(summary.passRate)

    log.info(
        "eval_run_completed",
        run_id=run_id,
        suite=suite.name,
        total=summary.total,
        passed=summary.passed,
        pass_rate=summary.passRate,
        cost_usd=summary.totalCostUsd,
    )
    return summary


async def start_run_task(
    run_id: str,
    suite: SuiteOut,
    target_raw: dict,
    case_keys: list[str] | None,
    concurrency: int | None,
) -> None:
    """Background entrypoint. Any failure marks the run failed instead of vanishing
    into an unobserved task exception."""
    try:
        target = parse_target(target_raw)
        cases = suite.cases
        if case_keys:
            wanted = set(case_keys)
            cases = [c for c in cases if c.key in wanted]
        if not cases:
            await store.finish_run(run_id, "failed", None, "no cases selected")
            run_counter.labels("failed").inc()
            return
        await execute_run(run_id, suite, target, cases, concurrency)
    except Exception as exc:
        log.error("eval_run_failed", run_id=run_id, error=str(exc))
        await store.finish_run(run_id, "failed", None, str(exc))
        run_counter.labels("failed").inc()
