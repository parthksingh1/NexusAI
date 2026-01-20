from __future__ import annotations

import re

import httpx


_SCRIPT_STYLE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


async def fetch_url(url: str, max_bytes: int = 2_000_000) -> tuple[str, str]:
    """Fetch a URL and return (title, plain_text). Minimal HTML stripping; phase 3 swaps in readability."""
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers={"user-agent": "NexusAI/1.0"}) as c:
        r = await c.get(url)
        r.raise_for_status()
        html = r.text[:max_bytes]

    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = (title_match.group(1).strip() if title_match else url)[:200]

    body = _SCRIPT_STYLE.sub(" ", html)
    body = _TAG.sub(" ", body)
    body = _WS.sub(" ", body).strip()
    return title, body
