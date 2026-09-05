"""Turn a goal into a Plan.

The planner is the only place a model decides what work happens. Everything it returns is
validated: the Plan contract rejects cycles and dangling dependencies, and this module
repairs the two mistakes models reliably make — mis-numbered parallel groups, and a missing
or wrongly-wired synthesis task — rather than failing a run over formatting.
"""

from __future__ import annotations

import random
import re
import string

import structlog
from nexus_agents_shared import Plan, Task, TaskType

from ..config import Provider, Settings, settings as default_settings
from ..llm.models import Message
from ..llm.router import LLMRouter
from .prompts import MAX_TASKS, REPLAN_SUFFIX, system_prompt, user_prompt
from .schemas import PlanDraft, TaskDraft

log = structlog.get_logger(__name__)

# A plan estimated above this is sent back once for a cheaper decomposition.
COST_CEILING_USD = 0.80


class PlanningError(RuntimeError):
    """The planner could not produce a usable plan."""


def new_task_id() -> str:
    return "t_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


def _normalise_groups(tasks: list[Task]) -> list[Task]:
    """Recompute parallel_group as the longest-path depth of each task.

    Models frequently emit groups that contradict the dependency edges. The edges are the
    real contract, so the groups are derived from them rather than trusted.
    """
    by_id = {t.id: t for t in tasks}
    depth: dict[str, int] = {}

    def resolve(task_id: str, seen: frozenset[str] = frozenset()) -> int:
        if task_id in depth:
            return depth[task_id]
        task = by_id.get(task_id)
        if task is None or task_id in seen:
            return 0
        parents = [d for d in task.depends_on if d in by_id]
        value = 1 + max((resolve(p, seen | {task_id}) for p in parents), default=0) if parents else 1
        depth[task_id] = value
        return value

    for task in tasks:
        task.parallel_group = resolve(task.id)
    return tasks


def _ensure_synthesis(goal: str, tasks: list[Task]) -> list[Task]:
    """Guarantee exactly one terminal synthesis task depending on everything else."""
    synth = [t for t in tasks if t.type is TaskType.SYNTHESIZE]
    others = [t for t in tasks if t.type is not TaskType.SYNTHESIZE]

    if not others:
        # A plan that is nothing but synthesis has no material to synthesise. Turn the
        # single task into research so the run does actual work.
        if synth:
            synth[0].type = TaskType.RESEARCH
            return _normalise_groups(synth)
        raise PlanningError("planner returned no tasks")

    if len(synth) > 1:
        # Keep the last one; fold the others into research.
        for extra in synth[:-1]:
            extra.type = TaskType.RESEARCH
        others = [t for t in tasks if t is not synth[-1]]
        synth = [synth[-1]]

    if not synth:
        terminal = Task(
            id=new_task_id(),
            type=TaskType.SYNTHESIZE,
            goal=f"Merge every finding into a cited answer to: {goal}"[:500],
            depends_on=[t.id for t in others],
        )
        synth = [terminal]

    synth[0].depends_on = [t.id for t in others]
    return _normalise_groups([*others, synth[0]])


def _strip_synthesis(tasks: list[Task]) -> list[Task]:
    kept = [t for t in tasks if t.type is not TaskType.SYNTHESIZE]
    if not kept:
        for task in tasks:
            task.type = TaskType.RESEARCH
        kept = tasks
    known = {t.id for t in kept}
    for task in kept:
        task.depends_on = [d for d in task.depends_on if d in known]
    return _normalise_groups(kept)


_ID_PATTERN = re.compile(r"^t_[a-z0-9]{6}$")


def repair(draft: PlanDraft, *, goal: str) -> Plan:
    """Turn a permissive draft into a valid Plan.

    Every fix here addresses something models get wrong routinely: malformed or duplicated
    ids, dependencies on tasks that do not exist, groups that contradict the edges, and a
    missing or half-wired synthesis node. Failing the run over any of these would be a worse
    outcome than repairing them.
    """
    # Reserve a slot for the synthesis node so adding it cannot overflow the ceiling.
    limit = MAX_TASKS - 1 if draft.requires_synthesis else MAX_TASKS
    drafts = [d for d in draft.tasks if (d.goal or "").strip()][:limit]
    if not drafts:
        raise PlanningError("planner returned no usable tasks")

    # Normalise ids first, remapping any dependency that referred to the old value.
    remap: dict[str, str] = {}
    seen: set[str] = set()
    for item in drafts:
        original = item.id
        candidate = original if _ID_PATTERN.match(original) and original not in seen else new_task_id()
        while candidate in seen:
            candidate = new_task_id()
        if candidate != original:
            remap[original] = candidate
        item.id = candidate
        seen.add(candidate)

    for item in drafts:
        item.depends_on = [remap.get(d, d) for d in item.depends_on]

    known = {d.id for d in drafts}
    tasks = [
        Task(
            id=item.id,
            type=item.type,
            goal=(item.goal.strip() or goal)[:500].ljust(5),
            inputs=item.inputs,
            depends_on=[d for d in dict.fromkeys(item.depends_on) if d in known and d != item.id],
            parallel_group=max(0, item.parallel_group),
        )
        for item in drafts
    ]

    tasks = _ensure_synthesis(goal, tasks) if draft.requires_synthesis else _strip_synthesis(tasks)

    return Plan(
        goal=draft.goal or goal,
        reasoning=draft.reasoning,
        tasks=tasks,
        estimated_cost_usd=max(0.0, draft.estimated_cost_usd),
        requires_synthesis=draft.requires_synthesis,
    )


async def plan(
    goal: str,
    provider: Provider | None = None,
    *,
    router: LLMRouter | None = None,
    settings: Settings | None = None,
    requires_synthesis: bool = True,
    max_tasks: int = MAX_TASKS,
) -> tuple[Plan, float]:
    """Decompose a goal into a validated Plan.

    Returns the plan and the USD cost of planning itself. A plan estimated above the ceiling
    is sent back once for a cheaper decomposition; if the second attempt is still expensive
    it is accepted, because the BudgetTracker enforces the real limit at execution time.
    """
    cfg = settings or default_settings
    llm = router or LLMRouter(cfg)
    target: Provider = provider or cfg.default_llm_provider
    model = cfg.planner_model_for(target)

    messages = [
        Message(role="system", content=system_prompt(max_tasks)),
        Message(role="user", content=user_prompt(goal, requires_synthesis=requires_synthesis)),
    ]

    raw, response = await llm.chat_structured(
        messages, PlanDraft, provider=target, model=model, temperature=0.0, max_tokens=2048
    )
    spent = response.cost_usd
    result = repair(raw, goal=goal)

    if result.estimated_cost_usd > COST_CEILING_USD:
        log.info("replanning_for_cost", estimated=result.estimated_cost_usd, ceiling=COST_CEILING_USD)
        retry_messages = [
            *messages,
            Message(
                role="user",
                content=REPLAN_SUFFIX.format(previous=result.estimated_cost_usd, ceiling=COST_CEILING_USD),
            ),
        ]
        try:
            raw_retry, retry_response = await llm.chat_structured(
                retry_messages, PlanDraft, provider=target, model=model, temperature=0.0, max_tokens=2048
            )
            spent += retry_response.cost_usd
            result = repair(raw_retry, goal=goal)
        except Exception as exc:
            # The first plan is still usable and the budget tracker is the real ceiling.
            log.warning("replan_failed_keeping_first_plan", error=str(exc)[:200])

    log.info(
        "plan_ready",
        goal=goal[:120],
        provider=target,
        model=model,
        tasks=len(result.tasks),
        groups=sorted({t.parallel_group for t in result.tasks}),
        estimated_cost_usd=result.estimated_cost_usd,
        planning_cost_usd=round(spent, 6),
    )
    return result, spent
