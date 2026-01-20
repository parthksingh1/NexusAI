from __future__ import annotations

import os

import httpx


_NOTION = "https://api.notion.com/v1"
_VER = "2022-06-28"


async def fetch_notion_page(page_id: str) -> tuple[str, str, str]:
    """Return (title, url, body_markdown). Requires NOTION_TOKEN."""
    token = os.getenv("NOTION_TOKEN")
    if not token:
        raise RuntimeError("NOTION_TOKEN not set")
    headers = {"authorization": f"Bearer {token}", "notion-version": _VER}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as c:
        page = (await c.get(f"{_NOTION}/pages/{page_id}")).json()
        blocks = (await c.get(f"{_NOTION}/blocks/{page_id}/children?page_size=100")).json()

    title = _extract_title(page) or "Notion page"
    url = page.get("url", "")
    body_lines: list[str] = []
    for b in blocks.get("results", []):
        body_lines.append(_block_to_md(b))
    return title, url, "\n".join(body_lines)


def _extract_title(page: dict) -> str | None:
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "title":
            parts = prop.get("title") or []
            if parts:
                return "".join(p.get("plain_text", "") for p in parts)
    return None


def _rich_text(parts: list[dict]) -> str:
    return "".join(p.get("plain_text", "") for p in parts or [])


def _block_to_md(b: dict) -> str:
    t = b.get("type", "")
    data = b.get(t, {})
    text = _rich_text(data.get("rich_text", []))
    if t == "paragraph": return text
    if t == "heading_1": return f"# {text}"
    if t == "heading_2": return f"## {text}"
    if t == "heading_3": return f"### {text}"
    if t == "bulleted_list_item": return f"- {text}"
    if t == "numbered_list_item": return f"1. {text}"
    if t == "to_do": return f"- [ ] {text}"
    if t == "code":
        lang = data.get("language", "")
        return f"```{lang}\n{text}\n```"
    if t == "quote": return f"> {text}"
    return text
