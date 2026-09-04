from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text

from .db import get_session
from .schemas import (
    Assertion,
    CaseInput,
    CaseOut,
    CaseResult,
    RunSummary,
    ScoreDetail,
    SuiteCreate,
    SuiteOut,
    SuiteSummary,
)


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _as_json(value: Any) -> Any:
    """asyncpg returns jsonb as a str on some driver versions and as a dict on others."""
    if isinstance(value, (str, bytes)):
        return json.loads(value)
    return value


# ─── Suites ─────────────────────────────────────────────────────


async def create_suite(payload: SuiteCreate) -> SuiteOut:
    """Upsert by (ownerId, name) so re-posting a suite definition from CI is idempotent."""
    async with get_session() as s:
        await s.execute(
            text(
                "INSERT INTO evals.suite (id, owner_id, name, description, target) "
                "VALUES (:id, :owner, :name, :desc, CAST(:target AS jsonb)) "
                "ON CONFLICT (owner_id, name) DO UPDATE SET "
                "description = EXCLUDED.description, target = EXCLUDED.target, updated_at = now()"
            ),
            {
                "id": str(uuid.uuid4()),
                "owner": payload.ownerId,
                "name": payload.name,
                "desc": payload.description,
                "target": payload.target.model_dump_json(),
            },
        )
        row = (
            await s.execute(
                text("SELECT id FROM evals.suite WHERE owner_id = :owner AND name = :name"),
                {"owner": payload.ownerId, "name": payload.name},
            )
        ).first()
        suite_id = str(row[0])
        if payload.cases:
            await _replace_cases(s, suite_id, payload.cases)
        await s.commit()

    suite = await get_suite(suite_id)
    assert suite is not None
    return suite


async def _replace_cases(session: Any, suite_id: str, cases: list[CaseInput]) -> None:
    await session.execute(text("DELETE FROM evals.case WHERE suite_id = :sid"), {"sid": suite_id})
    for position, case in enumerate(cases):
        await session.execute(
            text(
                "INSERT INTO evals.case "
                "(id, suite_id, key, input, expected, assertions, metadata, weight, position) "
                "VALUES (:id, :sid, :key, :input, :expected, CAST(:assertions AS jsonb), "
                "CAST(:metadata AS jsonb), :weight, :position)"
            ),
            {
                "id": str(uuid.uuid4()),
                "sid": suite_id,
                "key": case.key,
                "input": case.input,
                "expected": case.expected,
                "assertions": json.dumps([a.model_dump() for a in case.assertions]),
                "metadata": json.dumps(case.metadata),
                "weight": case.weight,
                "position": position,
            },
        )


async def replace_cases(suite_id: str, cases: list[CaseInput]) -> SuiteOut | None:
    async with get_session() as s:
        exists = (await s.execute(text("SELECT 1 FROM evals.suite WHERE id = :id"), {"id": suite_id})).first()
        if not exists:
            return None
        await _replace_cases(s, suite_id, cases)
        await s.execute(text("UPDATE evals.suite SET updated_at = now() WHERE id = :id"), {"id": suite_id})
        await s.commit()
    return await get_suite(suite_id)


async def get_suite(suite_id: str) -> SuiteOut | None:
    async with get_session() as s:
        row = (
            await s.execute(
                text(
                    "SELECT id, owner_id, name, description, target, created_at, updated_at "
                    "FROM evals.suite WHERE id = :id"
                ),
                {"id": suite_id},
            )
        ).first()
        if row is None:
            return None
        case_rows = (
            await s.execute(
                text(
                    "SELECT id, key, input, expected, assertions, metadata, weight, position "
                    "FROM evals.case WHERE suite_id = :id ORDER BY position"
                ),
                {"id": suite_id},
            )
        ).fetchall()

    return SuiteOut(
        id=str(row[0]),
        ownerId=row[1],
        name=row[2],
        description=row[3],
        target=_as_json(row[4]) or {},
        createdAt=_iso(row[5]) or "",
        updatedAt=_iso(row[6]) or "",
        cases=[
            CaseOut(
                id=str(c[0]),
                key=c[1],
                input=c[2],
                expected=c[3],
                assertions=[Assertion(**a) for a in (_as_json(c[4]) or [])],
                metadata=_as_json(c[5]) or {},
                weight=c[6],
                position=c[7],
            )
            for c in case_rows
        ],
    )


async def list_suites(owner_id: str | None) -> list[SuiteSummary]:
    sql = (
        "SELECT s.id, s.owner_id, s.name, s.description, s.created_at, s.updated_at, COUNT(c.id) "
        "FROM evals.suite s LEFT JOIN evals.case c ON c.suite_id = s.id "
        + ("WHERE s.owner_id = :owner " if owner_id else "")
        + "GROUP BY s.id ORDER BY s.updated_at DESC"
    )
    async with get_session() as s:
        rows = (await s.execute(text(sql), {"owner": owner_id} if owner_id else {})).fetchall()
    return [
        SuiteSummary(
            id=str(r[0]),
            ownerId=r[1],
            name=r[2],
            description=r[3],
            createdAt=_iso(r[4]) or "",
            updatedAt=_iso(r[5]) or "",
            caseCount=int(r[6]),
        )
        for r in rows
    ]


async def delete_suite(suite_id: str) -> bool:
    async with get_session() as s:
        result = await s.execute(text("DELETE FROM evals.suite WHERE id = :id"), {"id": suite_id})
        await s.commit()
        return (result.rowcount or 0) > 0


# ─── Runs ───────────────────────────────────────────────────────


async def create_run(suite_id: str, target: dict[str, Any], label: str | None, baseline_run_id: str | None) -> str:
    run_id = str(uuid.uuid4())
    async with get_session() as s:
        await s.execute(
            text(
                "INSERT INTO evals.run (id, suite_id, status, target, label, baseline_run_id) "
                "VALUES (:id, :sid, 'running', CAST(:target AS jsonb), :label, :baseline)"
            ),
            {
                "id": run_id,
                "sid": suite_id,
                "target": json.dumps(target),
                "label": label,
                "baseline": baseline_run_id,
            },
        )
        await s.commit()
    return run_id


async def save_result(run_id: str, case_id: str | None, result: CaseResult) -> None:
    async with get_session() as s:
        await s.execute(
            text(
                "INSERT INTO evals.result "
                "(id, run_id, case_id, case_key, output, passed, score, latency_ms, cost_usd, scores, error) "
                "VALUES (:id, :run, :case, :key, :output, :passed, :score, :latency, :cost, "
                "CAST(:scores AS jsonb), :error) "
                "ON CONFLICT (run_id, case_key) DO UPDATE SET "
                "output = EXCLUDED.output, passed = EXCLUDED.passed, score = EXCLUDED.score, "
                "latency_ms = EXCLUDED.latency_ms, cost_usd = EXCLUDED.cost_usd, "
                "scores = EXCLUDED.scores, error = EXCLUDED.error"
            ),
            {
                "id": str(uuid.uuid4()),
                "run": run_id,
                "case": case_id,
                "key": result.caseKey,
                "output": result.output,
                "passed": result.passed,
                "score": result.score,
                "latency": result.latencyMs,
                "cost": result.costUsd,
                "scores": json.dumps([d.model_dump() for d in result.scores]),
                "error": result.error,
            },
        )
        await s.commit()


async def finish_run(run_id: str, status: str, summary: RunSummary | None, error: str | None) -> None:
    async with get_session() as s:
        await s.execute(
            text(
                "UPDATE evals.run SET status = :status, summary = CAST(:summary AS jsonb), "
                "error = :error, finished_at = now() WHERE id = :id"
            ),
            {
                "id": run_id,
                "status": status,
                "error": error,
                "summary": summary.model_dump_json() if summary else "{}",
            },
        )
        await s.commit()


async def get_run_row(run_id: str) -> Any:
    async with get_session() as s:
        return (
            await s.execute(
                text(
                    "SELECT id, suite_id, status, label, target, baseline_run_id, summary, error, "
                    "started_at, finished_at FROM evals.run WHERE id = :id"
                ),
                {"id": run_id},
            )
        ).first()


async def get_run_results(run_id: str) -> list[CaseResult]:
    async with get_session() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT case_key, output, passed, score, latency_ms, cost_usd, scores, error "
                    "FROM evals.result WHERE run_id = :id ORDER BY case_key"
                ),
                {"id": run_id},
            )
        ).fetchall()
    return [
        CaseResult(
            caseKey=r[0],
            output=r[1],
            passed=r[2],
            score=r[3],
            latencyMs=r[4],
            costUsd=float(r[5]),
            scores=[ScoreDetail(**d) for d in (_as_json(r[6]) or [])],
            error=r[7],
        )
        for r in rows
    ]


async def list_runs(suite_id: str, limit: int) -> list[Any]:
    async with get_session() as s:
        return (
            await s.execute(
                text(
                    "SELECT id, suite_id, status, label, summary, started_at, finished_at "
                    "FROM evals.run WHERE suite_id = :sid ORDER BY started_at DESC LIMIT :lim"
                ),
                {"sid": suite_id, "lim": limit},
            )
        ).fetchall()
