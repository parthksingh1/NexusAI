"""End-to-end acceptance scenarios.

These run the whole system against real models, real websites and a real YouTube video. They
are slow by nature and are excluded from the default suite:

    pytest -m integration tests/integration/test_scenarios.py

Set MANAGER_TEST_PROVIDER to choose the model path (default ollama). On CPU-only hardware a
single local LLM call takes over a minute, so MANAGER_TEST_WORKER_TIMEOUT_S raises the
per-worker ceiling for these tests; the service default stays at the specified 90 seconds.
"""

from __future__ import annotations

import os
import time

import pytest

from nexus_manager.api.runs import RunService
from nexus_manager.config import Settings
from nexus_manager.graph.streaming import EventBus
from nexus_manager.llm.router import LLMRouter

pytestmark = pytest.mark.integration

PROVIDER = os.getenv("MANAGER_TEST_PROVIDER", "ollama")
WORKER_TIMEOUT_S = float(os.getenv("MANAGER_TEST_WORKER_TIMEOUT_S", "600"))
MAX_DURATION_S = float(os.getenv("MANAGER_TEST_MAX_DURATION_S", "180"))
MAX_USD = float(os.getenv("MANAGER_TEST_MAX_USD", "1.00"))

# A long-standing public talk with published captions.
VIDEO_URL = "https://www.youtube.com/watch?v=iDulhoQ2pro"


@pytest.fixture(scope="module")
def settings() -> Settings:
    return Settings(
        DATABASE_URL=None,
        DEFAULT_LLM_PROVIDER=PROVIDER,
        WORKER_TIMEOUT_S=WORKER_TIMEOUT_S,
        TOOL_TIMEOUT_S=45.0,
        MAX_USD=MAX_USD,
    )


@pytest.fixture(scope="module")
async def provider_available(settings: Settings) -> None:
    available = await LLMRouter(settings).available_providers()
    if not available.get(PROVIDER):
        pytest.skip(f"provider {PROVIDER!r} is not available in this environment")


async def run_goal(settings: Settings, goal: str) -> tuple[dict, float]:
    """Execute a goal end to end and return the run record plus its wall time."""
    service = RunService(settings=settings, bus=EventBus(settings))
    started = time.perf_counter()

    record = await service.start(goal, PROVIDER)  # type: ignore[arg-type]
    assert record.status != "error", f"planning failed: {record.reason}"

    task = service.store._tasks.get(record.run_id)
    if task is not None:
        await task

    final = service.store.get(record.run_id)
    assert final is not None
    return final.model_dump(mode="json"), time.perf_counter() - started


def assert_acceptance(run: dict, elapsed: float, *, min_citations: int = 2) -> None:
    """The bar every scenario has to clear."""
    assert run["status"] == "done", f"status={run['status']} reason={run.get('reason')}"
    assert run["answer"], "the run produced no answer"
    assert len(run["citations"]) >= min_citations, f"only {len(run['citations'])} citation(s)"
    assert run["budget"]["usd_spent"] < MAX_USD, f"spent ${run['budget']['usd_spent']}"
    assert elapsed < MAX_DURATION_S, f"took {elapsed:.0f}s, limit {MAX_DURATION_S:.0f}s"


# ─── Scenarios ──────────────────────────────────────────────────


async def test_most_starred_rag_frameworks(settings: Settings, provider_available) -> None:
    run, elapsed = await run_goal(
        settings,
        "Find the three most-starred open-source RAG frameworks on GitHub this year "
        "and summarise their differences with citations.",
    )
    assert_acceptance(run, elapsed)


async def test_video_summary_with_timestamps(settings: Settings, provider_available) -> None:
    run, elapsed = await run_goal(
        settings,
        f"Summarise the talk at {VIDEO_URL} and extract the key intuitions as bullets with timestamps.",
    )
    assert_acceptance(run, elapsed, min_citations=1)

    video_results = [r for r in run["results"].values() if r["output"].get("key_moments")]
    assert video_results, "no task produced timestamped key moments"
    moments = video_results[0]["output"]["key_moments"]
    assert all("t=" in m["url"] for m in moments), "key moments are not linked to their timestamp"


async def test_postgres_release_notes_table(settings: Settings, provider_available) -> None:
    run, elapsed = await run_goal(
        settings,
        "Read the PostgreSQL 17 release notes and produce a table of the most impactful "
        "changes for OLTP workloads.",
    )
    assert_acceptance(run, elapsed)


async def test_verified_rolling_zscore_implementation(settings: Settings, provider_available) -> None:
    run, elapsed = await run_goal(
        settings,
        "Write a Python function that computes a rolling z-score online using Welford's "
        "method, verify it against numpy on a random series, and return the code.",
    )
    assert run["status"] in {"done", "partial"}, f"status={run['status']} reason={run.get('reason')}"
    assert elapsed < MAX_DURATION_S

    code_results = [r for r in run["results"].values() if r["output"].get("code")]
    assert code_results, "no task produced code"
    # `verified` is only true when the sandbox actually exited zero.
    assert code_results[0]["output"].get("verified") is True, (
        f"the program did not run clean: {code_results[0]['output'].get('stderr', '')[:300]}"
    )


# ─── Degradation ────────────────────────────────────────────────


async def test_a_run_survives_a_tool_that_cannot_work(settings: Settings, provider_available) -> None:
    """A video task pointed at a video with no transcript must not cost the research."""
    broken = settings.model_copy(update={"sandbox_url": "http://127.0.0.1:9"})
    run, _ = await run_goal(
        broken,
        "Explain what the Welford online variance algorithm is and why it is numerically "
        "stable, with citations.",
    )
    assert run["status"] in {"done", "partial"}
    assert run["answer"], "the run returned nothing despite having usable research"
