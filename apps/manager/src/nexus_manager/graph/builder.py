"""Build and run the execution graph.

One LangGraph node per task, edges from `depends_on`. LangGraph fans out nodes that share a
superstep, so the parallel groups the planner assigned become real concurrency without any
scheduling code here.
"""

from __future__ import annotations

import time
from typing import Any

import structlog
from langgraph.graph import END, START, StateGraph
from nexus_agents_shared import BudgetSnapshot, Plan, RunEvent, Task, WorkerResult

from ..config import Provider, Settings
from ..config import settings as default_settings
from ..llm.router import LLMRouter
from ..observability import metrics
from ..safety.budget import BudgetExceeded, BudgetTracker
from ..tools import ToolRegistry
from ..workers import WorkerContext, worker_for
from .state import RunState
from .streaming import EventBus

log = structlog.get_logger(__name__)


class GraphRunner:
    """Owns everything one run needs: the model router, the tools, the budget, the bus."""

    def __init__(
        self,
        run_id: str,
        plan: Plan,
        *,
        provider: Provider,
        bus: EventBus,
        settings: Settings | None = None,
        budget: BudgetTracker | None = None,
        router: LLMRouter | None = None,
        tools: ToolRegistry | None = None,
    ) -> None:
        self.run_id = run_id
        self.plan = plan
        self.provider = provider
        self.settings = settings or default_settings
        self.bus = bus
        self.budget = budget or BudgetTracker(settings=self.settings)
        self.router = router or LLMRouter(self.settings)
        self.tools = tools or ToolRegistry(self.settings)
        self._terminal_id = plan.terminal_task.id

    # ─── Node construction ──────────────────────────────────────

    def _make_node(self, task: Task):
        async def node(state: RunState) -> dict[str, Any]:
            # A cap tripped in an earlier superstep. Skip without spending anything.
            if state.get("halted"):
                return {
                    "results": {
                        task.id: WorkerResult(
                            ok=False, error=f"skipped: run halted ({state.get('halt_reason') or 'budget'})"
                        )
                    }
                }

            try:
                self.budget.register_spawn(depth=1)
            except BudgetExceeded as exc:
                await self._halt(exc)
                return {
                    "results": {task.id: WorkerResult(ok=False, error=f"budget_exceeded: {exc}")},
                    "halted": True,
                    "halt_reason": exc.cap,
                    "budget": self.budget.snapshot(),
                }

            upstream = {
                dep: result
                for dep, result in (state.get("results") or {}).items()
                if dep in task.depends_on
            }
            ctx = WorkerContext(
                run_id=self.run_id,
                llm=self.router,
                tools=self.tools,
                budget=self.budget,
                emit=self.bus.emitter(self.run_id),
                provider=self.provider,
                settings=self.settings,
                goal=self.plan.goal,
                upstream=upstream,
            )

            result = await worker_for(task.type).execute(task, ctx)

            update: dict[str, Any] = {"results": {task.id: result}, "budget": self.budget.snapshot()}

            if cap := self.budget.pressure():
                await self.bus.publish(
                    RunEvent(
                        run_id=self.run_id,
                        kind="budget_warn",
                        payload={
                            "snapshot": self.budget.snapshot().model_dump(mode="json"),
                            "message": f"{cap} budget is running low",
                        },
                    )
                )

            if self.budget.exhausted:
                await self._halt(BudgetExceeded("a cap was reached", cap="tokens"))
                update["halted"] = True
                update["halt_reason"] = "budget"

            if task.id == self._terminal_id and result.ok:
                answer = result.output.get("answer") or result.output.get("summary") or ""
                update["answer"] = answer
                update["citations"] = result.citations
                if answer:
                    await self.bus.publish(
                        RunEvent(
                            run_id=self.run_id,
                            kind="synthesis",
                            payload={"answer": answer, "citations": result.citations},
                        )
                    )
            return update

        return node

    async def _halt(self, exc: BudgetExceeded) -> None:
        await self.bus.publish(
            RunEvent(
                run_id=self.run_id,
                kind="budget_exceeded",
                payload={"snapshot": self.budget.snapshot().model_dump(mode="json"), "reason": str(exc)},
            )
        )

    # ─── Graph ──────────────────────────────────────────────────

    def build(self, checkpointer=None):
        """Compile the plan into a LangGraph StateGraph."""
        graph = StateGraph(RunState)

        for task in self.plan.tasks:
            graph.add_node(task.id, self._make_node(task))

        depended_on = {d for t in self.plan.tasks for d in t.depends_on}
        for task in self.plan.tasks:
            if task.depends_on:
                for dep in task.depends_on:
                    graph.add_edge(dep, task.id)
            else:
                graph.add_edge(START, task.id)
            # Anything nothing else waits on is an exit point.
            if task.id not in depended_on:
                graph.add_edge(task.id, END)

        return graph.compile(checkpointer=checkpointer)


def build_graph(plan: Plan, runner: GraphRunner, checkpointer=None):
    """Compile `plan` into an executable graph driven by `runner`."""
    return runner.build(checkpointer)


async def execute_plan(
    runner: GraphRunner,
    *,
    checkpointer=None,
    thread_id: str | None = None,
    resume: bool = False,
) -> RunState:
    """Run the graph to completion and return its final state.

    With `resume=True` the graph is invoked with no input, which is what makes LangGraph
    continue an interrupted thread from its last checkpoint rather than starting over.
    Passing a fresh initial state would begin a new execution and pay for finished work a
    second time.

    Budget exhaustion is not an exception path: nodes short-circuit, the synthesizer still
    runs on whatever partial results exist, and the run reports status `partial`.
    """
    compiled = runner.build(checkpointer)
    started = time.perf_counter()

    initial: RunState | None
    if resume:
        initial = None
    else:
        initial = {
            "run_id": runner.run_id,
            "goal": runner.plan.goal,
            "plan": runner.plan,
            "results": {},
            "budget": runner.budget.snapshot(),
            "started_at": time.time(),
            "halted": False,
            "halt_reason": None,
            "answer": None,
            "citations": [],
        }

    config = {"configurable": {"thread_id": thread_id or runner.run_id}}
    # Every task is one superstep at most, plus headroom for the fan-in.
    config["recursion_limit"] = max(25, len(runner.plan.tasks) * 3)

    final = await compiled.ainvoke(initial, config=config)
    metrics.run_duration_ms.observe((time.perf_counter() - started) * 1000)
    return final  # type: ignore[return-value]


async def resume_run(runner: GraphRunner, *, checkpointer, thread_id: str | None = None) -> RunState:
    """Continue an interrupted run from its last checkpoint."""
    return await execute_plan(runner, checkpointer=checkpointer, thread_id=thread_id, resume=True)


def snapshot_of(state: RunState) -> BudgetSnapshot | None:
    return state.get("budget")
