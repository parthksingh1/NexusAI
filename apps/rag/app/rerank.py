from __future__ import annotations

import os

import httpx

from .retrieval import Hit


async def rerank(query: str, hits: list[Hit]) -> list[Hit]:
    """
    Cross-encoder rerank. Prefers Cohere rerank-3 when COHERE_API_KEY is set,
    else Jina when JINA_API_KEY is set, else falls back to a lexical heuristic.
    The Hit shape is preserved — only .score is mutated.
    """
    if not hits:
        return hits

    cohere_key = os.getenv("COHERE_API_KEY")
    if cohere_key:
        return await _cohere_rerank(query, hits, cohere_key)

    jina_key = os.getenv("JINA_API_KEY")
    if jina_key:
        return await _jina_rerank(query, hits, jina_key)

    return _lexical_rerank(query, hits)


async def _cohere_rerank(query: str, hits: list[Hit], key: str) -> list[Hit]:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(
            "https://api.cohere.com/v2/rerank",
            headers={"authorization": f"Bearer {key}"},
            json={
                "model": "rerank-english-v3.0",
                "query": query,
                "documents": [h.snippet for h in hits],
                "top_n": len(hits),
            },
        )
        r.raise_for_status()
        results = r.json()["results"]
    reranked: list[Hit] = []
    for res in results:
        idx = res["index"]
        hit = hits[idx]
        hit.score = float(res["relevance_score"])
        reranked.append(hit)
    return reranked


async def _jina_rerank(query: str, hits: list[Hit], key: str) -> list[Hit]:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(
            "https://api.jina.ai/v1/rerank",
            headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
            json={
                "model": "jina-reranker-v2-base-multilingual",
                "query": query,
                "documents": [h.snippet for h in hits],
                "top_n": len(hits),
            },
        )
        r.raise_for_status()
        results = r.json()["results"]
    reranked: list[Hit] = []
    for res in results:
        idx = res["index"]
        hit = hits[idx]
        hit.score = float(res["relevance_score"])
        reranked.append(hit)
    return reranked


def _lexical_rerank(query: str, hits: list[Hit]) -> list[Hit]:
    q_terms = {t.lower() for t in query.split() if len(t) > 2}
    if not q_terms:
        return hits
    for h in hits:
        overlap = sum(1 for t in h.snippet.lower().split() if t in q_terms)
        h.score = 0.7 * h.score + 0.3 * min(1.0, overlap / max(1, len(q_terms)))
    return sorted(hits, key=lambda x: x.score, reverse=True)
