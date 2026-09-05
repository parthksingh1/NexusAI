"""Server-Sent Events framing.

A heartbeat comment is sent when the stream is idle so that proxies and browsers do not
treat a quiet run as a dead connection. LLM work regularly goes a minute without producing
an event, which is long enough for an idle timeout to close the stream.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import structlog
from fastapi import Request

log = structlog.get_logger(__name__)

HEARTBEAT_S = 15.0


async def event_stream(bus, run_id: str, request: Request | None = None) -> AsyncIterator[str]:
    """Yield SSE frames for a run until it finishes or the client goes away."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    async def pump() -> None:
        try:
            async for event in bus.subscribe(run_id):
                await queue.put(event)
        finally:
            await queue.put(None)

    task = asyncio.create_task(pump())
    try:
        while True:
            if request is not None and await request.is_disconnected():
                return
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                return
            yield event.to_sse()
    finally:
        task.cancel()
