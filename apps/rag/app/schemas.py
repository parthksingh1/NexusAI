from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    ownerId: str
    topK: int = Field(default=8, ge=1, le=50)
    hybridAlpha: float = Field(default=0.5, ge=0.0, le=1.0)
    useHyde: bool = False
    useRerank: bool = True


class SearchHit(BaseModel):
    chunkId: str
    documentId: str
    title: str
    snippet: str
    score: float
    denseScore: float
    sparseScore: float
    url: str | None = None


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]
    latencyMs: int


class IngestRequest(BaseModel):
    ownerId: str
    source: Literal["notion", "github", "slack", "url", "upload"]
    sourceId: str
    title: str
    url: str | None = None
    text: str = Field(min_length=1)
    chunking: Literal["fixed", "recursive", "semantic", "markdown"] = "recursive"


class IngestResponse(BaseModel):
    documentId: str
    chunks: int
