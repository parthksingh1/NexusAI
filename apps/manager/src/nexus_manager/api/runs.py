"""Run lifecycle: plan, execute in the background, and report status.

A run is started by POST /chat and executes as a background task. The plan is produced
before the response returns, so the caller gets the decomposition immediately and can render
the graph while the work happens.
"""

from __future__ import annotations

import asyncio
import secrets
import time

import structlog
from nexus_agents_shared import Plan, RunEvent, RunResult, RunStatus

from ..config import Provider, Settings, settings as default_settings
from ..graph.builder import GraphRunner, execute_plan, resume_run
from ..graph.streaming import EventBus
from ..llm.router import LLMRouter
from ..observability import metrics
from ..planner.planner import plan as make_plan
from ..safety.budget import BudgetTracker
from ..tools import ToolRegistry

log = structlog.get_logger(__name__)


def new_run_id() -> str:
    return f"r_{secrets.token_hex(8)}"


class RunStore:
    """In-process record of every run this instance has handled.

    Durable run state lives in the LangGraph checkpoint; this is the read model the API
    serves, and the reason a run detail request does not have to replay a graph.
    """

    def __init__(self) -> None:
        self._runs: dict[str, RunResult] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def put(self, result: RunResult) -> None:
        self._runs[result.run_id] = result

    def get(self, run_id: str) -> RunResult | None:
        return self._runs.get(run_id)

    def all(self) -> list[RunResult]:
        return sorted(self._runs.values(), key=lambda r: r.started_at, reverse=True)

    def track(self, run_id: str, task: asyncio.Task) -> None:
        self._tasks[run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run_id, None))

    def is_running(self, run_id: str) -> bool:
        task = self._tasks.get(run_id)
        return task is not None and not task.done()

    async def cancel(self, run_id: str) -> bool:
        task = self._tasks.get(run_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True


class RunService:
    """Plans and executes runs."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        bus: EventBus | None = None,
        store: RunStore | None = None,
        checkpointer=None,
    ) -> None:
        self.settings = settings or default_settings
        self.bus = bus or EventBus(self.settings)
        self.store = store or RunStore()
        self.checkpointer = checkpointer
        self.router = LLMRouter(self.settings)

    async def start(
        self, goal: str, provider: Provider | None = None, max_usd: float | None = None
    ) -> RunResult:
        """Plan the goal and launch execution in the background.

        Planning happens inline so the caller receives the decomposition with its response;
        only execution is deferred.
        """
        run_id = new_run_id()
        target: Provider = provider or self.settings.default_llm_provider
        started = time.time()

        record = RunResult(run_id=run_id, status="planning", goal=goal, started_at=started)
        self.store.put(record)

        budget = BudgetTracker(
            max_tokens=self.settings.max_total_tokens,
            max_usd=max_usd if max_usd is not None else self.settings.max_usd,
            max_agents=self.settings.max_agents_spawned,
            max_depth=self.settings.max_depth,
            settings=self.settings,
        )

        try:
            plan, planning_cost = await make_plan(
                goal, target, router=self.router, settings=self.settings
            )
        except Exception as exc:
            record.status = "error"
            record.reason = f"planning failed: {exc}"
            record.finished_at = time.time()
            self.store.put(record)
            metrics.runs_total.labels("error").inc()
            await self.bus.publish(RunEvent(run_id=run_id, kind="error", payload={"error": record.reason}))
            return record

        budget.register_llm_call(0, planning_cost)
        record.plan = plan
        record.status = "running"
        record.budget = budget.snapshot()
        self.store.put(record)

        await self.bus.publish(
            RunEvent(run_id=run_id, kind="plan", payload={"plan": plan.model_dump(mode="json")})
        )

        runner = GraphRunner(
            run_id=run_id,
            plan=plan,
            provider=target,
            bus=self.bus,
            settings=self.settings,
            budget=budget,
            router=self.router,
            tools=ToolRegistry(self.settings),
        )

        task = asyncio.create_task(self._execute(record, runner))
        self.store.track(run_id, task)
        return record

    async def _execute(self, record: RunResult, runner: GraphRunner, *, resume: bool = False) -> None:
        metrics.active_runs.inc()
        try:
            state = (
                await resume_run(runner, checkpointer=self.checkpointer, thread_id=record.run_id)
                if resume
                else await execute_plan(runner, checkpointer=self.checkpointer, thread_id=record.run_id)
            )
            self._finalise(record, state, runner)
        except asyncio.CancelledError:
            record.status = "partial"
            record.reason = "cancelled"
            record.finished_at = time.time()
            record.budget = runner.budget.snapshot()
            self.store.put(record)
            metrics.runs_total.labels("partial").inc()
            await self.bus.publish(
                RunEvent(run_id=record.run_id, kind="done", payload={"status": "partial", "reason": "cancelled"})
            )
            raise
        except Exception as exc:
            log.exception("run_failed", run_id=record.run_id)
            record.status = "error"
            record.reason = str(exc)
            record.finished_at = time.time()
            record.budget = runner.budget.snapshot()
            self.store.put(record)
            metrics.runs_total.labels("error").inc()
            await self.bus.publish(RunEvent(run_id=record.run_id, kind="error", payload={"error": str(exc)}))
        finally:
            metrics.active_runs.dec()

    def _finalise(self, record: RunResult, state, runner: GraphRunner) -> None:
        results = state.get("results") or {}
        record.results = results
        record.answer = state.get("answer")
        record.citations = state.get("citations") or []
        record.budget = runner.budget.snapshot()
        record.finished_at = time.time()

        failed = [tid for tid, r in results.items() if not r.ok]
        status: RunStatus
        if state.get("halted"):
            status = "partial"
            record.reason = f"budget cap reached ({state.get('halt_reason') or 'budget'})"
        elif not record.answer and failed:
            status = "error" if len(failed) == len(results) else "partial"
            record.reason = f"{len(failed)} of {len(results)} task(s) failed"
        elif failed:
            status = "partial"
            record.reason = f"{len(failed)} of {len(results)} task(s) failed"
        else:
            status = "done"

        record.status = status
        self.store.put(record)
        metrics.runs_total.labels(status).inc()

        asyncio.create_task(
            self.bus.publish(
                RunEvent(
                    run_id=record.run_id,
                    kind="done",
                    payload={
                        "status": status,
                        "answer": record.answer,
                        "citations": record.citations,
                        "reason": record.reason,
                    },
                )
            )
        )

    async def resume(self, run_id: str) -> RunResult | None:
        """Continue a run that was interrupted, from its last checkpoint."""
        record = self.store.get(run_id)
        if record is None or record.plan is None or self.store.is_running(run_id):
            return record

        budget = BudgetTracker(settings=self.settings)
        if record.budget:
            budget.tokens_used = record.budget.tokens_used
            budget.usd_spent = record.budget.usd_spent
            budget.agents_spawned = record.budget.agents_spawned

        runner = GraphRunner(
            run_id=run_id,
            plan=record.plan,
            provider=self.settings.default_llm_provider,
            bus=self.bus,
            settings=self.settings,
            budget=budget,
            router=self.router,
        )
        record.status = "running"
        self.store.put(record)
        task = asyncio.create_task(self._execute(record, runner, resume=True))
        self.store.track(run_id, task)
        return record
