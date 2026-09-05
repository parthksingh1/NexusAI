"""Web search.

Two backends behind one result shape. Tavily is used when TAVILY_API_KEY is set; otherwise
the DuckDuckGo HTML endpoint is used, which needs no key or account. Both return SearchHit,
so callers never branch on which one ran.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx
import structlog
from bs4 import BeautifulSoup

from ..config import Settings
from ..config import settings as default_settings
from .schemas import SearchHit, SearchInput, SearchResult

log = structlog.get_logger(__name__)

TAVILY_ENDPOINT = "https://api.tavily.com/search"
DDG_ENDPOINT = "https://html.duckduckgo.com/html/"


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _unwrap_ddg(href: str) -> str:
    """DuckDuckGo wraps results as /l/?uddg=<encoded>. Recover the real destination."""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [])
        if target:
            return unquote(target[0])
    return href


async def _search_tavily(inp: SearchInput, settings: Settings) -> SearchResult:
    payload = {
        "api_key": settings.tavily_api_key,
        "query": inp.query,
        "max_results": inp.k,
        "search_depth": "basic",
    }
    async with httpx.AsyncClient(timeout=settings.tool_timeout_s) as client:
        resp = await client.post(TAVILY_ENDPOINT, json=payload)
    if resp.status_code >= 400:
        return SearchResult(
            ok=False, query=inp.query, provider="tavily", error=f"tavily returned {resp.status_code}: {resp.text[:200]}"
        )
    hits = [
        SearchHit(
            url=item.get("url", ""),
            title=_clean(item.get("title", "")),
            snippet=_clean(item.get("content", ""))[:600],
            score=float(item.get("score") or 0.0),
        )
        for item in resp.json().get("results", [])
        if item.get("url")
    ]
    return SearchResult(query=inp.query, provider="tavily", hits=hits[: inp.k])


async def _search_duckduckgo(inp: SearchInput, settings: Settings) -> SearchResult:
    headers = {
        "User-Agent": settings.user_agent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(timeout=settings.tool_timeout_s, follow_redirects=True, headers=headers) as client:
        resp = await client.post(DDG_ENDPOINT, data={"q": inp.query})
    if resp.status_code >= 400:
        return SearchResult(
            ok=False,
            query=inp.query,
            provider="duckduckgo",
            error=f"duckduckgo returned {resp.status_code}",
        )

    soup = BeautifulSoup(resp.text, "html.parser")
    hits: list[SearchHit] = []
    for node in soup.select("div.result, div.web-result"):
        link = node.select_one("a.result__a")
        if not link or not link.get("href"):
            continue
        url = _unwrap_ddg(str(link["href"]))
        if not url.startswith("http"):
            continue
        snippet_node = node.select_one(".result__snippet")
        hits.append(
            SearchHit(
                url=url,
                title=_clean(link.get_text()),
                snippet=_clean(snippet_node.get_text() if snippet_node else "")[:600],
                # Rank-derived score so callers can order results uniformly across backends.
                score=round(1.0 - len(hits) / max(inp.k, 1) * 0.5, 4),
            )
        )
        if len(hits) >= inp.k:
            break

    if not hits:
        return SearchResult(ok=False, query=inp.query, provider="duckduckgo", error="no results parsed from response")
    return SearchResult(query=inp.query, provider="duckduckgo", hits=hits)


def resolve_backend(settings: Settings) -> str:
    if settings.search_provider == "tavily":
        return "tavily"
    if settings.search_provider == "duckduckgo":
        return "duckduckgo"
    return "tavily" if settings.tavily_api_key else "duckduckgo"


async def web_search(query: str, k: int = 5, *, settings: Settings | None = None) -> SearchResult:
    """Search the web. Returns ok=False with a reason rather than raising."""
    cfg = settings or default_settings
    inp = SearchInput(query=query, k=k)
    backend = resolve_backend(cfg)
    try:
        if backend == "tavily":
            result = await _search_tavily(inp, cfg)
            if result.ok:
                return result
            # A Tavily outage or exhausted quota should not end the run when a keyless
            # backend is available.
            log.warning("tavily_failed_falling_back", error=result.error)
            return await _search_duckduckgo(inp, cfg)
        return await _search_duckduckgo(inp, cfg)
    except httpx.HTTPError as exc:
        return SearchResult(ok=False, query=query, provider=backend, error=f"search transport error: {exc}")
