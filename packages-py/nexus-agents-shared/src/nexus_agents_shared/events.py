"""Event contracts for streaming a run to the UI, the CLI, and Kafka.

A single `RunEvent` type carries every transition. Consumers switch on `kind` and read the
matching payload shape documented below, so adding a new event kind never breaks an
existing consumer's parsing.
"""

from __future__ import annotations

import time
from typing import Literal

from pydantic import BaseModel, Field

EventKind = Literal[
    "plan",
    "worker_start",
    "worker_step",
    "worker_done",
    "worker_error",
    "budget_warn",
    "budget_exceeded",
    "synthesis",
    "done",
    "error",
]


class RunEvent(BaseModel):
    """One transition in a run.

    Payload shapes by kind:
      plan             {"plan": Plan}
      worker_start     {"task_id", "task_type", "goal"}
      worker_step      {"task_id", "message", "detail"?}
      worker_done      {"task_id", "result": WorkerResult}
      worker_error     {"task_id", "error"}
      budget_warn      {"snapshot": BudgetSnapshot, "message"}
      budget_exceeded  {"snapshot": BudgetSnapshot, "reason"}
      synthesis        {"answer", "citations"}
      done             {"status", "answer"?, "citations"?}
      error            {"error"}
    """

    run_id: str
    ts: float = Field(default_factory=time.time)
    kind: EventKind
    payload: dict = Field(default_factory=dict)

    def to_sse(self) -> str:
        """Serialise as a Server-Sent Event frame.

        Deliberately unnamed. A frame carrying an `event:` line dispatches only to a
        matching addEventListener and never fires EventSource.onmessage, so naming the
        frame after its kind would silently deliver nothing to a consumer using onmessage —
        which is exactly how the live graph in the web UI stopped updating. The payload
        already carries `kind`, which is the real discriminator, and leaving frames unnamed
        means a new kind never requires a change in the consumer.
        """
        return f"data: {self.model_dump_json()}\n\n"


CHANNEL_PREFIX = "run"


def run_channel(run_id: str) -> str:
    """Redis pub/sub channel carrying every event for one run."""
    return f"{CHANNEL_PREFIX}:{run_id}"
