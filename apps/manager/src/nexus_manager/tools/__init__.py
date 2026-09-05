"""Tool registry.

Every tool is reached through `ToolRegistry.call`, which supplies the three things the spec
requires of a tool invocation and which are easy to forget when calling functions directly:
a timeout, a retry policy, and an idempotency key that collapses repeat calls with identical
arguments within one run.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import time
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from pydantic import BaseModel, ValidationError

from ..config import Settings
from ..config import settings as default_settings
from ..observability import metrics
from ..safety.guards import RateLimiter, RobotsCache
from .browse import browse
from .code_exec import code_exec
from .fetch_url import fetch_url
from .rag_query import rag_query
from .schemas import (
    BrowseInput,
    Chunk,
    CodeInput,
    ExecResult,
    Page,
    PageResult,
    RagInput,
    RagResult,
    SearchHit,
    SearchInput,
    SearchResult,
    Segment,
    ToolError,
    UrlInput,
    Video,
    VideoResult,
)
from .web_search import web_search
from .youtube import youtube_transcript

log = structlog.get_logger(__name__)

__all__ = [
    "BrowseInput",
    "Chunk",
    "CodeInput",
    "ExecResult",
    "Page",
    "PageResult",
    "RagInput",
    "RagResult",
    "SearchHit",
    "SearchInput",
    "SearchResult",
    "Segment",
    "ToolError",
    "ToolRegistry",
    "UrlInput",
    "Video",
    "VideoResult",
    "browse",
    "code_exec",
    "fetch_url",
    "rag_query",
    "web_search",
    "youtube_transcript",
]

# Tools whose failure is worth another attempt. Search and fetch hit flaky remote hosts;
# code execution is deterministic, so re-running it only wastes sandbox capacity.
_RETRYABLE_TOOLS = {"web_search", "fetch_url", "browse", "rag_query", "youtube_transcript"}


def idempotency_key(tool: str, kwargs: dict[str, Any]) -> str:
    """Stable hash of a call's arguments, used to collapse duplicate work inside one run."""
    payload = json.dumps(kwargs, sort_keys=True, default=str)
    return f"{tool}:{hashlib.sha256(payload.encode()).hexdigest()[:16]}"


class ToolRegistry:
    """Shared entry point for tool calls within a single run.

    Holds one RobotsCache and one RateLimiter so the per-domain limit is genuinely per
    domain across every worker, rather than per worker.
    """

    def __init__(self, settings: Settings | None = None, redis_client=None) -> None:
        self._settings = settings or default_settings
        self._robots = RobotsCache(self._settings, redis_client)
        self._limiter = RateLimiter(self._settings, redis_client)
        self._results: dict[str, Any] = {}

        self._tools: dict[str, Callable[..., Awaitable[BaseModel]]] = {
            "web_search": self._web_search,
            "fetch_url": self._fetch_url,
            "browse": self._browse,
            "youtube_transcript": self._youtube,
            "rag_query": self._rag,
            "code_exec": self._code,
        }

    @property
    def names(self) -> list[str]:
        return sorted(self._tools)

    # ─── Bound tool implementations ─────────────────────────────

    async def _web_search(self, query: str, k: int = 5) -> SearchResult:
        return await web_search(query, k, settings=self._settings)

    async def _fetch_url(self, url: str) -> PageResult:
        return await fetch_url(url, settings=self._settings, robots=self._robots, limiter=self._limiter)

    async def _browse(self, url: str, wait_for: str | None = None) -> PageResult:
        return await browse(
            url, wait_for, settings=self._settings, robots=self._robots, limiter=self._limiter
        )

    async def _youtube(self, video_url: str) -> VideoResult:
        return await youtube_transcript(video_url, settings=self._settings)

    async def _rag(self, q: str, k: int = 5, owner_id: str = "manager") -> RagResult:
        return await rag_query(q, k, owner_id=owner_id, settings=self._settings)

    async def _code(self, lang: str, source: str, stdin: str | None = None) -> ExecResult:
        return await code_exec(lang, source, stdin, settings=self._settings)

    # ─── Invocation ─────────────────────────────────────────────

    async def call(self, tool: str, /, **kwargs: Any) -> BaseModel:
        """Invoke a tool with timeout, retries and idempotency.

        Never raises: an unknown tool, a timeout or an exhausted retry budget all come back
        as a result object whose `ok` is False.
        """
        if tool not in self._tools:
            return ToolError(tool=tool, message=f"unknown tool {tool!r}; available: {self.names}")

        key = idempotency_key(tool, kwargs)
        if key in self._results:
            log.debug("tool_cache_hit", tool=tool, key=key)
            return self._results[key]

        attempts = self._settings.tool_max_retries if tool in _RETRYABLE_TOOLS else 1
        timeout = self._settings.tool_timeout_s
        # The browser and the sandbox are legitimately slower than an HTTP GET.
        if tool == "browse":
            timeout = max(timeout, 60.0)
        elif tool == "code_exec":
            timeout = max(timeout, 60.0)

        started = time.perf_counter()
        last_error = "unknown error"
        for attempt in range(1, attempts + 1):
            try:
                result = await asyncio.wait_for(self._tools[tool](**kwargs), timeout=timeout)
            except TimeoutError:
                last_error = f"{tool} timed out after {timeout:.0f}s"
            except (TypeError, ValidationError) as exc:
                # Wrong or malformed arguments will not improve on a retry.
                metrics.tool_calls_total.labels(tool, "bad_arguments").inc()
                return ToolError(tool=tool, message=f"invalid arguments for {tool}: {exc}")
            except Exception as exc:
                last_error = f"{tool} raised {type(exc).__name__}: {exc}"
            else:
                elapsed = int((time.perf_counter() - started) * 1000)
                ok = bool(getattr(result, "ok", True))
                metrics.tool_latency_ms.labels(tool).observe(elapsed)
                metrics.tool_calls_total.labels(tool, "success" if ok else "failed").inc()
                if ok:
                    self._results[key] = result
                return result

            if attempt < attempts:
                delay = 0.5 * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
                log.warning("tool_retry", tool=tool, attempt=attempt, error=last_error[:200])
                await asyncio.sleep(delay)

        metrics.tool_latency_ms.labels(tool).observe(int((time.perf_counter() - started) * 1000))
        metrics.tool_calls_total.labels(tool, "error").inc()
        return ToolError(tool=tool, message=last_error, retryable=True)
