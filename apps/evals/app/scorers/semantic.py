from __future__ import annotations

from typing import Any

import numpy as np

from ..config import settings
from ..schemas import Assertion, ScoreDetail

# Imported lazily so deterministic assertions run without the OpenAI SDK installed.
_client: Any = None


def _get_client() -> Any:
    global _client
    if _client is None:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is required for embedding_similarity assertions")
        from openai import AsyncOpenAI

        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def embed_pair(a: str, b: str) -> tuple[list[float], list[float]]:
    resp = await _get_client().embeddings.create(model=settings.embedding_model, input=[a[:8000], b[:8000]])
    return resp.data[0].embedding, resp.data[1].embedding


def cosine(a: list[float], b: list[float]) -> float:
    va, vb = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(np.dot(va, vb) / denom)


async def score_embedding_similarity(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    reference = a.value if a.value is not None else expected
    if reference is None:
        return ScoreDetail(
            type=a.type, passed=False, score=0.0, weight=a.weight, required=a.required,
            detail="no reference text supplied",
        )
    threshold = float(a.options.get("threshold", 0.82))
    if not output.strip():
        return ScoreDetail(
            type=a.type, passed=False, score=0.0, weight=a.weight, required=a.required, detail="empty output"
        )
    try:
        v_out, v_ref = await embed_pair(output, str(reference))
    except Exception as exc:  # network/auth failures must not abort the whole run
        return ScoreDetail(
            type=a.type, passed=False, score=0.0, weight=a.weight, required=a.required,
            detail=f"embedding failed: {exc}",
        )
    sim = cosine(v_out, v_ref)
    ok = sim >= threshold
    # Rescale similarity into [0,1] against the threshold so the score is readable:
    # exactly at threshold reads as 0.5, perfect similarity as 1.0.
    score = 0.5 * sim / threshold if sim < threshold else 0.5 + 0.5 * (sim - threshold) / max(1e-6, 1.0 - threshold)
    return ScoreDetail(
        type=a.type, passed=ok, score=max(0.0, min(1.0, score)), weight=a.weight, required=a.required,
        detail=f"cosine {sim:.4f} vs threshold {threshold:.2f}",
    )
