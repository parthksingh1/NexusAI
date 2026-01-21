from __future__ import annotations

from openai import AsyncOpenAI

from .config import settings

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is required for embeddings in Phase 1")
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def embed_text(text: str) -> list[float]:
    """Embed a single string with the configured model. Truncates to 8k chars defensively."""
    client = _get_client()
    resp = await client.embeddings.create(
        model=settings.embedding_model,
        input=text[:8000],
    )
    return resp.data[0].embedding


async def embed_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    client = _get_client()
    resp = await client.embeddings.create(
        model=settings.embedding_model,
        input=[t[:8000] for t in texts],
    )
    return [d.embedding for d in resp.data]
