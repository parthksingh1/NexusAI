from __future__ import annotations

import httpx
import pytest
import respx
from nexus_agents_shared import Plan, Task, TaskType

from nexus_manager.config import Settings
from nexus_manager.llm.router import LLMRouter
from nexus_manager.planner.planner import PlanningError, new_task_id, plan, repair
from nexus_manager.planner.prompts import system_prompt, user_prompt
from nexus_manager.planner.schemas import PlanDraft, TaskDraft

OLLAMA = "http://ollama.invalid:11434"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        DATABASE_URL="postgresql://unused/unused",
        OLLAMA_HOST=OLLAMA,
        DEFAULT_LLM_PROVIDER="ollama",
        OLLAMA_PLANNER_MODEL="llama3:8b",
    )


def _ollama_plan_response(plan_json: str) -> dict:
    return {
        "model": "llama3:8b",
        "message": {"role": "assistant", "content": plan_json},
        "done": True,
        "prompt_eval_count": 400,
        "eval_count": 200,
    }


def t(tid: str, ttype: TaskType, goal: str, deps: list[str] | None = None, group: int = 0) -> TaskDraft:
    """Build a draft task — the shape the model returns, before repair."""
    return TaskDraft(id=tid, type=ttype, goal=goal, depends_on=deps or [], parallel_group=group)


def draft(tasks: list[TaskDraft], *, requires_synthesis: bool = True, cost: float = 0.1) -> PlanDraft:
    return PlanDraft(
        goal="g", reasoning="r", tasks=tasks, estimated_cost_usd=cost, requires_synthesis=requires_synthesis
    )


# ─── Prompt content ─────────────────────────────────────────────


def test_prompt_documents_every_task_type():
    prompt = system_prompt()
    for name in ("research", "scrape", "video", "code", "synthesize"):
        assert name in prompt


def test_prompt_states_the_task_ceiling_and_prefers_fewer():
    prompt = system_prompt(8)
    assert "at most 8 tasks" in prompt
    assert "Prefer fewer" in prompt


def test_prompt_keeps_reasoning_out_of_the_task_list():
    assert "Do not put reasoning anywhere else" in system_prompt().replace("\n", " ")


def test_user_prompt_switches_on_synthesis():
    assert "Include exactly one synthesize task" in user_prompt("g", requires_synthesis=True)
    assert "Do not include a synthesize task" in user_prompt("g", requires_synthesis=False)


# ─── Task ids ───────────────────────────────────────────────────


def test_generated_ids_match_the_contract_pattern():
    for _ in range(50):
        Task(id=new_task_id(), type=TaskType.RESEARCH, goal="a goal that is long enough")


# ─── repair: groups ─────────────────────────────────────────────


def test_groups_are_derived_from_dependencies_not_trusted():
    """Models routinely emit groups that contradict their own edges."""
    raw = draft(
        [
            t("t_aaaaaa", TaskType.RESEARCH, "research one", group=5),
            t("t_bbbbbb", TaskType.RESEARCH, "research two", group=5),
            t("t_cccccc", TaskType.SCRAPE, "read a page", deps=["t_aaaaaa", "t_bbbbbb"], group=1),
        ],
        requires_synthesis=False,
    )
    fixed = repair(raw, goal="g")
    groups = {task.id: task.parallel_group for task in fixed.tasks}
    assert groups["t_aaaaaa"] == 1
    assert groups["t_bbbbbb"] == 1
    assert groups["t_cccccc"] == 2


def test_independent_tasks_share_a_group():
    raw = draft(
        [t(f"t_aaaaa{i}", TaskType.RESEARCH, f"research {i}") for i in range(3)],
        requires_synthesis=False,
    )
    fixed = repair(raw, goal="g")
    assert {task.parallel_group for task in fixed.tasks} == {1}


# ─── repair: synthesis ──────────────────────────────────────────


def test_missing_synthesis_task_is_added_and_depends_on_everything():
    raw = draft(
        [
            t("t_aaaaaa", TaskType.RESEARCH, "research one"),
            t("t_bbbbbb", TaskType.RESEARCH, "research two"),
        ],
        requires_synthesis=True,
    )
    fixed = repair(raw, goal="g")
    synth = [x for x in fixed.tasks if x.type is TaskType.SYNTHESIZE]
    assert len(synth) == 1
    assert set(synth[0].depends_on) == {"t_aaaaaa", "t_bbbbbb"}
    assert synth[0].parallel_group == 2


def test_a_partially_wired_synthesis_task_is_rewired_to_every_task():
    raw = draft(
        [
            t("t_aaaaaa", TaskType.RESEARCH, "research one"),
            t("t_bbbbbb", TaskType.RESEARCH, "research two"),
            t("t_cccccc", TaskType.SYNTHESIZE, "merge", deps=["t_aaaaaa"]),
        ],
        requires_synthesis=True,
    )
    fixed = repair(raw, goal="g")
    synth = next(x for x in fixed.tasks if x.type is TaskType.SYNTHESIZE)
    assert set(synth.depends_on) == {"t_aaaaaa", "t_bbbbbb"}


def test_extra_synthesis_tasks_are_folded_into_research():
    raw = draft(
        [
            t("t_aaaaaa", TaskType.RESEARCH, "research one"),
            t("t_bbbbbb", TaskType.SYNTHESIZE, "merge a"),
            t("t_cccccc", TaskType.SYNTHESIZE, "merge b"),
        ],
        requires_synthesis=True,
    )
    fixed = repair(raw, goal="g")
    assert sum(1 for x in fixed.tasks if x.type is TaskType.SYNTHESIZE) == 1


def test_synthesis_is_removed_when_not_required():
    raw = draft(
        [
            t("t_aaaaaa", TaskType.RESEARCH, "research one"),
            t("t_bbbbbb", TaskType.SYNTHESIZE, "merge", deps=["t_aaaaaa"]),
        ],
        requires_synthesis=False,
    )
    fixed = repair(raw, goal="g")
    assert all(x.type is not TaskType.SYNTHESIZE for x in fixed.tasks)
    assert len(fixed.tasks) == 1


def test_a_synthesis_only_plan_becomes_real_work():
    raw = draft(
        [t("t_aaaaaa", TaskType.SYNTHESIZE, "just answer it")],
        requires_synthesis=True,
    )
    fixed = repair(raw, goal="g")
    assert fixed.tasks[0].type is TaskType.RESEARCH


# ─── repair: malformed graphs ───────────────────────────────────


def test_dangling_dependencies_are_dropped():
    raw = draft(
        [t("t_aaaaaa", TaskType.RESEARCH, "research one", deps=["t_zzzzzz"])],
        requires_synthesis=False,
    )
    assert repair(raw, goal="g").tasks[0].depends_on == []


def test_more_than_eight_tasks_are_truncated():
    raw = draft(
        [t(f"t_aaaa{i:02d}", TaskType.RESEARCH, f"research {i}") for i in range(8)],
        requires_synthesis=True,
    )
    fixed = repair(raw, goal="g")
    assert len(fixed.tasks) <= 8
    assert sum(1 for x in fixed.tasks if x.type is TaskType.SYNTHESIZE) == 1


def test_terminal_task_is_the_synthesis_node():
    raw = draft(
        [t("t_aaaaaa", TaskType.RESEARCH, "research one")],
        requires_synthesis=True,
    )
    assert repair(raw, goal="g").terminal_task.type is TaskType.SYNTHESIZE


# ─── Contract-level rejection ───────────────────────────────────


def test_a_cyclic_plan_is_rejected_by_the_contract():
    with pytest.raises(ValueError, match="cycle"):
        Plan(
            goal="g",
            reasoning="r",
            tasks=[
                Task(id="t_aaaaaa", type=TaskType.RESEARCH, goal="task one", depends_on=["t_bbbbbb"]),
                Task(id="t_bbbbbb", type=TaskType.RESEARCH, goal="task two", depends_on=["t_aaaaaa"]),
            ],
        )


def test_a_self_dependency_is_rejected():
    with pytest.raises(ValueError, match="itself"):
        Task(id="t_aaaaaa", type=TaskType.RESEARCH, goal="a goal here", depends_on=["t_aaaaaa"])


def test_a_malformed_task_id_is_rejected_by_the_contract():
    with pytest.raises(ValueError):
        Task(id="task-1", type=TaskType.RESEARCH, goal="a goal here")


def test_a_malformed_task_id_is_repaired_and_dependencies_follow_it():
    fixed = repair(
        draft(
            [
                t("task-1", TaskType.RESEARCH, "research one"),
                t("task-2", TaskType.SCRAPE, "read a page", deps=["task-1"]),
            ],
            requires_synthesis=False,
        ),
        goal="g",
    )
    ids = [x.id for x in fixed.tasks]
    assert all(i.startswith("t_") and len(i) == 8 for i in ids)
    scrape = next(x for x in fixed.tasks if x.type is TaskType.SCRAPE)
    assert scrape.depends_on == [ids[0]]


# ─── End-to-end planning against a mocked model ─────────────────


COMPARISON_PLAN = """{
  "goal": "Compare the top 3 open-source vector databases by benchmark and community activity",
  "reasoning": "Three independent lookups can run at once, then one page read, then a merge.",
  "tasks": [
    {"id": "t_res001", "type": "research", "goal": "Benchmark results for pgvector", "inputs": {}, "depends_on": [], "parallel_group": 1},
    {"id": "t_res002", "type": "research", "goal": "Benchmark results for Qdrant", "inputs": {}, "depends_on": [], "parallel_group": 1},
    {"id": "t_res003", "type": "research", "goal": "Benchmark results for Weaviate", "inputs": {}, "depends_on": [], "parallel_group": 1},
    {"id": "t_scr001", "type": "scrape", "goal": "Read the published benchmark comparison page", "inputs": {}, "depends_on": ["t_res001", "t_res002", "t_res003"], "parallel_group": 2},
    {"id": "t_syn001", "type": "synthesize", "goal": "Merge findings into a cited comparison", "inputs": {}, "depends_on": ["t_res001", "t_res002", "t_res003", "t_scr001"], "parallel_group": 3}
  ],
  "estimated_cost_usd": 0.12,
  "requires_synthesis": true
}"""

VIDEO_PLAN = """{
  "goal": "Summarise this talk and extract action items",
  "reasoning": "One transcript read, then a merge.",
  "tasks": [
    {"id": "t_vid001", "type": "video", "goal": "Read and summarise the talk transcript", "inputs": {"url": "https://www.youtube.com/watch?v=iDulhoQ2pro"}, "depends_on": [], "parallel_group": 1},
    {"id": "t_syn001", "type": "synthesize", "goal": "Produce the summary and action items", "inputs": {}, "depends_on": ["t_vid001"], "parallel_group": 2}
  ],
  "estimated_cost_usd": 0.03,
  "requires_synthesis": true
}"""


@respx.mock
async def test_comparison_goal_produces_parallel_research_then_synthesis(settings: Settings):
    respx.post(f"{OLLAMA}/api/chat").mock(
        return_value=httpx.Response(200, json=_ollama_plan_response(COMPARISON_PLAN))
    )
    result, cost = await plan(
        "Compare the top 3 open-source vector databases by benchmark and community activity",
        router=LLMRouter(settings),
        settings=settings,
    )
    research = [x for x in result.tasks if x.type is TaskType.RESEARCH]
    assert len(research) == 3
    assert {x.parallel_group for x in research} == {1}

    scrape = next(x for x in result.tasks if x.type is TaskType.SCRAPE)
    assert scrape.parallel_group == 2

    synth = next(x for x in result.tasks if x.type is TaskType.SYNTHESIZE)
    assert synth.parallel_group == 3
    assert len(synth.depends_on) == 4
    assert cost == 0.0  # local inference


@respx.mock
async def test_video_goal_produces_a_video_task_and_a_synthesis(settings: Settings):
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=_ollama_plan_response(VIDEO_PLAN)))
    result, _ = await plan("Summarise this talk and extract action items", router=LLMRouter(settings), settings=settings)
    assert [x.type for x in result.tasks] == [TaskType.VIDEO, TaskType.SYNTHESIZE]
    assert result.tasks[0].inputs["url"].endswith("iDulhoQ2pro")


@respx.mock
async def test_an_expensive_plan_triggers_exactly_one_replan(settings: Settings):
    expensive = COMPARISON_PLAN.replace('"estimated_cost_usd": 0.12', '"estimated_cost_usd": 0.95')
    cheap = COMPARISON_PLAN.replace('"estimated_cost_usd": 0.12', '"estimated_cost_usd": 0.20')
    route = respx.post(f"{OLLAMA}/api/chat").mock(
        side_effect=[
            httpx.Response(200, json=_ollama_plan_response(expensive)),
            httpx.Response(200, json=_ollama_plan_response(cheap)),
        ]
    )
    result, _ = await plan("compare vector databases", router=LLMRouter(settings), settings=settings)
    assert route.call_count == 2
    assert result.estimated_cost_usd == pytest.approx(0.20)


@respx.mock
async def test_a_still_expensive_replan_is_accepted_because_the_tracker_is_the_real_limit(settings: Settings):
    expensive = COMPARISON_PLAN.replace('"estimated_cost_usd": 0.12', '"estimated_cost_usd": 0.95')
    route = respx.post(f"{OLLAMA}/api/chat").mock(
        return_value=httpx.Response(200, json=_ollama_plan_response(expensive))
    )
    result, _ = await plan("compare vector databases", router=LLMRouter(settings), settings=settings)
    assert route.call_count == 2
    assert result.estimated_cost_usd == pytest.approx(0.95)


@respx.mock
async def test_a_cheap_plan_is_not_replanned(settings: Settings):
    route = respx.post(f"{OLLAMA}/api/chat").mock(
        return_value=httpx.Response(200, json=_ollama_plan_response(COMPARISON_PLAN))
    )
    await plan("compare vector databases", router=LLMRouter(settings), settings=settings)
    assert route.call_count == 1


@respx.mock
async def test_planner_uses_the_configured_planner_model(settings: Settings):
    tuned = settings.model_copy(update={"ollama_planner_model": "qwen2.5:14b"})
    route = respx.post(f"{OLLAMA}/api/chat").mock(
        return_value=httpx.Response(200, json=_ollama_plan_response(COMPARISON_PLAN))
    )
    await plan("compare vector databases", router=LLMRouter(tuned), settings=tuned)
    assert '"model":"qwen2.5:14b"' in route.calls[0].request.read().decode()
