from __future__ import annotations

import asyncio

import pytest
from nexus_agents_shared import RunEvent, Task, TaskType, WorkerResult
from pydantic import BaseModel

from nexus_manager.config import Settings
from nexus_manager.safety.budget import BudgetExceeded, BudgetTracker
from nexus_manager.tools.schemas import (
    Chunk,
    ExecResult,
    Page,
    PageResult,
    RagResult,
    SearchHit,
    SearchResult,
    Segment,
    ToolError,
    Video,
    VideoResult,
)
from nexus_manager.workers import WORKERS, WorkerContext, worker_for
from nexus_manager.workers.coder import CoderWorker
from nexus_manager.workers.researcher import ResearcherWorker
from nexus_manager.workers.synthesizer import SynthesizerWorker
from nexus_manager.workers.video_analyst import VideoAnalystWorker
from nexus_manager.workers.web_scraper import WebScraperWorker, build_extraction_model


class FakeTools:
    """Stand-in for ToolRegistry that returns queued results and records calls."""

    def __init__(self, responses: dict[str, object]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, dict]] = []

    async def call(self, tool: str, /, **kwargs):
        self.calls.append((tool, kwargs))
        value = self.responses.get(tool, ToolError(tool=tool, message="not configured"))
        if isinstance(value, list):
            return value.pop(0) if value else ToolError(tool=tool, message="exhausted")
        if callable(value):
            return value(**kwargs)
        return value


class FakeLLM:
    """Returns queued structured payloads and counts tokens deterministically."""

    def __init__(self, structured: list[BaseModel] | None = None, text: str = "answer") -> None:
        self.structured = structured or []
        self.text = text
        self.calls = 0

    async def chat_structured(self, messages, response_model, **kwargs):
        self.calls += 1
        from nexus_manager.llm.models import ChatResponse, TokenUsage

        # model_construct bypasses validation: worker output models now require the fields
        # that carry content, and a test that did not queue a value wants an empty stand-in.
        value = self.structured.pop(0) if self.structured else response_model.model_construct()
        return value, ChatResponse(
            content="{}", usage=TokenUsage(prompt_tokens=100, completion_tokens=50),
            model="llama3:8b", provider="ollama", cost_usd=0.0,
        )

    async def chat(self, messages, **kwargs):
        self.calls += 1
        from nexus_manager.llm.models import ChatResponse, TokenUsage

        return ChatResponse(
            content=self.text, usage=TokenUsage(prompt_tokens=100, completion_tokens=50),
            model="llama3:8b", provider="ollama", cost_usd=0.0,
        )


@pytest.fixture
def settings() -> Settings:
    return Settings(DATABASE_URL="postgresql://unused/unused", WORKER_TIMEOUT_S=5.0)


def make_ctx(settings: Settings, llm=None, tools=None, upstream=None, budget=None) -> tuple[WorkerContext, list[RunEvent]]:
    events: list[RunEvent] = []

    async def emit(event: RunEvent) -> None:
        events.append(event)

    ctx = WorkerContext(
        run_id="r_test",
        llm=llm or FakeLLM(),
        tools=tools or FakeTools({}),
        budget=budget or BudgetTracker(settings=settings),
        emit=emit,
        provider="ollama",
        settings=settings,
        goal="the run goal",
        upstream=upstream,
    )
    return ctx, events


def task(ttype: TaskType, goal: str = "a task goal here", **inputs) -> Task:
    return Task(id="t_abc123", type=ttype, goal=goal, inputs=inputs)


# ─── Registry ───────────────────────────────────────────────────


def test_every_task_type_has_a_worker():
    assert set(WORKERS) == set(TaskType)


def test_worker_instances_are_named():
    assert {worker_for(t).name for t in TaskType} == {
        "researcher", "web_scraper", "video_analyst", "coder", "synthesizer"
    }


# ─── Lifecycle: events, timeout, error containment ──────────────


async def test_worker_emits_start_and_done(settings: Settings):
    tools = FakeTools({
        "web_search": SearchResult(query="q", hits=[SearchHit(url="https://a.org", title="A", snippet="body text")]),
        "rag_query": RagResult(ok=False, error="offline"),
        "fetch_url": PageResult(page=Page(url="https://a.org", title="A", text="x" * 500)),
    })
    ctx, events = make_ctx(settings, tools=tools)
    result = await ResearcherWorker().execute(task(TaskType.RESEARCH), ctx)
    kinds = [e.kind for e in events]
    assert kinds[0] == "worker_start"
    assert kinds[-1] == ("worker_done" if result.ok else "worker_error")


async def test_a_crashing_worker_returns_a_result_rather_than_propagating(settings: Settings):
    class Exploding(ResearcherWorker):
        async def run(self, task, ctx):
            raise RuntimeError("boom")

    ctx, events = make_ctx(settings)
    result = await Exploding().execute(task(TaskType.RESEARCH), ctx)
    assert not result.ok and "boom" in result.error
    assert events[-1].kind == "worker_error"


async def test_a_slow_worker_is_cut_off_at_the_timeout(settings: Settings):
    fast = settings.model_copy(update={"worker_timeout_s": 0.1})

    class Slow(ResearcherWorker):
        async def run(self, task, ctx):
            await asyncio.sleep(5)

    ctx, _ = make_ctx(fast)
    result = await Slow().execute(task(TaskType.RESEARCH), ctx)
    assert not result.ok and "timeout" in result.error


async def test_budget_exhaustion_surfaces_as_a_structured_error(settings: Settings):
    spent = BudgetTracker(max_tokens=10, max_usd=1.0, max_agents=8, max_depth=2, settings=settings)
    spent.tokens_used = 10
    ctx, _ = make_ctx(settings, budget=spent)
    result = await SynthesizerWorker().execute(
        task(TaskType.SYNTHESIZE), ctx
    )
    assert not result.ok


async def test_duration_is_always_recorded(settings: Settings):
    ctx, _ = make_ctx(settings)
    result = await SynthesizerWorker().execute(task(TaskType.SYNTHESIZE), ctx)
    assert result.duration_ms >= 0


# ─── Researcher ─────────────────────────────────────────────────


async def test_researcher_returns_findings_with_sources(settings: Settings):
    from nexus_manager.workers.researcher import Finding, ResearchOutput

    tools = FakeTools({
        "web_search": SearchResult(
            query="q", hits=[SearchHit(url="https://src.org/a", title="A", snippet="s")]
        ),
        "rag_query": RagResult(ok=False, error="offline"),
        "fetch_url": PageResult(page=Page(url="https://src.org/a", title="A", text="content " * 100)),
    })
    llm = FakeLLM([ResearchOutput(
        findings=[Finding(claim="A verified claim.", source="https://src.org/a")],
        summary="A summary.",
    )])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await ResearcherWorker().execute(task(TaskType.RESEARCH), ctx)
    assert result.ok
    assert result.output["findings"][0]["claim"] == "A verified claim."
    assert result.citations == ["https://src.org/a"]


async def test_researcher_drops_a_citation_the_model_invented(settings: Settings):
    """A URL the worker never fetched cannot support a claim."""
    from nexus_manager.workers.researcher import Finding, ResearchOutput

    tools = FakeTools({
        "web_search": SearchResult(query="q", hits=[SearchHit(url="https://real.org/a", title="A", snippet="s")]),
        "rag_query": RagResult(ok=False, error="offline"),
        "fetch_url": PageResult(page=Page(url="https://real.org/a", title="A", text="content " * 100)),
    })
    llm = FakeLLM([ResearchOutput(
        findings=[Finding(claim="Invented.", source="https://fabricated.example/never-fetched")],
        summary="s",
    )])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await ResearcherWorker().execute(task(TaskType.RESEARCH), ctx)
    assert result.output["findings"] == []
    assert "fabricated.example" not in result.citations


async def test_researcher_fails_cleanly_when_nothing_is_found(settings: Settings):
    tools = FakeTools({
        "web_search": SearchResult(ok=False, query="q", error="search unavailable"),
        "rag_query": RagResult(ok=False, error="offline"),
    })
    ctx, _ = make_ctx(settings, tools=tools)
    result = await ResearcherWorker().execute(task(TaskType.RESEARCH), ctx)
    assert not result.ok and "no material found" in result.error


async def test_researcher_falls_back_to_snippets_when_pages_fail(settings: Settings):
    from nexus_manager.workers.researcher import ResearchOutput

    tools = FakeTools({
        "web_search": SearchResult(
            query="q", hits=[SearchHit(url="https://blocked.org/a", title="A", snippet="a useful snippet")]
        ),
        "rag_query": RagResult(ok=False, error="offline"),
        "fetch_url": PageResult(ok=False, error="403"),
    })
    llm = FakeLLM([ResearchOutput(findings=[], summary="from snippets")])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await ResearcherWorker().execute(task(TaskType.RESEARCH), ctx)
    assert result.ok
    assert result.output["sources_read"] == 1


# ─── Web scraper ────────────────────────────────────────────────


def test_extraction_model_is_built_from_the_task_schema():
    model = build_extraction_model({"version": "the release version", "date": "the release date"})
    assert set(model.model_fields) == {"version", "date"}
    assert model().version == ""


def test_extraction_model_ignores_unusable_field_names():
    model = build_extraction_model({"not a field": "x"})
    assert "not a field" not in model.model_fields


async def test_scraper_escalates_to_the_browser_for_a_client_rendered_page(settings: Settings):
    tools = FakeTools({
        "fetch_url": PageResult(ok=False, error="static extraction produced 12 characters; the page is likely rendered client-side and needs the browser"),
        "browse": PageResult(page=Page(url="https://spa.org/a", title="App", text="rendered " * 100, fetched_with="playwright")),
    })
    ctx, events = make_ctx(settings, tools=tools)
    result = await WebScraperWorker().execute(task(TaskType.SCRAPE, url="https://spa.org/a"), ctx)
    assert result.ok
    assert [c[0] for c in tools.calls] == ["fetch_url", "browse"]
    assert any("browser" in (e.payload.get("message") or "") for e in events)


async def test_scraper_does_not_launch_the_browser_when_static_extraction_works(settings: Settings):
    tools = FakeTools({"fetch_url": PageResult(page=Page(url="https://a.org", title="A", text="text " * 100))})
    ctx, _ = make_ctx(settings, tools=tools)
    await WebScraperWorker().execute(task(TaskType.SCRAPE, url="https://a.org"), ctx)
    assert "browse" not in [c[0] for c in tools.calls]


async def test_scraper_inherits_urls_cited_upstream(settings: Settings):
    tools = FakeTools({"fetch_url": PageResult(page=Page(url="https://up.org/a", title="A", text="t " * 100))})
    upstream = {"t_prev01": WorkerResult(ok=True, citations=["https://up.org/a"])}
    ctx, _ = make_ctx(settings, tools=tools, upstream=upstream)
    result = await WebScraperWorker().execute(task(TaskType.SCRAPE), ctx)
    assert result.ok
    assert tools.calls[0][1]["url"] == "https://up.org/a"


async def test_scraper_reports_when_no_page_can_be_read(settings: Settings):
    tools = FakeTools({"fetch_url": PageResult(ok=False, error="404")})
    ctx, _ = make_ctx(settings, tools=tools)
    result = await WebScraperWorker().execute(task(TaskType.SCRAPE, url="https://gone.org/a"), ctx)
    assert not result.ok and "could be read" in result.error


# ─── Video analyst ──────────────────────────────────────────────


def _video() -> Video:
    return Video(
        id="abcdefghijk", title="A Talk", channel="A Channel", duration_s=600,
        url="https://www.youtube.com/watch?v=abcdefghijk",
        transcript=[Segment(start_s=float(i * 10), duration_s=10.0, text=f"line {i}") for i in range(30)],
    )


async def test_video_worker_returns_timestamped_moments(settings: Settings):
    from nexus_manager.workers.video_analyst import KeyMoment, VideoOutput

    tools = FakeTools({"youtube_transcript": VideoResult(video=_video())})
    llm = FakeLLM([VideoOutput(
        summary="The talk covers attention.",
        key_moments=[KeyMoment(ts=120.0, text="Defines attention")],
        action_items=["Read the paper"],
    )])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await VideoAnalystWorker().execute(
        task(TaskType.VIDEO, url="https://www.youtube.com/watch?v=abcdefghijk"), ctx
    )
    assert result.ok
    moment = result.output["key_moments"][0]
    assert moment["ts"] == 120.0
    assert moment["url"].endswith("t=120s")
    assert result.output["action_items"] == ["Read the paper"]


async def test_video_worker_discards_timestamps_outside_the_video(settings: Settings):
    from nexus_manager.workers.video_analyst import KeyMoment, VideoOutput

    tools = FakeTools({"youtube_transcript": VideoResult(video=_video())})
    llm = FakeLLM([VideoOutput(summary="s", key_moments=[KeyMoment(ts=99999.0, text="impossible")])])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await VideoAnalystWorker().execute(task(TaskType.VIDEO, url="https://youtu.be/abcdefghijk"), ctx)
    assert result.output["key_moments"] == []


async def test_video_worker_finds_the_url_in_the_goal_text(settings: Settings):
    from nexus_manager.workers.video_analyst import VideoOutput

    tools = FakeTools({"youtube_transcript": VideoResult(video=_video())})
    ctx, _ = make_ctx(settings, llm=FakeLLM([VideoOutput(summary="s")]), tools=tools)
    result = await VideoAnalystWorker().execute(
        task(TaskType.VIDEO, "Summarise https://www.youtube.com/watch?v=abcdefghijk please"), ctx
    )
    assert result.ok


async def test_video_worker_reports_a_missing_url(settings: Settings):
    ctx, _ = make_ctx(settings)
    ctx.goal = "no link anywhere"
    result = await VideoAnalystWorker().execute(task(TaskType.VIDEO, "summarise the talk"), ctx)
    assert not result.ok and "no YouTube URL" in result.error


async def test_video_worker_surfaces_an_unavailable_transcript(settings: Settings):
    tools = FakeTools({"youtube_transcript": VideoResult(ok=False, error="the video is private or unavailable")})
    ctx, _ = make_ctx(settings, tools=tools)
    result = await VideoAnalystWorker().execute(task(TaskType.VIDEO, url="https://youtu.be/abcdefghijk"), ctx)
    assert not result.ok and "private" in result.error


# ─── Coder ──────────────────────────────────────────────────────


async def test_coder_marks_verified_only_when_the_sandbox_exits_zero(settings: Settings):
    from nexus_manager.workers.coder import CodeOutput

    tools = FakeTools({"code_exec": ExecResult(ok=True, stdout="all checks passed", exit_code=0, duration_ms=50)})
    llm = FakeLLM([CodeOutput(language="python", code="assert 1 == 1\nprint('all checks passed')")])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await CoderWorker().execute(task(TaskType.CODE), ctx)
    assert result.ok
    assert result.output["verified"] is True
    assert result.output["attempts"] == 1


async def test_coder_iterates_on_failure_then_succeeds(settings: Settings):
    from nexus_manager.workers.coder import CodeOutput

    tools = FakeTools({"code_exec": [
        ExecResult(ok=True, stdout="", stderr="NameError", exit_code=1),
        ExecResult(ok=True, stdout="ok", exit_code=0),
    ]})
    llm = FakeLLM([CodeOutput(code="broken()"), CodeOutput(code="print('ok')")])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await CoderWorker().execute(task(TaskType.CODE), ctx)
    assert result.ok
    assert result.output["attempts"] == 2
    assert result.output["code"] == "print('ok')"


async def test_coder_gives_up_after_three_attempts_and_is_not_verified(settings: Settings):
    from nexus_manager.workers.coder import CodeOutput

    tools = FakeTools({"code_exec": ExecResult(ok=True, stdout="", stderr="err", exit_code=1)})
    llm = FakeLLM([CodeOutput(code=f"attempt{i}()") for i in range(5)])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await CoderWorker().execute(task(TaskType.CODE), ctx)
    assert not result.ok
    assert result.output["verified"] is False
    assert result.output["attempts"] == 3


async def test_coder_reports_an_unreachable_sandbox_distinctly(settings: Settings):
    from nexus_manager.workers.coder import CodeOutput

    tools = FakeTools({"code_exec": ExecResult(ok=False, exit_code=-1, error="sandbox unreachable")})
    llm = FakeLLM([CodeOutput(code="print(1)")])
    ctx, _ = make_ctx(settings, llm=llm, tools=tools)
    result = await CoderWorker().execute(task(TaskType.CODE), ctx)
    assert not result.ok and "sandbox unavailable" in result.error


# ─── Synthesizer ────────────────────────────────────────────────


async def test_synthesizer_merges_upstream_and_cites(settings: Settings):
    from nexus_manager.workers.synthesizer import SynthesisOutput

    upstream = {
        "t_res001": WorkerResult(
            ok=True, output={"summary": "Finding one.", "findings": []}, citations=["https://a.org"]
        ),
        "t_res002": WorkerResult(
            ok=True, output={"summary": "Finding two.", "findings": []}, citations=["https://b.org"]
        ),
    }
    llm = FakeLLM([SynthesisOutput(answer="Combined answer [1][2].", used_sources=[1, 2])])
    ctx, _ = make_ctx(settings, llm=llm, upstream=upstream)
    result = await SynthesizerWorker().execute(task(TaskType.SYNTHESIZE), ctx)
    assert result.ok
    assert result.citations == ["https://a.org", "https://b.org"]
    assert result.output["confidence"] == 1.0


async def test_synthesizer_still_answers_when_one_upstream_worker_failed(settings: Settings):
    """Degrading gracefully: a dead video tool must not cost the user the research."""
    from nexus_manager.workers.synthesizer import SynthesisOutput

    upstream = {
        "t_res001": WorkerResult(ok=True, output={"summary": "Research held up."}, citations=["https://a.org"]),
        "t_vid001": WorkerResult(ok=False, error="transcript unavailable"),
    }
    llm = FakeLLM([SynthesisOutput(answer="Partial answer [1].", used_sources=[1])])
    ctx, _ = make_ctx(settings, llm=llm, upstream=upstream)
    result = await SynthesizerWorker().execute(task(TaskType.SYNTHESIZE), ctx)
    assert result.ok
    assert result.output["tasks_failed"] == ["t_vid001"]
    assert result.output["confidence"] == 0.5


async def test_synthesizer_fails_when_everything_upstream_failed(settings: Settings):
    upstream = {"t_a": WorkerResult(ok=False, error="down"), "t_b": WorkerResult(ok=False, error="down")}
    ctx, _ = make_ctx(settings, upstream=upstream)
    result = await SynthesizerWorker().execute(task(TaskType.SYNTHESIZE), ctx)
    assert not result.ok and "every upstream task failed" in result.error


async def test_synthesizer_ignores_source_indices_out_of_range(settings: Settings):
    from nexus_manager.workers.synthesizer import SynthesisOutput

    upstream = {"t_a": WorkerResult(ok=True, output={"summary": "s"}, citations=["https://a.org"])}
    llm = FakeLLM([SynthesisOutput(answer="Answer [9].", used_sources=[9])])
    ctx, _ = make_ctx(settings, llm=llm, upstream=upstream)
    result = await SynthesizerWorker().execute(task(TaskType.SYNTHESIZE), ctx)
    assert result.citations == ["https://a.org"]


# ─── Budget tracker ─────────────────────────────────────────────


def test_spawn_cap_is_enforced():
    tracker = BudgetTracker(max_tokens=1000, max_usd=1.0, max_agents=2, max_depth=2)
    tracker.register_spawn()
    tracker.register_spawn()
    with pytest.raises(BudgetExceeded) as exc:
        tracker.register_spawn()
    assert exc.value.cap == "agents"


def test_depth_cap_is_enforced():
    tracker = BudgetTracker(max_tokens=1000, max_usd=1.0, max_agents=8, max_depth=2)
    with pytest.raises(BudgetExceeded) as exc:
        tracker.register_spawn(depth=3)
    assert exc.value.cap == "depth"


def test_token_cap_records_the_spend_that_already_happened():
    tracker = BudgetTracker(max_tokens=100, max_usd=1.0, max_agents=8, max_depth=2)
    with pytest.raises(BudgetExceeded) as exc:
        tracker.register_llm_call(150, 0.0)
    assert exc.value.cap == "tokens"
    assert tracker.tokens_used == 150


def test_cost_cap_is_enforced():
    tracker = BudgetTracker(max_tokens=1_000_000, max_usd=0.10, max_agents=8, max_depth=2)
    with pytest.raises(BudgetExceeded) as exc:
        tracker.register_llm_call(10, 0.25)
    assert exc.value.cap == "usd"


def test_can_spend_does_not_raise():
    tracker = BudgetTracker(max_tokens=100, max_usd=1.0, max_agents=8, max_depth=2)
    assert tracker.can_spend(50) is True
    assert tracker.can_spend(500) is False


def test_pressure_warns_once_per_cap():
    tracker = BudgetTracker(max_tokens=100, max_usd=10.0, max_agents=8, max_depth=2)
    tracker.tokens_used = 85
    assert tracker.pressure() == "tokens"
    assert tracker.pressure() is None


def test_snapshot_reports_every_cap():
    tracker = BudgetTracker(max_tokens=100, max_usd=1.0, max_agents=4, max_depth=2)
    tracker.register_spawn()
    snapshot = tracker.snapshot()
    assert snapshot.max_tokens == 100
    assert snapshot.agents_spawned == 1
    assert snapshot.exhausted is False
