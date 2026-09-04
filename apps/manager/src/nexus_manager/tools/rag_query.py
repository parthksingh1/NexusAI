"""Query the existing NexusAI retrieval service.

Wraps the POST /search endpoint of apps/rag. The manager never reads the retrieval database
directly: that service owns hybrid search, reranking, and its own schema.
"""

from __future__ import annotations

import httpx
import structlog

from ..config import Settings, settings as default_settings
from .schemas import Chunk, RagInput, RagResult

log = structlog.get_logger(__name__)


async def rag_query(
    q: str, k: int = 5, *, owner_id: str = "manager", settings: Settings | None = None
) -> RagResult:
    """Retrieve grounded context from the indexed document corpus."""
    cfg = settings or default_settings
    try:
        inp = RagInput(q=q, k=k, owner_id=owner_id)
    except Exception as exc:
        return RagResult(ok=False, error=f"invalid query: {exc}")

    payload = {"query": inp.q, "ownerId": inp.owner_id, "topK": inp.k, "useRerank": True}
    try:
        async with httpx.AsyncClient(timeout=cfg.tool_timeout_s) as client:
            resp = await client.post(f"{cfg.rag_url.rstrip('/')}/search", json=payload)
    except httpx.HTTPError as exc:
        return RagResult(ok=False, error=f"retrieval service unreachable at {cfg.rag_url}: {exc}")

    if resp.status_code >= 400:
        return RagResult(ok=False, error=f"retrieval service returned {resp.status_code}: {resp.text[:200]}")

    try:
        hits = resp.json().get("hits", [])
    except ValueError as exc:
        return RagResult(ok=False, error=f"retrieval service returned invalid JSON: {exc}")

    return RagResult(
        chunks=[
            Chunk(
                text=h.get("snippet", ""),
                source=h.get("url") or h.get("title", "") or h.get("documentId", ""),
                score=float(h.get("score") or 0.0),
            )
            for h in hits
        ]
    )
