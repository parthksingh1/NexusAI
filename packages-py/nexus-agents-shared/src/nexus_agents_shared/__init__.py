"""Shared Pydantic contracts for NexusAI multi-agent services."""

from .events import CHANNEL_PREFIX, EventKind, RunEvent, run_channel
from .plan import (
    TASK_ID_PATTERN,
    BudgetSnapshot,
    Plan,
    RunResult,
    RunStatus,
    Task,
    TaskType,
    WorkerResult,
)

__all__ = [
    "BudgetSnapshot",
    "CHANNEL_PREFIX",
    "EventKind",
    "Plan",
    "RunEvent",
    "RunResult",
    "RunStatus",
    "TASK_ID_PATTERN",
    "Task",
    "TaskType",
    "WorkerResult",
    "run_channel",
]
