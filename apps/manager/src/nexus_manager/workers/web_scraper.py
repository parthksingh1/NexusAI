"""Web scraper.

Reads specific pages and pulls structured content out of them. Static extraction is tried
first; the browser is used only when the static path reports the page is rendered
client-side, because launching Chromium costs seconds that a worker timeout cannot spare
unnecessarily.
"""

from __future__ import annotations

from nexus_agents_shared import Task, WorkerResult
from pydantic import BaseModel, Field, create_model

from .base import BaseWorker, WorkerContext

MAX_PAGES = 3
PAGE_EXCERPT_CHARS = 6000

SYSTEM = """You pull requested information out of page content that is given to you.

Rules:
- Use only the supplied page content. Do not add anything from your own knowledge.
- When a field is not present in the content, leave it empty rather than guessing.
- Keep values concise and factual.
"""


class ExtractedItem(BaseModel):
    field: str
    value: str


class ExtractionOutput(BaseModel):
    summary: str
    items: list[ExtractedItem] = Field(default_factory=list)


def build_extraction_model(schema: dict) -> type[BaseModel]:
    """Turn a task-supplied field map into a Pydantic model.

    `schema` maps a field name to a plain-language description. Only string fields are
    produced: a model asked for a typed value it cannot find will invent one, and an empty
    string is an honest miss.
    """
    fields = {
        str(name): (str, Field(default="", description=str(description)))
        for name, description in schema.items()
        if str(name).isidentifier()
    }
    if not fields:
        return ExtractionOutput
    return create_model("RequestedExtraction", **fields)  # type: ignore[call-overload]


class WebScraperWorker(BaseWorker):
    name = "web_scraper"

    def _urls_for(self, task: Task, ctx: WorkerContext) -> list[str]:
        raw = task.inputs.get("urls") or task.inputs.get("url")
        urls = [raw] if isinstance(raw, str) else list(raw or [])
        if urls:
            return [u for u in urls if isinstance(u, str) and u.startswith("http")][:MAX_PAGES]

        # No URL was planned. Reuse anything an upstream task already cited.
        inherited: list[str] = []
        for result in (ctx.upstream or {}).values():
            inherited.extend(c for c in result.citations if c.startswith("http"))
        return list(dict.fromkeys(inherited))[:MAX_PAGES]

    async def run(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        urls = self._urls_for(task, ctx)

        if not urls:
            await self.step(ctx, task, "no page named; searching for one")
            search = await ctx.tools.call("web_search", query=task.goal, k=4)
            if getattr(search, "ok", False):
                urls = [h.url for h in search.hits[:MAX_PAGES]]

        if not urls:
            return WorkerResult(ok=False, error=f"no page could be identified for: {task.goal}")

        pages = []
        for url in urls:
            await self.step(ctx, task, "reading page", url=url)
            result = await ctx.tools.call("fetch_url", url=url)
            page = getattr(result, "page", None)

            if not getattr(result, "ok", False):
                reason = getattr(result, "error", "") or getattr(result, "message", "")
                if "client-side" in reason:
                    await self.step(ctx, task, "page is client-rendered; using the browser", url=url)
                    result = await ctx.tools.call("browse", url=url)
                    page = getattr(result, "page", None)
                else:
                    await self.step(ctx, task, f"skipped {url}", reason=reason[:200])
                    continue

            if getattr(result, "ok", False) and page and page.text:
                pages.append(page)

        if not pages:
            return WorkerResult(ok=False, error=f"none of the {len(urls)} candidate page(s) could be read")

        content = "\n\n".join(
            f"PAGE: {p.url}\nTITLE: {p.title}\nCONTENT:\n{p.text[:PAGE_EXCERPT_CHARS]}" for p in pages
        )
        schema = task.inputs.get("schema")
        model = build_extraction_model(schema) if isinstance(schema, dict) and schema else ExtractionOutput
        user = f"REQUESTED: {task.goal}\n\nPAGE CONTENT:\n{content}"

        await self.step(ctx, task, "extracting requested content", pages=len(pages))
        parsed, tokens, cost = await self.think_structured(ctx, SYSTEM, user, model, max_tokens=1400)

        return WorkerResult(
            ok=True,
            output={
                "pages": [p.model_dump() | {"text": p.text[:2000]} for p in pages],
                "extracted": parsed.model_dump(),
            },
            citations=[p.url for p in pages],
            tokens_used=tokens,
            cost_usd=cost,
        )
