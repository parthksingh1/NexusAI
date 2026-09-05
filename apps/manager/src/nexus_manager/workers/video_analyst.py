"""Video analyst.

Reads a public YouTube transcript and summarises it with real timestamps. Key moments carry
the transcript timestamp they came from, so a claim about the video can be checked against
the video.
"""

from __future__ import annotations

import re

from nexus_agents_shared import Task, WorkerResult
from pydantic import BaseModel, Field

from .base import BaseWorker, WorkerContext

TRANSCRIPT_BUDGET_CHARS = 12000

SYSTEM = """You summarise a talk from its transcript.

The transcript is given as lines prefixed with a timestamp in seconds, like [123.4].

Rules:
- Use only what the transcript says.
- Each key moment carries the timestamp of the transcript line it came from, as a number of
  seconds. Copy it from the transcript; do not estimate.
- Action items are concrete things a viewer could do. If the talk has none, return an empty
  list rather than inventing any.
"""

_URL_RE = re.compile(r"https?://\S*(?:youtube\.com|youtu\.be)\S*")


class KeyMoment(BaseModel):
    ts: float
    text: str


class VideoOutput(BaseModel):
    # Required so the decoder cannot skip the field that carries the answer.
    summary: str
    key_moments: list[KeyMoment] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)


def _timestamp_url(video_id: str, seconds: float) -> str:
    return f"https://www.youtube.com/watch?v={video_id}&t={int(seconds)}s"


def find_video_url(task: Task, ctx: WorkerContext) -> str | None:
    """Locate the video: the task inputs first, then the goal text, then the run goal."""
    candidate = task.inputs.get("url") or task.inputs.get("video_url")
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    for text in (task.goal, ctx.goal):
        match = _URL_RE.search(text or "")
        if match:
            return match.group(0)
    return None


class VideoAnalystWorker(BaseWorker):
    name = "video_analyst"

    async def run(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        url = find_video_url(task, ctx)
        if not url:
            return WorkerResult(
                ok=False, error="no YouTube URL was supplied in the task inputs or found in the goal"
            )

        await self.step(ctx, task, "fetching transcript", url=url)
        result = await ctx.tools.call("youtube_transcript", video_url=url)
        if not getattr(result, "ok", False):
            reason = getattr(result, "error", None) or getattr(result, "message", "transcript unavailable")
            return WorkerResult(ok=False, error=reason)

        video = result.video
        await self.step(
            ctx, task, f"read {len(video.transcript)} transcript segments", title=video.title, channel=video.channel
        )

        lines: list[str] = []
        used = 0
        for segment in video.transcript:
            line = f"[{segment.start_s:.1f}] {segment.text}"
            if used + len(line) > TRANSCRIPT_BUDGET_CHARS:
                break
            lines.append(line)
            used += len(line)
        truncated = len(lines) < len(video.transcript)

        header = f"TITLE: {video.title}\nCHANNEL: {video.channel}\nDURATION: {video.duration_s}s"
        note = "\n\n(The transcript is truncated; summarise what is present.)" if truncated else ""
        user = f"{header}\n\nTASK: {task.goal}\n\nTRANSCRIPT:\n" + "\n".join(lines) + note

        await self.step(ctx, task, "summarising")
        parsed, tokens, cost = await self.think_structured(ctx, SYSTEM, user, VideoOutput, max_tokens=1400)

        # Keep only timestamps that fall inside the video.
        upper = float(video.duration_s or (video.transcript[-1].start_s + 1))
        moments = [
            {"ts": m.ts, "text": m.text.strip(), "url": _timestamp_url(video.id, m.ts)}
            for m in parsed.key_moments
            if m.text.strip() and 0 <= m.ts <= upper
        ]

        citations = [video.url] + [m["url"] for m in moments[:5]]
        return WorkerResult(
            ok=True,
            output={
                "video_meta": {
                    "id": video.id,
                    "title": video.title,
                    "channel": video.channel,
                    "duration_s": video.duration_s,
                    "url": video.url,
                    "transcript_segments": len(video.transcript),
                    "transcript_truncated": truncated,
                },
                "summary": parsed.summary.strip(),
                "key_moments": moments,
                "action_items": [a.strip() for a in parsed.action_items if a.strip()],
            },
            citations=list(dict.fromkeys(citations)),
            tokens_used=tokens,
            cost_usd=cost,
        )
