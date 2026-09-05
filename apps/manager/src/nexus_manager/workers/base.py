"""Worker base class and shared execution context.

Workers are leaves. A worker may call tools; it may not spawn another worker. Only the
manager creates work, which is what keeps the agent count bounded and the graph acyclic.
"""

from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import structlog
from nexus_agents_shared import RunEvent, Task, WorkerResult

from ..config import Provider, Settings
from ..config import settings as default_settings
from ..llm.models import LLMCallError, Message, ProviderUnavailable
from ..llm.router import LLMRouter
from ..observability import metrics
from ..safety.budget import BudgetExceeded, BudgetTracker
from ..tools import ToolRegistry

log = structlog.get_logger(__name__)

EmitFn = Callable[[RunEvent], Awaitable[None]]


@dataclass
class WorkerContext:
    run_id: str
    llm: LLMRouter
    tools: ToolRegistry
    budget: BudgetTracker
    emit: EmitFn
    provider: Provider
    settings: Settings = field(default_factory=lambda: default_settings)
    goal: str = ""
    upstream: dict[str, WorkerResult] | None = None
    """Results of the tasks this one depends on, keyed by task id."""


class BaseWorker(ABC):
    """One specialist agent.

    Subclasses implement `run`. `execute` wraps it with the timeout, event emission,
    budget accounting and error handling every worker needs, so no subclass has to
    remember them.
    """

    name: str = "worker"

    @abstractmethod
    async def run(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        """Do the work. May raise; `execute` converts failures into a WorkerResult."""

    async def execute(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        started = time.perf_counter()
        await ctx.emit(
            RunEvent(
                run_id=ctx.run_id,
                kind="worker_start",
                payload={"task_id": task.id, "task_type": task.type.value, "goal": task.goal},
            )
        )

        try:
            result = await asyncio.wait_for(self.run(task, ctx), timeout=ctx.settings.worker_timeout_s)
        except TimeoutError:
            result = WorkerResult(
                ok=False, error=f"{self.name} exceeded the {ctx.settings.worker_timeout_s:.0f}s worker timeout"
            )
        except BudgetExceeded as exc:
            result = WorkerResult(ok=False, error=f"budget_exceeded: {exc}")
        except ProviderUnavailable as exc:
            result = WorkerResult(ok=False, error=f"provider_unavailable: {exc}")
        except LLMCallError as exc:
            result = WorkerResult(ok=False, error=f"llm_error: {exc}")
        except Exception as exc:
            log.exception("worker_crashed", worker=self.name, task_id=task.id)
            result = WorkerResult(ok=False, error=f"{self.name} failed: {type(exc).__name__}: {exc}")

        result.duration_ms = int((time.perf_counter() - started) * 1000)
        metrics.workers_total.labels(self.name, "success" if result.ok else "failed").inc()

        if result.ok:
            await ctx.emit(
                RunEvent(
                    run_id=ctx.run_id,
                    kind="worker_done",
                    payload={"task_id": task.id, "result": result.model_dump(mode="json")},
                )
            )
        else:
            await ctx.emit(
                RunEvent(
                    run_id=ctx.run_id,
                    kind="worker_error",
                    payload={"task_id": task.id, "error": result.error or "unknown error"},
                )
            )
        return result

    # ─── Helpers available to every worker ──────────────────────

    async def step(self, ctx: WorkerContext, task: Task, message: str, **detail) -> None:
        await ctx.emit(
            RunEvent(
                run_id=ctx.run_id,
                kind="worker_step",
                payload={"task_id": task.id, "message": message, "detail": detail},
            )
        )

    async def think(
        self,
        ctx: WorkerContext,
        system: str,
        user: str,
        *,
        max_tokens: int = 1200,
        temperature: float = 0.2,
    ) -> tuple[str, int, float]:
        """One LLM call with budget accounting. Returns (text, tokens, cost)."""
        estimate = (len(system) + len(user)) // 4 + max_tokens
        if not ctx.budget.can_spend(estimate):
            raise BudgetExceeded("token budget would be exceeded by this call")

        response = await ctx.llm.chat(
            [Message(role="system", content=system), Message(role="user", content=user)],
            provider=ctx.provider,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        ctx.budget.register_llm_call(response.usage.total_tokens, response.cost_usd)
        return response.content, response.usage.total_tokens, response.cost_usd

    async def think_structured(
        self,
        ctx: WorkerContext,
        system: str,
        user: str,
        response_model,
        *,
        max_tokens: int = 1200,
    ):
        """One structured LLM call with budget accounting. Returns (parsed, tokens, cost)."""
        estimate = (len(system) + len(user)) // 4 + max_tokens
        if not ctx.budget.can_spend(estimate):
            raise BudgetExceeded("token budget would be exceeded by this call")

        parsed, response = await ctx.llm.chat_structured(
            [Message(role="system", content=system), Message(role="user", content=user)],
            response_model,
            provider=ctx.provider,
            max_tokens=max_tokens,
        )
        ctx.budget.register_llm_call(response.usage.total_tokens, response.cost_usd)
        return parsed, response.usage.total_tokens, response.cost_usd
