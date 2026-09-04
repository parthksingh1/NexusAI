from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.responses import PlainTextResponse

from . import store
from .aggregate import compare
from .config import settings
from .db import engine, init_schema
from .metrics import run_counter
from .runner import start_run_task
from .schemas import (
    CaseInput,
    CompareResult,
    RunOut,
    RunRequest,
    RunSummary,
    RunSummaryOut,
    SuiteCreate,
    SuiteOut,
    SuiteSummary,
)

logging.basicConfig(level=settings.log_level)
structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
log = structlog.get_logger()

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await init_schema()
    log.info("evals_started", port=settings.evals_port)
    yield
    # Close the connection pool on shutdown. Pooled asyncpg connections are bound to the
    # loop that opened them, so leaking them past shutdown breaks any later loop that
    # picks them up.
    await engine.dispose()
    log.info("evals_stopped")


app = FastAPI(title="NexusAI Evals", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest().decode(), media_type=CONTENT_TYPE_LATEST)


# ─── Suites ─────────────────────────────────────────────────────


@app.post("/suites", response_model=SuiteOut, status_code=201)
async def create_suite(payload: SuiteCreate) -> SuiteOut:
    keys = [c.key for c in payload.cases]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        raise HTTPException(status_code=400, detail=f"duplicate case keys: {sorted(duplicates)}")
    return await store.create_suite(payload)


@app.get("/suites", response_model=list[SuiteSummary])
async def list_suites(ownerId: str | None = None) -> list[SuiteSummary]:
    return await store.list_suites(ownerId)


@app.get("/suites/{suite_id}", response_model=SuiteOut)
async def get_suite(suite_id: str) -> SuiteOut:
    suite = await store.get_suite(suite_id)
    if suite is None:
        raise HTTPException(status_code=404, detail="suite not found")
    return suite


@app.put("/suites/{suite_id}/cases", response_model=SuiteOut)
async def put_cases(suite_id: str, cases: list[CaseInput]) -> SuiteOut:
    keys = [c.key for c in cases]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        raise HTTPException(status_code=400, detail=f"duplicate case keys: {sorted(duplicates)}")
    suite = await store.replace_cases(suite_id, cases)
    if suite is None:
        raise HTTPException(status_code=404, detail="suite not found")
    return suite


@app.delete("/suites/{suite_id}", status_code=204)
async def delete_suite(suite_id: str) -> None:
    if not await store.delete_suite(suite_id):
        raise HTTPException(status_code=404, detail="suite not found")


# ─── Runs ───────────────────────────────────────────────────────


@app.post("/suites/{suite_id}/runs", status_code=202)
async def start_run(suite_id: str, req: RunRequest, background: BackgroundTasks) -> dict[str, str]:
    """Kick off an eval run. Returns immediately — poll GET /runs/{id} for progress,
    which mirrors how the orchestrator's own run API behaves."""
    suite = await store.get_suite(suite_id)
    if suite is None:
        raise HTTPException(status_code=404, detail="suite not found")

    target_raw: dict[str, Any] = req.target.model_dump() if req.target else (suite.target or {"type": "echo"})
    if req.caseKeys:
        known = {c.key for c in suite.cases}
        unknown = [k for k in req.caseKeys if k not in known]
        if unknown:
            raise HTTPException(status_code=400, detail=f"unknown case keys: {unknown}")

    run_id = await store.create_run(suite_id, target_raw, req.label, req.baselineRunId)
    run_counter.labels("started").inc()
    background.add_task(start_run_task, run_id, suite, target_raw, req.caseKeys, req.concurrency)
    return {"runId": run_id, "status": "running"}


def _summary_from_row(raw: Any) -> RunSummary | None:
    data = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    if not data:
        return None
    try:
        return RunSummary(**data)
    except (TypeError, ValueError):
        return None


@app.get("/runs/{run_id}", response_model=RunOut)
async def get_run(run_id: str) -> RunOut:
    row = await store.get_run_row(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="run not found")
    results = await store.get_run_results(run_id)
    summary = _summary_from_row(row[6])

    target = json.loads(row[4]) if isinstance(row[4], (str, bytes)) else (row[4] or {})
    return RunOut(
        id=str(row[0]),
        suiteId=str(row[1]),
        status=row[2],
        label=row[3],
        target=target,
        baselineRunId=str(row[5]) if row[5] else None,
        summary=summary,
        results=results,
        error=row[7],
        startedAt=row[8].isoformat(),
        finishedAt=row[9].isoformat() if row[9] else None,
    )


@app.get("/suites/{suite_id}/runs", response_model=list[RunSummaryOut])
async def list_runs(suite_id: str, limit: int = Query(default=20, ge=1, le=200)) -> list[RunSummaryOut]:
    rows = await store.list_runs(suite_id, limit)
    return [
        RunSummaryOut(
            id=str(r[0]),
            suiteId=str(r[1]),
            status=r[2],
            label=r[3],
            summary=_summary_from_row(r[4]),
            startedAt=r[5].isoformat(),
            finishedAt=r[6].isoformat() if r[6] else None,
        )
        for r in rows
    ]


# ─── Regression gate ────────────────────────────────────────────


@app.get("/runs/{run_id}/compare", response_model=CompareResult)
async def compare_runs(
    run_id: str,
    baseline: str = Query(description="Run id to compare against"),
    minPassRateDelta: float | None = Query(
        default=None, description="Optional extra gate: fail if the pass-rate delta falls below this"
    ),
    maxRegressions: int = Query(default=0, ge=0, description="How many regressed cases are tolerable"),
    maxCostIncrease: float | None = Query(default=None, description="Fail the gate if total cost rises by more than this"),
) -> CompareResult:
    """Diff a candidate run against a baseline and return a ship/no-ship verdict.
    This is the CI hook: a non-zero `gateReasons` list means block the change."""
    for rid in (run_id, baseline):
        if await store.get_run_row(rid) is None:
            raise HTTPException(status_code=404, detail=f"run {rid} not found")

    baseline_results = await store.get_run_results(baseline)
    candidate_results = await store.get_run_results(run_id)
    if not baseline_results:
        raise HTTPException(status_code=400, detail=f"baseline run {baseline} has no results")

    result = compare(
        baseline,
        run_id,
        baseline_results,
        candidate_results,
        min_pass_rate_delta=minPassRateDelta,
        max_regressions=maxRegressions,
        max_cost_increase=maxCostIncrease,
    )
    return result
