"""Planner schemas.

`Plan`, `Task` and `TaskType` live in nexus-agents-shared so the web UI and CLI consume the
same definitions, and are re-exported here.

`PlanDraft` is the shape the model is actually asked for. It is deliberately permissive: no
DAG validation, no id pattern, no task ceiling. A strict `Plan` rejects dangling
dependencies and cycles at construction, which is right for the execution contract but wrong
for a model's first attempt — it would turn every routine formatting slip into a failed run.
The planner repairs a draft and only then builds the strict `Plan`.
"""

from __future__ import annotations

from nexus_agents_shared import Plan, Task, TaskType
from pydantic import BaseModel, Field

__all__ = ["Plan", "PlanDraft", "Task", "TaskDraft", "TaskType"]


class TaskDraft(BaseModel):
    id: str = ""
    type: TaskType = TaskType.RESEARCH
    goal: str = ""
    inputs: dict = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    parallel_group: int = 0


class PlanDraft(BaseModel):
    goal: str = ""
    reasoning: str = ""
    tasks: list[TaskDraft] = Field(default_factory=list)
    estimated_cost_usd: float = 0.0
    requires_synthesis: bool = True
