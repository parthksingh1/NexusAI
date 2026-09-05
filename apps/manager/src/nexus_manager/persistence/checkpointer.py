"""LangGraph checkpointing in the existing Postgres.

A checkpointed run can be resumed: restarting the service and invoking the same thread id
picks up from the last completed node instead of re-running finished work.

When DATABASE_URL is unset the service falls back to an in-memory saver, so it still runs
without Postgres — the run simply cannot survive a restart. That trade is stated in the log
rather than made silently.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import structlog

from ..config import Settings, settings as default_settings

log = structlog.get_logger(__name__)


def _to_psycopg_dsn(dsn: str) -> str:
    """LangGraph's Postgres saver uses psycopg, which wants a plain postgresql:// URL."""
    cleaned = dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    # Prisma-style query parameters are not understood by psycopg.
    if "?" in cleaned:
        base, _, query = cleaned.partition("?")
        keep = [p for p in query.split("&") if not p.startswith("schema=")]
        cleaned = base + ("?" + "&".join(keep) if keep else "")
    return cleaned


@asynccontextmanager
async def checkpointer(settings: Settings | None = None):
    """Yield a LangGraph checkpointer, Postgres-backed when one is configured."""
    cfg = settings or default_settings

    if not cfg.database_url:
        from langgraph.checkpoint.memory import MemorySaver

        log.warning("checkpointing_in_memory", reason="DATABASE_URL is not set; runs will not survive a restart")
        yield MemorySaver()
        return

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    except ImportError:
        from langgraph.checkpoint.memory import MemorySaver

        log.warning("checkpointing_in_memory", reason="langgraph-checkpoint-postgres is not installed")
        yield MemorySaver()
        return

    dsn = _to_psycopg_dsn(cfg.database_url)
    try:
        async with AsyncPostgresSaver.from_conn_string(dsn) as saver:
            await saver.setup()
            log.info("checkpointing_postgres_ready")
            yield saver
    except Exception as exc:
        # A database that is unreachable at boot should degrade to a working service, not a
        # dead one. Resumability is lost; the run still executes.
        from langgraph.checkpoint.memory import MemorySaver

        log.warning("checkpointing_in_memory", reason=f"postgres unavailable: {exc}")
        yield MemorySaver()
