from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from .db import get_session
from .embeddings import embed_text


@dataclass(slots=True)
class Hit:
    chunk_id: str
    document_id: str
    title: str
    snippet: str
    dense_score: float
    sparse_score: float
    score: float
    url: str | None


async def dense_search(query_embedding: list[float], owner_id: str, top_k: int) -> list[Hit]:
    """Cosine-distance search over pgvector. Distance is in [0, 2]; we convert to similarity [0, 1]."""
    vec = "[" + ",".join(f"{x:.7f}" for x in query_embedding) + "]"
    sql = text(
        """
        SELECT c.id::text AS chunk_id,
               c."documentId"::text AS document_id,
               d.title AS title,
               d.url AS url,
               left(c.text, 500) AS snippet,
               1 - (c.embedding <=> :vec ::vector) AS similarity
          FROM rag."Chunk" c
          JOIN rag."Document" d ON d.id = c."documentId"
         WHERE d."ownerId" = :owner
         ORDER BY c.embedding <=> :vec ::vector
         LIMIT :k
        """
    )
    async with get_session() as s:
        rows = (await s.execute(sql, {"vec": vec, "owner": owner_id, "k": top_k})).mappings().all()
    return [
        Hit(
            chunk_id=r["chunk_id"],
            document_id=r["document_id"],
            title=r["title"],
            url=r["url"],
            snippet=r["snippet"],
            dense_score=float(r["similarity"]),
            sparse_score=0.0,
            score=float(r["similarity"]),
        )
        for r in rows
    ]


async def sparse_search(query: str, owner_id: str, top_k: int) -> list[Hit]:
    """Postgres tsvector full-text search — the BM25-ish leg of the hybrid."""
    sql = text(
        """
        SELECT c.id::text AS chunk_id,
               c."documentId"::text AS document_id,
               d.title AS title,
               d.url AS url,
               left(c.text, 500) AS snippet,
               ts_rank_cd(c.tsv, websearch_to_tsquery('english', :q)) AS rank
          FROM rag."Chunk" c
          JOIN rag."Document" d ON d.id = c."documentId"
         WHERE d."ownerId" = :owner
           AND c.tsv @@ websearch_to_tsquery('english', :q)
         ORDER BY rank DESC
         LIMIT :k
        """
    )
    async with get_session() as s:
        rows = (await s.execute(sql, {"q": query, "owner": owner_id, "k": top_k})).mappings().all()
    return [
        Hit(
            chunk_id=r["chunk_id"],
            document_id=r["document_id"],
            title=r["title"],
            url=r["url"],
            snippet=r["snippet"],
            dense_score=0.0,
            sparse_score=float(r["rank"]),
            score=float(r["rank"]),
        )
        for r in rows
    ]


def _normalize(values: list[float]) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi <= lo:
        return [0.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


async def hybrid_search(
    query: str,
    owner_id: str,
    top_k: int = 8,
    alpha: float = 0.5,
    use_hyde: bool = False,
) -> list[Hit]:
    """Reciprocal fusion of dense + sparse. `alpha` weights dense vs sparse (1.0 = dense only)."""
    embed_source = query
    if use_hyde:
        embed_source = await _hyde_expand(query)

    q_emb = await embed_text(embed_source)
    dense_hits, sparse_hits = (
        await dense_search(q_emb, owner_id, top_k * 2),
        await sparse_search(query, owner_id, top_k * 2),
    )

    # normalize scores within each leg, then fuse
    dense_norm = _normalize([h.dense_score for h in dense_hits])
    sparse_norm = _normalize([h.sparse_score for h in sparse_hits])

    merged: dict[str, Hit] = {}
    for h, n in zip(dense_hits, dense_norm):
        h.dense_score = n
        merged[h.chunk_id] = h
    for h, n in zip(sparse_hits, sparse_norm):
        if h.chunk_id in merged:
            merged[h.chunk_id].sparse_score = n
        else:
            h.sparse_score = n
            merged[h.chunk_id] = h

    for h in merged.values():
        h.score = alpha * h.dense_score + (1.0 - alpha) * h.sparse_score

    ranked = sorted(merged.values(), key=lambda x: x.score, reverse=True)
    return ranked[:top_k]


async def _hyde_expand(query: str) -> str:
    """HyDE: generate a hypothetical answer, embed that instead of the query.
    Falls back to the raw query if Gemini is not configured or the call fails.
    """
    import asyncio

    import google.generativeai as genai

    from .config import settings  # local import to avoid cycles

    if not settings.google_api_key:
        return query

    genai.configure(api_key=settings.google_api_key)

    def _call() -> str:
        model = genai.GenerativeModel(
            settings.reasoning_model,
            system_instruction=(
                "Write a single short, plausible paragraph that would directly answer the question. "
                "No caveats, no meta-commentary."
            ),
            generation_config={"temperature": 0.2, "max_output_tokens": 180},
        )
        resp = model.generate_content(query)
        return resp.text or query

    try:
        return await asyncio.to_thread(_call)
    except Exception:
        return query
