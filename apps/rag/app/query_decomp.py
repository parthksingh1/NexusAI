from __future__ import annotations

import asyncio
import json

import google.generativeai as genai

from .config import settings

_configured = False


def _ensure_configured() -> None:
    global _configured
    if _configured or not settings.google_api_key:
        return
    genai.configure(api_key=settings.google_api_key)
    _configured = True


async def decompose_query(query: str, max_subqueries: int = 4) -> list[str]:
    """Break a complex question into 2-4 self-contained sub-queries for multi-hop retrieval.
    Returns [query] if no LLM is available or the question is trivial.
    """
    if not settings.google_api_key:
        return [query]
    if len(query.split()) < 8:
        return [query]

    _ensure_configured()

    def _call() -> str:
        model = genai.GenerativeModel(
            settings.reasoning_model,
            system_instruction=(
                "Decompose complex questions into 2-4 self-contained sub-queries that together "
                "answer the original. Each sub-query must stand on its own (no pronouns referring "
                'to other sub-queries). Reply strictly as JSON: {"subqueries": ["...", "..."]}'
            ),
            generation_config={"temperature": 0.0, "max_output_tokens": 300, "response_mime_type": "application/json"},
        )
        resp = model.generate_content(query)
        return resp.text or "{}"

    try:
        content = await asyncio.to_thread(_call)
        data = json.loads(content)
    except (json.JSONDecodeError, OSError):
        return [query]
    try:
        subs = data.get("subqueries", [])
        subs = [s.strip() for s in subs if isinstance(s, str) and s.strip()]
        return subs[:max_subqueries] if subs else [query]
    except (KeyError, AttributeError):
        return [query]
