from __future__ import annotations

import asyncio

import pytest
from langgraph.checkpoint.memory import MemorySaver
from nexus_agents_shared import Plan, RunEvent, Task, TaskType, WorkerResult

from nexus_manager.config import Settings
from nexus_manager.graph.builder import GraphRunner, execute_plan, resume_run
from nexus_manager.graph.state import merge_results
from nexus_manager.graph.streaming import EventBus
from nexus_manager.safety.budget import BudgetTracker
from nexus_manager.workers import WORKERS
from nexus_manager.workers.base import BaseWorker


@pytest.fixture
def settings() -> Settings:
    return Settings(DATABASE_URL=None, WORKER_TIMEOUT_S=5.0)


def task(tid: str, ttype: TaskType, deps: list[str] | None = None) -> Task:
    return Task(id=tid, type=ttype, goal=f"goal for {tid}", depends_on=deps or [])


def fan_out_plan() -> Plan:
    """Three independent research tasks feeding one synthesis."""
    return Plan(
        goal="a goal",
        reasoning="r",
        tasks=[
            task("t_aaaaaa", TaskType.RESEARCH),
            task("t_bbbbbb", TaskType.RESEARCH),
            task("t_cccccc", TaskType.RESEARCH),
            task("t_synth1", TaskType.SYNTHESIZE, ["t_aaaaaa", "t_bbbbbb", "t_cccccc"]),
        ],
    )


class RecordingWorker(BaseWorker):
    """Substitutes for a real worker; records ordering and concurrency."""

    name = "recording"
    started: list[str] = []
    finished: list[str] = []
    concurrent = 0
    peak = 0
    delay = 0.05
    fail_ids: set[str] = set()

    async def run(self, task, ctx):
        type(self).started.append(task.id)
        type(self).concurrent += 1
        type(self).peak = max(type(self).peak, type(self).concurrent)
        try:
            await asyncio.sleep(type(self).delay)
        finally:
            type(self).concurrent -= 1
        type(self).finished.append(task.id)

        if task.id in type(self).fail_ids:
            return WorkerResult(ok=False, error=f"{task.id} was told to fail")
        return WorkerResult(
            ok=True,
            output={"answer": f"answer from {task.id}", "summary": f"summary from {task.id}"},
            citations=[f"https://src/{task.id}"],
            tokens_used=10,
        )


@pytest.fixture(autouse=True)
def use_recording_worker(monkeypatch):
    RecordingWorker.started = []
    RecordingWorker.finished = []
    RecordingWorker.concurrent = 0
    RecordingWorker.peak = 0
    RecordingWorker.fail_ids = set()
    RecordingWorker.delay = 0.05
    for task_type in TaskType:
        monkeypatch.setitem(WORKERS, task_type, RecordingWorker)


def make_runner(plan: Plan, settings: Settings, bus: EventBus | None = None, budget=None) -> GraphRunner:
    return GraphRunner(
        run_id="r_graph",
        plan=plan,
        provider="ollama",
        bus=bus or EventBus(settings),
        settings=settings,
        budget=budget,
    )


# ─── State reducer ──────────────────────────────────────────────


def test_results_from_parallel_nodes_merge_rather_than_overwrite():
    left = {"t_a": WorkerResult(ok=True)}
    right = {"t_b": WorkerResult(ok=True)}
    assert set(merge_results(left, right)) == {"t_a", "t_b"}


def test_merge_handles_empty_sides():
    assert merge_results({}, {"t_a": WorkerResult(ok=True)}) == {"t_a": WorkerResult(ok=True)}
    assert merge_results(None, None) == {}  # type: ignore[arg-type]


# ─── Topology ───────────────────────────────────────────────────


async def test_every_task_runs_once(settings: Settings):
    state = await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    assert set(state["results"]) == {"t_aaaaaa", "t_bbbbbb", "t_cccccc", "t_synth1"}
    assert sorted(RecordingWorker.started) == sorted(RecordingWorker.finished)


async def test_independent_tasks_run_concurrently(settings: Settings):
    """The whole point of parallel groups: three research nodes overlap."""
    await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    assert RecordingWorker.peak >= 3


async def test_a_dependent_task_starts_only_after_its_dependencies_finish(settings: Settings):
    await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    synth_position = RecordingWorker.started.index("t_synth1")
    for dep in ("t_aaaaaa", "t_bbbbbb", "t_cccccc"):
        assert RecordingWorker.finished.index(dep) < synth_position or dep in RecordingWorker.finished


async def test_a_linear_chain_runs_in_order(settings: Settings):
    plan = Plan(
        goal="g",
        reasoning="r",
        tasks=[
            task("t_aaaaaa", TaskType.RESEARCH),
            task("t_bbbbbb", TaskType.SCRAPE, ["t_aaaaaa"]),
            task("t_synth1", TaskType.SYNTHESIZE, ["t_bbbbbb"]),
        ],
    )
    await execute_plan(make_runner(plan, settings), checkpointer=MemorySaver())
    assert RecordingWorker.started == ["t_aaaaaa", "t_bbbbbb", "t_synth1"]


async def test_a_single_task_plan_runs(settings: Settings):
    plan = Plan(goal="g", reasoning="r", tasks=[task("t_only01", TaskType.RESEARCH)], requires_synthesis=False)
    state = await execute_plan(make_runner(plan, settings), checkpointer=MemorySaver())
    assert state["results"]["t_only01"].ok


# ─── Upstream wiring ────────────────────────────────────────────


async def test_a_node_receives_only_its_own_dependencies(settings: Settings):
    seen: dict[str, set[str]] = {}

    class Inspecting(RecordingWorker):
        async def run(self, task, ctx):
            seen[task.id] = set((ctx.upstream or {}).keys())
            return await super().run(task, ctx)

    for task_type in TaskType:
        WORKERS[task_type] = Inspecting

    await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    assert seen["t_aaaaaa"] == set()
    assert seen["t_synth1"] == {"t_aaaaaa", "t_bbbbbb", "t_cccccc"}


# ─── Terminal node ──────────────────────────────────────────────


async def test_the_terminal_node_supplies_the_answer_and_citations(settings: Settings):
    state = await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    assert state["answer"] == "answer from t_synth1"
    assert state["citations"] == ["https://src/t_synth1"]


async def test_a_synthesis_event_is_emitted(settings: Settings):
    bus = EventBus(settings)
    await execute_plan(make_runner(fan_out_plan(), settings, bus=bus), checkpointer=MemorySaver())
    kinds = [e.kind for e in bus.history("r_graph")]
    assert "synthesis" in kinds


# ─── Failure containment ────────────────────────────────────────


async def test_one_failing_task_does_not_stop_the_others(settings: Settings):
    """A dead video tool must not cost the user the research."""
    RecordingWorker.fail_ids = {"t_bbbbbb"}
    state = await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    assert state["results"]["t_bbbbbb"].ok is False
    assert state["results"]["t_aaaaaa"].ok is True
    assert state["results"]["t_synth1"].ok is True


async def test_worker_errors_are_reported_as_events(settings: Settings):
    RecordingWorker.fail_ids = {"t_aaaaaa"}
    bus = EventBus(settings)
    await execute_plan(make_runner(fan_out_plan(), settings, bus=bus), checkpointer=MemorySaver())
    assert any(e.kind == "worker_error" for e in bus.history("r_graph"))


# ─── Budget halting ─────────────────────────────────────────────


async def test_the_agent_cap_halts_remaining_nodes(settings: Settings):
    """Two agents allowed, four tasks planned: the rest are skipped, not run."""
    budget = BudgetTracker(max_tokens=1_000_000, max_usd=10.0, max_agents=2, max_depth=2, settings=settings)
    bus = EventBus(settings)
    state = await execute_plan(
        make_runner(fan_out_plan(), settings, bus=bus, budget=budget), checkpointer=MemorySaver()
    )
    skipped = [r for r in state["results"].values() if r.error and "skipped" in r.error]
    exceeded = [r for r in state["results"].values() if r.error and "budget_exceeded" in r.error]
    assert budget.agents_spawned <= 2
    assert skipped or exceeded
    assert any(e.kind == "budget_exceeded" for e in bus.history("r_graph"))


async def test_a_halted_run_records_the_reason(settings: Settings):
    budget = BudgetTracker(max_tokens=1_000_000, max_usd=10.0, max_agents=1, max_depth=2, settings=settings)
    state = await execute_plan(make_runner(fan_out_plan(), settings, budget=budget), checkpointer=MemorySaver())
    assert state["halted"] is True
    assert state["halt_reason"]


async def test_budget_snapshot_is_carried_in_state(settings: Settings):
    state = await execute_plan(make_runner(fan_out_plan(), settings), checkpointer=MemorySaver())
    snapshot = state["budget"]
    assert snapshot is not None
    assert snapshot.agents_spawned == 4


# ─── Checkpointing ──────────────────────────────────────────────


async def test_a_checkpoint_is_written_and_can_be_read_back(settings: Settings):
    saver = MemorySaver()
    runner = make_runner(fan_out_plan(), settings)
    await execute_plan(runner, checkpointer=saver, thread_id="thread-resume")

    stored = await saver.aget({"configurable": {"thread_id": "thread-resume"}})
    assert stored is not None
    assert set(stored["channel_values"]["results"]) == {"t_aaaaaa", "t_bbbbbb", "t_cccccc", "t_synth1"}


async def test_an_interrupted_run_resumes_without_repeating_finished_work(settings: Settings):
    """The value of checkpointing: a crashed run does not pay for finished nodes twice."""
    saver = MemorySaver()
    plan = fan_out_plan()

    # Kill the run partway. The crash has to escape `execute`, which deliberately contains
    # worker exceptions — this stands in for the process dying, not a worker failing.
    class Crashing(RecordingWorker):
        async def execute(self, task, ctx):
            if task.id == "t_synth1" and not type(self).recovered:
                type(self).recovered = True
                raise RuntimeError("process died mid-run")
            return await super().execute(task, ctx)

    Crashing.recovered = False
    for task_type in TaskType:
        WORKERS[task_type] = Crashing

    with pytest.raises(Exception):
        await execute_plan(make_runner(plan, settings), checkpointer=saver, thread_id="thread-crash")

    completed_before = set(RecordingWorker.finished)
    assert {"t_aaaaaa", "t_bbbbbb", "t_cccccc"} <= completed_before

    RecordingWorker.started = []
    state = await resume_run(make_runner(plan, settings), checkpointer=saver, thread_id="thread-crash")

    # The three research nodes were checkpointed, so the resume only runs what was left.
    assert "t_aaaaaa" not in RecordingWorker.started
    assert set(state["results"]) == {"t_aaaaaa", "t_bbbbbb", "t_cccccc", "t_synth1"}


# ─── Event bus ──────────────────────────────────────────────────


async def test_a_late_subscriber_still_receives_earlier_events(settings: Settings):
    bus = EventBus(settings)
    await bus.publish(RunEvent(run_id="r_late", kind="plan", payload={}))
    await bus.publish(RunEvent(run_id="r_late", kind="worker_start", payload={}))

    received = []
    async def collect():
        async for event in bus.subscribe("r_late"):
            received.append(event.kind)
            if event.kind == "done":
                return

    consumer = asyncio.create_task(collect())
    await asyncio.sleep(0.05)
    await bus.publish(RunEvent(run_id="r_late", kind="done", payload={}))
    await asyncio.wait_for(consumer, timeout=2)
    assert received == ["plan", "worker_start", "done"]


async def test_the_stream_closes_when_a_run_ends(settings: Settings):
    bus = EventBus(settings)
    await bus.publish(RunEvent(run_id="r_end", kind="done", payload={}))
    assert bus.is_finished("r_end")
    events = [e.kind async for e in bus.subscribe("r_end")]
    assert events == ["done"]


async def test_publishing_never_raises_when_redis_is_broken(settings: Settings):
    class BrokenRedis:
        async def publish(self, *_a, **_k):
            raise RuntimeError("redis down")

    bus = EventBus(settings, BrokenRedis())
    await bus.publish(RunEvent(run_id="r_broken", kind="plan", payload={}))
    assert len(bus.history("r_broken")) == 1
