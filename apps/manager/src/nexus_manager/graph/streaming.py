"""Run events: fan out to Redis, and buffer in process for consumers without Redis.

Every event goes to an in-memory buffer per run and, when Redis is configured, to the
`run:{run_id}` channel. The buffer is what makes a late SSE subscriber work: a client that
connects after the plan was emitted still sees the plan.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict, deque

import structlog
from nexus_agents_shared import RunEvent, run_channel

from ..config import Settings
from ..config import settings as default_settings

log = structlog.get_logger(__name__)

# Events retained per run for late subscribers and for the run detail endpoint.
BUFFER_SIZE = 500


class EventBus:
    """Publishes run events and lets consumers subscribe to a run's stream."""

    def __init__(self, settings: Settings | None = None, redis_client=None) -> None:
        self._settings = settings or default_settings
        self._redis = redis_client
        self._buffers: dict[str, deque[RunEvent]] = defaultdict(lambda: deque(maxlen=BUFFER_SIZE))
        self._subscribers: dict[str, list[asyncio.Queue[RunEvent | None]]] = defaultdict(list)
        self._finished: set[str] = set()

    # ─── Publishing ─────────────────────────────────────────────

    async def publish(self, event: RunEvent) -> None:
        """Record an event and deliver it to every live subscriber.

        Never raises: a failure to notify a listener must not fail the run producing it.
        """
        self._buffers[event.run_id].append(event)

        for queue in list(self._subscribers.get(event.run_id, [])):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                log.warning("event_subscriber_lagging", run_id=event.run_id, kind=event.kind)

        if self._redis is not None:
            try:
                await self._redis.publish(run_channel(event.run_id), event.model_dump_json())
            except Exception as exc:
                log.warning("event_publish_failed", run_id=event.run_id, error=str(exc)[:200])

        if event.kind in {"done", "error"}:
            await self.close(event.run_id)

    def emitter(self, run_id: str):
        """A bound `emit` callable for a worker context."""

        async def emit(event: RunEvent) -> None:
            await self.publish(event)

        return emit

    # ─── Subscribing ────────────────────────────────────────────

    def history(self, run_id: str) -> list[RunEvent]:
        return list(self._buffers.get(run_id, ()))

    def is_finished(self, run_id: str) -> bool:
        return run_id in self._finished

    async def subscribe(self, run_id: str, *, replay: bool = True):
        """Yield events for a run, starting with what has already happened.

        Replaying the buffer first is what lets a browser that connects a second after
        submitting still render the plan and every node that has already run.
        """
        queue: asyncio.Queue[RunEvent | None] = asyncio.Queue(maxsize=BUFFER_SIZE)
        self._subscribers[run_id].append(queue)
        try:
            if replay:
                for event in self.history(run_id):
                    yield event
            if run_id in self._finished:
                return
            while True:
                event = await queue.get()
                if event is None:
                    return
                yield event
        finally:
            listeners = self._subscribers.get(run_id, [])
            if queue in listeners:
                listeners.remove(queue)

    async def close(self, run_id: str) -> None:
        """Signal end-of-stream to every subscriber of this run."""
        self._finished.add(run_id)
        for queue in list(self._subscribers.get(run_id, [])):
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    def forget(self, run_id: str) -> None:
        self._buffers.pop(run_id, None)
        self._subscribers.pop(run_id, None)
        self._finished.discard(run_id)


_bus: EventBus | None = None


def get_bus(settings: Settings | None = None, redis_client=None) -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus(settings, redis_client)
    return _bus


def reset_bus() -> None:
    """Drop the process-wide bus. Used between tests."""
    global _bus
    _bus = None
