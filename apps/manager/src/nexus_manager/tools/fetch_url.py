"""Fetch and extract the readable content of a page.

httpx plus Trafilatura handles static HTML. When extraction yields too little text the page
is almost certainly rendered client-side, so the caller is told to escalate to the browser
rather than being handed an empty result.
"""

from __future__ import annotations

from urllib.parse import urljoin, urlparse

import httpx
import structlog

from ..config import Settings, settings as default_settings
from ..safety.guards import RateLimiter, RobotsCache, URLBlocked, check_url
from .schemas import Page, PageResult, UrlInput

log = structlog.get_logger(__name__)

# Below this many characters the extraction is treated as a miss worth escalating.
MIN_USEFUL_CHARS = 200


def _extract_links(html: str, base_url: str, limit: int = 40) -> list[str]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    seen: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor["href"]).strip()
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        absolute = urljoin(base_url, href)
        if urlparse(absolute).scheme not in {"http", "https"}:
            continue
        if absolute not in seen:
            seen.append(absolute)
        if len(seen) >= limit:
            break
    return seen


def extract_page(html: str, url: str) -> Page:
    """Run Trafilatura over raw HTML. Kept separate so it can be tested without network."""
    import trafilatura
    from trafilatura.settings import use_config

    config = use_config()
    config.set("DEFAULT", "EXTRACTION_TIMEOUT", "0")

    text = trafilatura.extract(
        html, include_comments=False, include_tables=True, favor_recall=True, config=config
    ) or ""

    title = ""
    published = None
    try:
        meta = trafilatura.extract_metadata(html)
        if meta is not None:
            title = meta.title or ""
            published = meta.date
    except Exception:
        pass

    if not title:
        from bs4 import BeautifulSoup

        node = BeautifulSoup(html, "html.parser").find("title")
        title = node.get_text().strip() if node else ""

    return Page(
        url=url,
        title=title,
        text=text.strip(),
        links=_extract_links(html, url),
        published_at=published,
        fetched_with="trafilatura",
    )


async def fetch_url(
    url: str,
    *,
    settings: Settings | None = None,
    robots: RobotsCache | None = None,
    limiter: RateLimiter | None = None,
) -> PageResult:
    """Fetch one page. Returns ok=False with a reason rather than raising."""
    cfg = settings or default_settings
    try:
        target = str(UrlInput(url=url).url)
    except Exception as exc:
        return PageResult(ok=False, error=f"invalid url: {exc}")

    try:
        check_url(target)
    except URLBlocked as exc:
        return PageResult(ok=False, error=str(exc))

    guard = robots or RobotsCache(cfg)
    if not await guard.allowed(target):
        return PageResult(ok=False, error=f"robots.txt disallows fetching {target}")

    await (limiter or RateLimiter(cfg)).acquire(target)

    headers = {"User-Agent": cfg.user_agent, "Accept": "text/html,application/xhtml+xml"}
    try:
        async with httpx.AsyncClient(
            timeout=cfg.tool_timeout_s, follow_redirects=True, headers=headers
        ) as client:
            resp = await client.get(target)
    except httpx.HTTPError as exc:
        return PageResult(ok=False, error=f"transport error fetching {target}: {exc}")

    if resp.status_code == 401 or resp.status_code == 403:
        return PageResult(ok=False, error=f"{target} requires authentication ({resp.status_code}); not fetched")
    if resp.status_code >= 400:
        return PageResult(ok=False, error=f"{target} returned {resp.status_code}")

    content_type = resp.headers.get("content-type", "")
    if "html" not in content_type and "xml" not in content_type and "text" not in content_type:
        return PageResult(ok=False, error=f"{target} is {content_type or 'an unsupported type'}, not a readable page")

    page = extract_page(resp.text, str(resp.url))
    if len(page.text) < MIN_USEFUL_CHARS:
        return PageResult(
            ok=False,
            page=page,
            error=(
                f"static extraction produced {len(page.text)} characters; "
                "the page is likely rendered client-side and needs the browser"
            ),
        )
    return PageResult(page=page)
