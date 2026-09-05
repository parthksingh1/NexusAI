"""Run state carried through the graph.

`results` uses a merging reducer because LangGraph fans parallel nodes out and merges their
returned state back in. Without a reducer, two nodes finishing in the same superstep would
each write a whole `results` dict and one would overwrite the other.
"""

from __future__ import annotations

import operator
from typing import Annotated, TypedDict

from nexus_agents_shared import BudgetSnapshot, Plan, WorkerResult


def merge_results(left: dict[str, WorkerResult], right: dict[str, WorkerResult]) -> dict[str, WorkerResult]:
    """Combine results from concurrently-executed nodes."""
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def keep_last(left, right):
    """Last writer wins. Used for scalars that only the terminal node sets."""
    return right if right is not None else left


class RunState(TypedDict, total=False):
    run_id: str
    goal: str
    plan: Plan
    results: Annotated[dict[str, WorkerResult], merge_results]
    budget: Annotated[BudgetSnapshot | None, keep_last]
    started_at: float
    halted: Annotated[bool, keep_last]
    """Set when a budget cap is hit. Remaining nodes short-circuit rather than spending more."""

    halt_reason: Annotated[str | None, keep_last]
    answer: Annotated[str | None, keep_last]
    citations: Annotated[list[str], keep_last]


__all__ = ["RunState", "keep_last", "merge_results"]
