"""Synthesizer.

Merges every upstream result into the final answer. It has no tools: everything it can say
must already be present in what the other workers produced.

It runs even when upstream workers failed, so a run that lost its video step still returns
the research. `confidence` reflects how much of the plan actually succeeded, computed from
the results rather than asked of the model, which has no basis for the judgement.
"""

from __future__ import annotations

import json

from nexus_agents_shared import Task, WorkerResult
from pydantic import BaseModel, Field

from .base import BaseWorker, WorkerContext

CONTEXT_BUDGET_CHARS = 14000

SYSTEM = """You write the final answer from findings other agents gathered.

Rules:
- Use only the supplied findings. Do not add knowledge of your own.
- Cite sources inline as [1], [2] and so on, numbered against the SOURCES list you are given.
- Every factual claim carries a citation.
- Where the findings conflict, say so rather than picking one silently.
- Where the findings do not cover part of the question, say what is missing. A stated gap is
  more useful than a confident guess.
- Write prose or a table, whichever suits the question. Do not open with a preamble about
  what you are about to do.
"""


class SynthesisOutput(BaseModel):
    answer: str = Field(default="")
    used_sources: list[int] = Field(default_factory=list)
    """1-based indices into the SOURCES list that the answer actually relies on."""


def _summarise(result: WorkerResult) -> str:
    """Compact one worker's output for the synthesis prompt."""
    output = result.output or {}
    parts: list[str] = []

    if summary := output.get("summary"):
        parts.append(str(summary))
    for finding in output.get("findings", [])[:12]:
        claim = finding.get("claim", "") if isinstance(finding, dict) else ""
        source = finding.get("source", "") if isinstance(finding, dict) else ""
        if claim:
            parts.append(f"- {claim} ({source})")
    if extracted := output.get("extracted"):
        parts.append("Extracted: " + json.dumps(extracted, default=str)[:1500])
    for moment in output.get("key_moments", [])[:10]:
        if isinstance(moment, dict) and moment.get("text"):
            parts.append(f"- [{moment.get('ts', 0):.0f}s] {moment['text']}")
    for item in output.get("action_items", [])[:10]:
        parts.append(f"- action: {item}")
    if code := output.get("code"):
        verified = "verified" if output.get("verified") else "not verified"
        parts.append(f"Program ({verified}):\n{str(code)[:2000]}")
        if stdout := output.get("stdout"):
            parts.append(f"Program output:\n{str(stdout)[:800]}")

    return "\n".join(parts).strip()


class SynthesizerWorker(BaseWorker):
    name = "synthesizer"

    async def run(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        upstream = ctx.upstream or {}
        succeeded = {tid: r for tid, r in upstream.items() if r.ok}
        failed = {tid: r for tid, r in upstream.items() if not r.ok}

        if not succeeded:
            reasons = "; ".join(f"{tid}: {r.error}" for tid, r in failed.items()) or "no upstream tasks ran"
            return WorkerResult(ok=False, error=f"nothing to synthesise — every upstream task failed ({reasons})")

        sources: list[str] = []
        for result in succeeded.values():
            for citation in result.citations:
                if citation and citation not in sources:
                    sources.append(citation)

        blocks: list[str] = []
        used = 0
        for task_id, result in succeeded.items():
            block = _summarise(result)
            if not block:
                continue
            entry = f"--- FINDINGS FROM {task_id} ---\n{block}"
            if used + len(entry) > CONTEXT_BUDGET_CHARS:
                break
            blocks.append(entry)
            used += len(entry)

        if not blocks:
            return WorkerResult(
                ok=False, error="upstream tasks succeeded but produced no content to synthesise"
            )

        source_list = "\n".join(f"[{i}] {url}" for i, url in enumerate(sources, start=1))
        gaps = ""
        if failed:
            missing = "; ".join(f"{tid} ({r.error})" for tid, r in failed.items())
            gaps = f"\n\nTASKS THAT DID NOT COMPLETE, so their material is absent: {missing}"

        user = (
            f"QUESTION: {ctx.goal or task.goal}\n\n"
            f"SOURCES:\n{source_list or '(none)'}\n\n" + "\n\n".join(blocks) + gaps
        )

        await self.step(ctx, task, "writing the final answer", inputs=len(blocks), sources=len(sources))
        parsed, tokens, cost = await self.think_structured(ctx, SYSTEM, user, SynthesisOutput, max_tokens=2000)

        answer = parsed.answer.strip()
        if not answer:
            return WorkerResult(ok=False, error="the model returned an empty answer", tokens_used=tokens, cost_usd=cost)

        cited = [sources[i - 1] for i in parsed.used_sources if 1 <= i <= len(sources)]
        citations = cited or sources

        # Confidence is derived, not asserted: the share of planned work that succeeded,
        # discounted when the answer rests on nothing citable.
        completion = len(succeeded) / max(1, len(upstream))
        confidence = round(completion * (1.0 if citations else 0.4), 2)

        return WorkerResult(
            ok=True,
            output={
                "answer": answer,
                "citations": citations,
                "confidence": confidence,
                "tasks_used": list(succeeded),
                "tasks_failed": list(failed),
            },
            citations=citations,
            tokens_used=tokens,
            cost_usd=cost,
        )
