from __future__ import annotations

import logging
import time

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.responses import PlainTextResponse

from .config import settings
from .ingest import ingest_document
from .query_decomp import decompose_query
from .rerank import rerank
from .retrieval import hybrid_search
from .routes_connectors import router as connectors_router
from .schemas import IngestRequest, IngestResponse, SearchHit, SearchRequest, SearchResponse

logging.basicConfig(level=settings.log_level)
structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
log = structlog.get_logger()

app = FastAPI(title="NexusAI RAG", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(connectors_router)

search_counter = Counter("nexus_rag_search_total", "RAG searches", ["status"])
search_latency = Histogram("nexus_rag_search_latency_ms", "Search latency", buckets=(25, 50, 100, 200, 400, 800, 1600, 3200))


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest().decode(), media_type=CONTENT_TYPE_LATEST)


@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest) -> SearchResponse:
    start = time.perf_counter()
    try:
        subqueries = await decompose_query(req.query)
        if len(subqueries) == 1:
            hits = await hybrid_search(
                query=req.query,
                owner_id=req.ownerId,
                top_k=req.topK,
                alpha=req.hybridAlpha,
                use_hyde=req.useHyde,
            )
        else:
            # multi-hop: search each sub-query, fuse by best score per chunk
            merged: dict[str, object] = {}
            per_sub = max(3, req.topK // len(subqueries) + 2)
            for sq in subqueries:
                sub_hits = await hybrid_search(
                    query=sq, owner_id=req.ownerId, top_k=per_sub,
                    alpha=req.hybridAlpha, use_hyde=req.useHyde,
                )
                for h in sub_hits:
                    prev = merged.get(h.chunk_id)
                    if prev is None or getattr(prev, "score", 0) < h.score:
                        merged[h.chunk_id] = h
            hits = sorted(merged.values(), key=lambda x: x.score, reverse=True)[: req.topK]  # type: ignore[attr-defined]
        if req.useRerank:
            hits = await rerank(req.query, hits)
        search_counter.labels("success").inc()
        ms = int((time.perf_counter() - start) * 1000)
        search_latency.observe(ms)
        return SearchResponse(
            query=req.query,
            latencyMs=ms,
            hits=[
                SearchHit(
                    chunkId=h.chunk_id,
                    documentId=h.document_id,
                    title=h.title,
                    snippet=h.snippet,
                    score=h.score,
                    denseScore=h.dense_score,
                    sparseScore=h.sparse_score,
                    url=h.url,
                )
                for h in hits
            ],
        )
    except Exception as exc:
        log.error("search_failed", err=str(exc))
        search_counter.labels("error").inc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    try:
        result = await ingest_document(
            owner_id=req.ownerId,
            source=req.source,
            source_id=req.sourceId,
            title=req.title,
            url=req.url,
            body=req.text,
            strategy=req.chunking,
        )
        return IngestResponse(documentId=result["documentId"], chunks=result["chunks"])
    except Exception as exc:
        log.error("ingest_failed", err=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
