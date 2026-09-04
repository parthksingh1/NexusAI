"""Tool tests against real services.

These reach the live internet. Run them with `-m integration`; the default suite excludes
nothing, so use `-m "not integration"` to skip them when offline.
"""

from __future__ import annotations

import pytest

from nexus_manager.config import Settings
from nexus_manager.tools import ToolRegistry
from nexus_manager.tools.fetch_url import fetch_url
from nexus_manager.tools.web_search import web_search
from nexus_manager.tools.youtube import youtube_transcript

pytestmark = pytest.mark.integration

# A stable, long-lived page with substantial prose and a permissive robots policy.
WIKIPEDIA_ARTICLE = "https://en.wikipedia.org/wiki/Algorithm"

# "Attention is all you need" explained by Yannic Kilcher — a long-standing public talk with
# published captions.
YOUTUBE_VIDEO = "https://www.youtube.com/watch?v=iDulhoQ2pro"


@pytest.fixture
def settings() -> Settings:
    return Settings(DATABASE_URL="postgresql://unused/unused", TOOL_TIMEOUT_S=45.0)


async def test_search_returns_real_results(settings: Settings):
    result = await web_search("Welford online variance algorithm", k=5, settings=settings)
    assert result.ok, result.error
    assert len(result.hits) >= 3
    assert all(h.url.startswith("http") for h in result.hits)
    assert any(h.title for h in result.hits)


async def test_fetch_real_article_extracts_prose(settings: Settings):
    result = await fetch_url(WIKIPEDIA_ARTICLE, settings=settings)
    assert result.ok, result.error
    page = result.page
    assert page is not None
    assert "algorithm" in page.text.lower()
    assert len(page.text) > 2000
    assert page.title
    assert len(page.links) > 5


async def test_real_youtube_transcript_is_read(settings: Settings):
    result = await youtube_transcript(YOUTUBE_VIDEO, settings=settings)
    if not result.ok:
        pytest.skip(f"transcript unavailable for the pinned video: {result.error}")
    video = result.video
    assert video is not None
    assert video.id == "iDulhoQ2pro"
    assert len(video.transcript) > 20
    assert len(video.full_text) > 1000
    assert video.transcript[0].start_s >= 0


async def test_registry_serves_a_real_search_and_caches_it(settings: Settings):
    registry = ToolRegistry(settings)
    first = await registry.call("web_search", query="pgvector postgres extension", k=5)
    assert first.ok, getattr(first, "error", None) or getattr(first, "message", None)
    second = await registry.call("web_search", query="pgvector postgres extension", k=5)
    assert first is second


async def test_registry_refuses_a_private_address(settings: Settings):
    result = await ToolRegistry(settings).call("fetch_url", url="http://169.254.169.254/latest/meta-data/")
    assert not result.ok
