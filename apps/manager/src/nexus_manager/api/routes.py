"""HTTP surface."""

from __future__ import annotations

import asyncio

import structlog
from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from nexus_agents_shared import Plan, RunEvent
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from ..config import Provider
from .sse import event_stream

log = structlog.get_logger(__name__)

router = APIRouter()


class ChatRequest(BaseModel):
    goal: str = Field(..., min_length=5, max_length=2000)
    provider: Provider | None = None
    max_usd: float | None = Field(default=None, gt=0, le=100)


class ChatResponse(BaseModel):
    run_id: str
    plan: Plan | None = None
    status: str


class ProviderInfo(BaseModel):
    id: str
    label: str
    available: bool
    kind: str
    """"local" or "cloud" — the difference the user is choosing between."""

    models: list[str] = Field(default_factory=list)
    reason: str | None = None


PROVIDER_LABELS = {
    "ollama": ("Local (Ollama)", "local"),
    "anthropic": ("Claude", "cloud"),
    "openai": ("GPT-4o", "cloud"),
    "gemini": ("Gemini", "cloud"),
}


def _service(request: Request):
    return request.app.state.runs


def _bus(request: Request):
    return request.app.state.bus


# ─── Health ─────────────────────────────────────────────────────


@router.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> dict:
    """Ready means a model provider can actually serve a call."""
    available = await _service(request).router.available_providers()
    ready = any(available.values())
    if not ready:
        raise HTTPException(
            status_code=503,
            detail="no model provider is available: start Ollama or set a cloud API key",
        )
    return {"status": "ready", "providers": available}


@router.get("/providers", response_model=list[ProviderInfo])
async def providers(request: Request) -> list[ProviderInfo]:
    """Which providers can run right now, and why not when they cannot."""
    service = _service(request)
    available = await service.router.available_providers()
    ollama_models = await service.router.ollama_models() if available.get("ollama") else []

    infos: list[ProviderInfo] = []
    for provider_id, (label, kind) in PROVIDER_LABELS.items():
        ok = available.get(provider_id, False)
        reason = None
        if not ok:
            reason = (
                f"Ollama is not reachable at {service.settings.ollama_host}"
                if provider_id == "ollama"
                else f"set {'GOOGLE_API_KEY' if provider_id == 'gemini' else provider_id.upper() + '_API_KEY'}"
            )
        infos.append(
            ProviderInfo(
                id=provider_id,
                label=label,
                available=ok,
                kind=kind,
                models=ollama_models if provider_id == "ollama" else [],
                reason=reason,
            )
        )
    return infos


# ─── Runs ───────────────────────────────────────────────────────


@router.post("/chat", response_model=ChatResponse, status_code=202)
async def chat(body: ChatRequest, request: Request) -> ChatResponse:
    """Plan a goal and start executing it. The plan is returned with this response."""
    service = _service(request)
    record = await service.start(body.goal, body.provider, body.max_usd)
    if record.status == "error":
        raise HTTPException(status_code=502, detail=record.reason or "planning failed")
    return ChatResponse(run_id=record.run_id, plan=record.plan, status=record.status)


@router.get("/runs")
async def list_runs(request: Request, limit: int = Query(default=20, ge=1, le=200)) -> list[dict]:
    return [
        {
            "run_id": r.run_id,
            "status": r.status,
            "goal": r.goal,
            "started_at": r.started_at,
            "finished_at": r.finished_at,
            "budget": r.budget.model_dump(mode="json") if r.budget else None,
        }
        for r in _service(request).store.all()[:limit]
    ]


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request) -> dict:
    record = _service(request).store.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return {
        "run_id": record.run_id,
        "status": record.status,
        "goal": record.goal,
        "plan": record.plan.model_dump(mode="json") if record.plan else None,
        "results": {tid: r.model_dump(mode="json") for tid, r in record.results.items()},
        "answer": record.answer,
        "citations": record.citations,
        "budget": record.budget.model_dump(mode="json") if record.budget else None,
        "reason": record.reason,
        "started_at": record.started_at,
        "finished_at": record.finished_at,
    }


@router.post("/runs/{run_id}/resume", status_code=202)
async def resume(run_id: str, request: Request) -> dict:
    """Continue an interrupted run from its last checkpoint."""
    service = _service(request)
    if service.store.get(run_id) is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    if service.store.is_running(run_id):
        raise HTTPException(status_code=409, detail=f"run {run_id} is already executing")
    record = await service.resume(run_id)
    return {"run_id": run_id, "status": record.status if record else "unknown"}


@router.post("/runs/{run_id}/cancel", status_code=202)
async def cancel(run_id: str, request: Request) -> dict:
    service = _service(request)
    if service.store.get(run_id) is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    cancelled = await service.cancel(run_id) if hasattr(service, "cancel") else await service.store.cancel(run_id)
    return {"run_id": run_id, "cancelled": cancelled}


# ─── Streaming ──────────────────────────────────────────────────


@router.get("/runs/{run_id}/events")
async def stream_events(run_id: str, request: Request) -> StreamingResponse:
    """Server-Sent Events for one run, replaying what has already happened."""
    service = _service(request)
    if service.store.get(run_id) is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return StreamingResponse(
        event_stream(_bus(request), run_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Proxies that buffer would defeat the point of streaming.
            "X-Accel-Buffering": "no",
        },
    )


@router.websocket("/ws/runs/{run_id}")
async def run_socket(websocket: WebSocket, run_id: str) -> None:
    """The same event stream over WebSocket, for the graph UI."""
    bus = websocket.app.state.bus
    service = websocket.app.state.runs
    await websocket.accept()

    if service.store.get(run_id) is None:
        await websocket.send_json(
            RunEvent(run_id=run_id, kind="error", payload={"error": f"run {run_id} not found"}).model_dump(
                mode="json"
            )
        )
        await websocket.close()
        return

    try:
        async for event in bus.subscribe(run_id):
            await websocket.send_json(event.model_dump(mode="json"))
    except (WebSocketDisconnect, asyncio.CancelledError):
        return
    except Exception as exc:
        log.warning("websocket_closed", run_id=run_id, error=str(exc)[:200])
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass
