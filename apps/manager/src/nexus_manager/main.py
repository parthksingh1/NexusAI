"""FastAPI application entry point."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.responses import JSONResponse, PlainTextResponse

from .api.routes import router
from .api.runs import RunService
from .config import settings
from .graph.streaming import EventBus
from .observability.tracing import configure_tracing
from .persistence.checkpointer import checkpointer

logging.basicConfig(level=settings.log_level, format="%(message)s")
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger(__name__)


async def _redis_client():
    """Connect to Redis if it is configured and reachable.

    Redis makes the per-domain rate limit and the robots cache shared across replicas, and
    fans run events out beyond this process. Without it the service still runs, with those
    three things scoped to one process.
    """
    try:
        from redis.asyncio import from_url

        client = from_url(settings.redis_url, decode_responses=False)
        await client.ping()
        log.info("redis_connected", url=settings.redis_url)
        return client
    except Exception as exc:
        log.warning("redis_unavailable", url=settings.redis_url, error=str(exc)[:200])
        return None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_tracing(settings)
    redis = await _redis_client()

    async with checkpointer(settings) as saver:
        bus = EventBus(settings, redis)
        app.state.bus = bus
        app.state.redis = redis
        app.state.runs = RunService(settings=settings, bus=bus, checkpointer=saver)
        log.info("manager_started", port=settings.manager_port, provider=settings.default_llm_provider)
        try:
            yield
        finally:
            if redis is not None:
                await redis.aclose()
            log.info("manager_stopped")


app = FastAPI(
    title="NexusAI Manager",
    version="0.1.0",
    description="An AI planner that spawns specialist agents to complete a goal.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach a request id to every log line produced while handling this request."""
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        log.exception("request_failed", method=request.method, error=str(exc))
        structlog.contextvars.clear_contextvars()
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "detail": str(exc), "request_id": request_id},
            headers={"x-request-id": request_id},
        )
    elapsed = int((time.perf_counter() - started) * 1000)
    log.info("request", method=request.method, status=response.status_code, duration_ms=elapsed)
    response.headers["x-request-id"] = request_id
    structlog.contextvars.clear_contextvars()
    return response


@app.get("/metrics")
async def metrics_endpoint() -> PlainTextResponse:
    return PlainTextResponse(generate_latest().decode(), media_type=CONTENT_TYPE_LATEST)


app.include_router(router)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "nexus_manager.main:app",
        host="0.0.0.0",
        port=settings.manager_port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    run()
