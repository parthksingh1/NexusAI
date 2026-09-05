"""Researcher.

Searches, reads the most promising results, and extracts claims that each carry the source
they came from. A claim without a source is dropped: an unsourced assertion from a model is
exactly what this worker exists to avoid producing.
"""

from __future__ import annotations

import asyncio

from nexus_agents_shared import Task, WorkerResult
from pydantic import BaseModel, Field

from .base import BaseWorker, WorkerContext

MAX_PAGES_READ = 3
PAGE_EXCERPT_CHARS = 3000

SYSTEM = """You extract factual claims from source material and attribute each one.

Rules:
- Every claim must be supported by the provided sources. Do not add knowledge of your own.
- Each claim names the exact source URL it came from, copied from the material.
- If the material does not answer the question, say so in the summary and return few or no
  claims. An honest gap is more useful than an invented answer.
- Keep each claim to one sentence.
"""


class Finding(BaseModel):
    # Required, not defaulted: a schema-constrained decoder treats a defaulted field as
    # optional and omits it, which is how a worker ends up reporting success with nothing
    # in it. Both fields carry the content, so both are mandatory.
    claim: str = Field(..., max_length=600)
    source: str


class ResearchOutput(BaseModel):
    summary: str
    findings: list[Finding] = Field(default_factory=list)


class ResearcherWorker(BaseWorker):
    name = "researcher"

    async def run(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        query = task.inputs.get("query") or task.goal
        tokens = 0
        cost = 0.0

        await self.step(ctx, task, "searching the web", query=query)
        search, rag = await asyncio.gather(
            ctx.tools.call("web_search", query=query, k=6),
            ctx.tools.call("rag_query", q=query, k=4),
        )

        sources: list[tuple[str, str, str]] = []  # (url, title, text)

        if getattr(rag, "ok", False):
            for chunk in getattr(rag, "chunks", []):
                if chunk.text:
                    sources.append((chunk.source or "indexed document", "indexed document", chunk.text))
            if sources:
                await self.step(ctx, task, f"retrieved {len(sources)} indexed passages")

        hits = getattr(search, "hits", []) if getattr(search, "ok", False) else []
        if not hits and not sources:
            reason = getattr(search, "error", None) or getattr(search, "message", "search returned nothing")
            return WorkerResult(ok=False, error=f"no material found for {query!r}: {reason}")

        await self.step(ctx, task, f"found {len(hits)} results", urls=[h.url for h in hits[:5]])

        # Read the top results. Pages are fetched sequentially because the rate limiter
        # serialises same-domain requests anyway, and a failed read is not fatal.
        read = 0
        for hit in hits:
            if read >= MAX_PAGES_READ:
                break
            page_result = await ctx.tools.call("fetch_url", url=hit.url)
            page = getattr(page_result, "page", None)
            if getattr(page_result, "ok", False) and page and page.text:
                sources.append((page.url, page.title or hit.title, page.text[:PAGE_EXCERPT_CHARS]))
                read += 1
                await self.step(ctx, task, f"read {page.title or page.url}", url=page.url)
            else:
                # Fall back to the search snippet so a blocked page still contributes.
                if hit.snippet:
                    sources.append((hit.url, hit.title, hit.snippet))

        if not sources:
            return WorkerResult(ok=False, error=f"every source for {query!r} failed to load")

        material = "\n\n".join(
            f"SOURCE: {url}\nTITLE: {title}\nCONTENT:\n{text}" for url, title, text in sources[:8]
        )
        user = f"QUESTION: {task.goal}\n\nMATERIAL:\n{material}"

        await self.step(ctx, task, "extracting claims from sources")
        parsed, used, spent = await self.think_structured(ctx, SYSTEM, user, ResearchOutput, max_tokens=1400)
        tokens += used
        cost += spent

        known_urls = {url for url, _, _ in sources}
        findings = [
            f for f in parsed.findings if f.claim.strip() and f.source.strip() and f.source in known_urls
        ]
        # A model that cites a URL it was not given has invented it.
        citations = list(dict.fromkeys(f.source for f in findings))
        if not citations:
            citations = [url for url, _, _ in sources[:MAX_PAGES_READ] if url.startswith("http")]

        summary = parsed.summary.strip()
        if not summary and not findings:
            # Sources were gathered but the model returned nothing about them. Reporting
            # success here would hand the synthesizer an empty result and lose the run.
            return WorkerResult(
                ok=False,
                output={"query": query, "sources_read": len(sources)},
                citations=citations,
                error=f"read {len(sources)} source(s) but produced no findings or summary",
                tokens_used=tokens,
                cost_usd=cost,
            )

        return WorkerResult(
            ok=True,
            output={
                "query": query,
                "findings": [f.model_dump() for f in findings],
                "summary": summary,
                "sources_read": len(sources),
            },
            citations=citations,
            tokens_used=tokens,
            cost_usd=cost,
        )
