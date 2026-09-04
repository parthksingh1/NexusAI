"""Planning contracts shared between the manager service, the CLI and the web UI.

These types are the wire format for a run: the planner emits a `Plan`, the graph executes
its `Task` nodes, and every node reports a `WorkerResult`.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

TASK_ID_PATTERN = r"^t_[a-z0-9]{6}$"


class TaskType(str, Enum):
    RESEARCH = "research"
    SCRAPE = "scrape"
    VIDEO = "video"
    CODE = "code"
    SYNTHESIZE = "synthesize"


class Task(BaseModel):
    id: str = Field(..., pattern=TASK_ID_PATTERN)
    type: TaskType
    goal: str = Field(..., min_length=5, max_length=500)
    inputs: dict = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    parallel_group: int = 0
    """Tasks sharing a group run concurrently. Groups execute in ascending order."""

    @model_validator(mode="after")
    def _no_self_dependency(self) -> Task:
        if self.id in self.depends_on:
            raise ValueError(f"task {self.id} depends on itself")
        return self


class Plan(BaseModel):
    goal: str
    reasoning: str
    """The planner's justification for this decomposition. Kept out of the task list so the
    graph never has to parse prose."""

    tasks: list[Task] = Field(..., min_length=1, max_length=8)
    estimated_cost_usd: float = Field(default=0.0, ge=0.0)
    requires_synthesis: bool = True

    @field_validator("tasks")
    @classmethod
    def _unique_ids(cls, tasks: list[Task]) -> list[Task]:
        ids = [t.id for t in tasks]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"duplicate task ids: {sorted(duplicates)}")
        return tasks

    @model_validator(mode="after")
    def _dependencies_resolve_and_are_acyclic(self) -> Plan:
        known = {t.id for t in self.tasks}
        for task in self.tasks:
            unknown = [d for d in task.depends_on if d not in known]
            if unknown:
                raise ValueError(f"task {task.id} depends on unknown task(s): {unknown}")

        # Kahn's algorithm. A plan with a cycle would deadlock the graph, so it is rejected
        # at the contract boundary rather than at execution time.
        indegree = {t.id: len(t.depends_on) for t in self.tasks}
        dependents: dict[str, list[str]] = {t.id: [] for t in self.tasks}
        for task in self.tasks:
            for dep in task.depends_on:
                dependents[dep].append(task.id)

        queue = [tid for tid, deg in indegree.items() if deg == 0]
        visited = 0
        while queue:
            current = queue.pop()
            visited += 1
            for child in dependents[current]:
                indegree[child] -= 1
                if indegree[child] == 0:
                    queue.append(child)
        if visited != len(self.tasks):
            raise ValueError("plan dependency graph contains a cycle")
        return self

    @property
    def terminal_task(self) -> Task:
        """The node whose output is the run's answer: the synthesis task when present,
        otherwise the task nothing else depends on."""
        synth = [t for t in self.tasks if t.type is TaskType.SYNTHESIZE]
        if synth:
            return synth[-1]
        depended_on = {d for t in self.tasks for d in t.depends_on}
        leaves = [t for t in self.tasks if t.id not in depended_on]
        return leaves[-1] if leaves else self.tasks[-1]


class WorkerResult(BaseModel):
    ok: bool
    output: dict = Field(default_factory=dict)
    citations: list[str] = Field(default_factory=list)
    tokens_used: int = 0
    cost_usd: float = 0.0
    error: str | None = None
    duration_ms: int = 0


class BudgetSnapshot(BaseModel):
    tokens_used: int = 0
    max_tokens: int = 0
    usd_spent: float = 0.0
    max_usd: float = 0.0
    agents_spawned: int = 0
    max_agents: int = 0
    depth: int = 0
    max_depth: int = 0

    @property
    def exhausted(self) -> bool:
        return (
            self.tokens_used >= self.max_tokens
            or self.usd_spent >= self.max_usd
            or self.agents_spawned >= self.max_agents
        )


RunStatus = Literal["queued", "planning", "running", "done", "partial", "error"]


class RunResult(BaseModel):
    run_id: str
    status: RunStatus
    goal: str
    plan: Plan | None = None
    results: dict[str, WorkerResult] = Field(default_factory=dict)
    answer: str | None = None
    citations: list[str] = Field(default_factory=list)
    budget: BudgetSnapshot | None = None
    reason: str | None = None
    """Why a run ended `partial` or `error`."""

    started_at: float = 0.0
    finished_at: float | None = None
