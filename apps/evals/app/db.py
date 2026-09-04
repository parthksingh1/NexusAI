from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings


def _to_asyncpg_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn
    if dsn.startswith("postgresql://"):
        return dsn.replace("postgresql://", "postgresql+asyncpg://", 1)
    return dsn


engine = create_async_engine(
    _to_asyncpg_dsn(settings.database_url),
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# The evals service owns the `evals` Postgres schema outright — it is not part of the
# Prisma schema, so it bootstraps its own DDL on startup rather than requiring a
# TypeScript-side migration to be run first.
_DDL = """
CREATE SCHEMA IF NOT EXISTS evals;

CREATE TABLE IF NOT EXISTS evals.suite (
    id           uuid PRIMARY KEY,
    owner_id     text        NOT NULL,
    name         text        NOT NULL,
    description  text,
    target       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS evals.case (
    id          uuid PRIMARY KEY,
    suite_id    uuid        NOT NULL REFERENCES evals.suite(id) ON DELETE CASCADE,
    key         text        NOT NULL,
    input       text        NOT NULL,
    expected    text,
    assertions  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    weight      double precision NOT NULL DEFAULT 1.0,
    position    integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (suite_id, key)
);

CREATE TABLE IF NOT EXISTS evals.run (
    id              uuid PRIMARY KEY,
    suite_id        uuid        NOT NULL REFERENCES evals.suite(id) ON DELETE CASCADE,
    status          text        NOT NULL DEFAULT 'running',
    target          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    label           text,
    baseline_run_id uuid,
    summary         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    error           text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);

CREATE TABLE IF NOT EXISTS evals.result (
    id         uuid PRIMARY KEY,
    run_id     uuid        NOT NULL REFERENCES evals.run(id) ON DELETE CASCADE,
    case_id    uuid,
    case_key   text        NOT NULL,
    output     text,
    passed     boolean     NOT NULL DEFAULT false,
    score      double precision NOT NULL DEFAULT 0,
    latency_ms integer     NOT NULL DEFAULT 0,
    cost_usd   numeric(12, 6) NOT NULL DEFAULT 0,
    scores     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    error      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, case_key)
);

CREATE INDEX IF NOT EXISTS case_suite_position_idx ON evals.case (suite_id, position);
CREATE INDEX IF NOT EXISTS run_suite_started_idx   ON evals.run (suite_id, started_at DESC);
CREATE INDEX IF NOT EXISTS result_run_idx          ON evals.result (run_id);
"""


async def init_schema() -> None:
    """Create the `evals` schema and tables if they do not exist. Safe to call on every boot."""
    async with engine.begin() as conn:
        for stmt in filter(None, (s.strip() for s in _DDL.split(";"))):
            await conn.execute(text(stmt))
