"""Input and output contracts for every tool.

Each tool takes a Pydantic input and returns a Pydantic output. Tools never raise into the
graph: a failure returns a result whose `ok` is False with the reason attached, so one dead
website cannot end a run.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, HttpUrl


class ToolError(BaseModel):
    # `ok` mirrors every other tool result so callers never have to know which shape they got.
    ok: bool = False
    tool: str
    message: str
    retryable: bool = False


# ─── web_search ─────────────────────────────────────────────────


class SearchHit(BaseModel):
    url: str
    title: str
    snippet: str = ""
    score: float = 0.0


class SearchResult(BaseModel):
    ok: bool = True
    query: str
    provider: str = ""
    hits: list[SearchHit] = Field(default_factory=list)
    error: str | None = None


# ─── fetch_url / browse ─────────────────────────────────────────


class Page(BaseModel):
    url: str
    title: str = ""
    text: str = ""
    links: list[str] = Field(default_factory=list)
    published_at: str | None = None
    fetched_with: str = ""
    """Which path produced this page: "trafilatura" or "playwright"."""


class PageResult(BaseModel):
    ok: bool = True
    page: Page | None = None
    error: str | None = None


# ─── youtube_transcript ─────────────────────────────────────────


class Segment(BaseModel):
    start_s: float
    duration_s: float = 0.0
    text: str


class Video(BaseModel):
    id: str
    title: str = ""
    channel: str = ""
    duration_s: int = 0
    url: str = ""
    transcript: list[Segment] = Field(default_factory=list)

    @property
    def full_text(self) -> str:
        return " ".join(s.text for s in self.transcript)


class VideoResult(BaseModel):
    ok: bool = True
    video: Video | None = None
    error: str | None = None


# ─── rag_query ──────────────────────────────────────────────────


class Chunk(BaseModel):
    text: str
    source: str = ""
    score: float = 0.0


class RagResult(BaseModel):
    ok: bool = True
    chunks: list[Chunk] = Field(default_factory=list)
    error: str | None = None


# ─── code_exec ──────────────────────────────────────────────────


class ExecResult(BaseModel):
    ok: bool = True
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    duration_ms: int = 0
    timed_out: bool = False
    error: str | None = None


# ─── tool inputs ────────────────────────────────────────────────


class SearchInput(BaseModel):
    query: str = Field(..., min_length=2, max_length=400)
    k: int = Field(default=5, ge=1, le=20)


class UrlInput(BaseModel):
    url: HttpUrl


class BrowseInput(BaseModel):
    url: HttpUrl
    wait_for: str | None = None
    """Optional CSS selector to await before extracting."""


class RagInput(BaseModel):
    q: str = Field(..., min_length=2, max_length=2000)
    k: int = Field(default=5, ge=1, le=50)
    owner_id: str = "manager"


class CodeInput(BaseModel):
    lang: str = Field(default="python")
    source: str = Field(..., min_length=1)
    stdin: str | None = None
