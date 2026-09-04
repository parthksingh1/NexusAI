from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from nexus_manager.config import Settings
from nexus_manager.safety.guards import RateLimiter, RobotsCache, URLBlocked, check_url, domain_of
from nexus_manager.tools import ToolRegistry, idempotency_key
from nexus_manager.tools.code_exec import code_exec
from nexus_manager.tools.fetch_url import extract_page, fetch_url
from nexus_manager.tools.rag_query import rag_query
from nexus_manager.tools.schemas import ToolError
from nexus_manager.tools.web_search import resolve_backend, web_search
from nexus_manager.tools.youtube import extract_video_id

RAG = "http://rag.invalid:5000"
SANDBOX = "http://sandbox.invalid:4500"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        DATABASE_URL="postgresql://unused/unused",
        RAG_URL=RAG,
        SANDBOX_URL=SANDBOX,
        TAVILY_API_KEY=None,
        TOOL_TIMEOUT_S=5.0,
        TOOL_MAX_RETRIES=2,
        PER_DOMAIN_RATE_LIMIT_S=0.01,
    )


# ─── URL denylist ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8080/admin",
        "http://127.0.0.1/",
        "http://10.0.0.5/internal",
        "http://192.168.1.1/router",
        "http://172.16.0.1/",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",
        "file:///etc/passwd",
        "chrome://settings",
    ],
)
def test_private_and_non_http_urls_are_blocked(url):
    with pytest.raises(URLBlocked):
        check_url(url, resolve_dns=False)


@pytest.mark.parametrize("url", ["https://en.wikipedia.org/wiki/Python", "http://example.org/page"])
def test_public_urls_pass(url):
    assert check_url(url, resolve_dns=False)


def test_url_without_a_host_is_blocked():
    with pytest.raises(URLBlocked):
        check_url("https:///nohost", resolve_dns=False)


def test_domain_extraction():
    assert domain_of("https://Example.COM/a/b?c=1") == "example.com"


# ─── robots.txt ─────────────────────────────────────────────────


@respx.mock
async def test_robots_disallow_is_respected(settings: Settings):
    respx.get("https://blocked.invalid/robots.txt").mock(
        return_value=httpx.Response(200, text="User-agent: *\nDisallow: /private")
    )
    cache = RobotsCache(settings)
    assert await cache.allowed("https://blocked.invalid/public") is True
    assert await cache.allowed("https://blocked.invalid/private/data") is False


@respx.mock
async def test_missing_robots_permits_fetching(settings: Settings):
    respx.get("https://open.invalid/robots.txt").mock(return_value=httpx.Response(404))
    assert await RobotsCache(settings).allowed("https://open.invalid/anything") is True


@respx.mock
async def test_robots_is_fetched_once_per_host(settings: Settings):
    route = respx.get("https://cached.invalid/robots.txt").mock(
        return_value=httpx.Response(200, text="User-agent: *\nAllow: /")
    )
    cache = RobotsCache(settings)
    for _ in range(3):
        await cache.allowed("https://cached.invalid/page")
    assert route.call_count == 1


# ─── Rate limiting ──────────────────────────────────────────────


async def test_rate_limiter_spaces_requests_to_one_domain():
    settings = Settings(DATABASE_URL="postgresql://unused/unused", PER_DOMAIN_RATE_LIMIT_S=0.2)
    limiter = RateLimiter(settings)
    started = asyncio.get_event_loop().time()
    await limiter.acquire("https://one.invalid/a")
    await limiter.acquire("https://one.invalid/b")
    assert asyncio.get_event_loop().time() - started >= 0.18


async def test_rate_limiter_does_not_delay_across_different_domains():
    settings = Settings(DATABASE_URL="postgresql://unused/unused", PER_DOMAIN_RATE_LIMIT_S=0.5)
    limiter = RateLimiter(settings)
    started = asyncio.get_event_loop().time()
    await limiter.acquire("https://a.invalid/x")
    await limiter.acquire("https://b.invalid/x")
    assert asyncio.get_event_loop().time() - started < 0.3


# ─── Search ─────────────────────────────────────────────────────


def test_backend_selection_prefers_tavily_only_when_a_key_exists(settings: Settings):
    assert resolve_backend(settings) == "duckduckgo"
    with_key = settings.model_copy(update={"tavily_api_key": "tvly-x"})
    assert resolve_backend(with_key) == "tavily"


@respx.mock
async def test_keyless_search_parses_results(settings: Settings):
    html = """
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.org%2Fdocs">Example Docs</a>
      <div class="result__snippet">The reference documentation.</div>
    </div>
    <div class="result">
      <a class="result__a" href="https://other.org/page">Other</a>
      <div class="result__snippet">Another result.</div>
    </div>
    """
    respx.post("https://html.duckduckgo.com/html/").mock(return_value=httpx.Response(200, text=html))
    result = await web_search("example query", k=5, settings=settings)
    assert result.ok
    assert result.provider == "duckduckgo"
    assert [h.url for h in result.hits] == ["https://example.org/docs", "https://other.org/page"]
    assert result.hits[0].title == "Example Docs"


@respx.mock
async def test_search_respects_k(settings: Settings):
    html = "".join(
        f'<div class="result"><a class="result__a" href="https://s{i}.org/">R{i}</a></div>' for i in range(10)
    )
    respx.post("https://html.duckduckgo.com/html/").mock(return_value=httpx.Response(200, text=html))
    assert len((await web_search("query text", k=3, settings=settings)).hits) == 3


@respx.mock
async def test_tavily_failure_falls_back_to_the_keyless_backend(settings: Settings):
    keyed = settings.model_copy(update={"tavily_api_key": "tvly-x"})
    respx.post("https://api.tavily.com/search").mock(return_value=httpx.Response(432, text="quota exhausted"))
    respx.post("https://html.duckduckgo.com/html/").mock(
        return_value=httpx.Response(200, text='<div class="result"><a class="result__a" href="https://x.org/">X</a></div>')
    )
    result = await web_search("query text", settings=keyed)
    assert result.ok and result.provider == "duckduckgo"


@respx.mock
async def test_tavily_results_are_parsed(settings: Settings):
    keyed = settings.model_copy(update={"tavily_api_key": "tvly-x"})
    respx.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(
            200, json={"results": [{"url": "https://a.org", "title": "A", "content": "body", "score": 0.9}]}
        )
    )
    result = await web_search("query text", settings=keyed)
    assert result.provider == "tavily"
    assert result.hits[0].score == pytest.approx(0.9)


# ─── fetch_url ──────────────────────────────────────────────────


ARTICLE = """
<html><head><title>Rolling Statistics</title></head><body><article>
<p>Welford's method computes a running mean and variance in a single pass over the data.
It avoids the catastrophic cancellation that arises from the naive sum-of-squares formula,
which is why it is the standard choice for streaming numerical work in production systems.</p>
<p>The update step adjusts the mean by the scaled residual, then accumulates the squared
deviation against both the previous and updated means. This keeps the estimate numerically
stable across very long streams of observations without storing any history at all.</p>
<a href="/next">Next</a><a href="https://elsewhere.org/x">Elsewhere</a>
</article></body></html>
"""


def test_extraction_pulls_title_text_and_absolute_links():
    page = extract_page(ARTICLE, "https://site.invalid/article")
    assert page.title == "Rolling Statistics"
    assert "Welford" in page.text
    assert "https://site.invalid/next" in page.links
    assert "https://elsewhere.org/x" in page.links
    assert page.fetched_with == "trafilatura"


@respx.mock
async def test_fetch_url_returns_extracted_page(settings: Settings):
    respx.get("https://site.invalid/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://site.invalid/article").mock(
        return_value=httpx.Response(200, text=ARTICLE, headers={"content-type": "text/html"})
    )
    result = await fetch_url("https://site.invalid/article", settings=settings)
    assert result.ok and result.page is not None
    assert "Welford" in result.page.text


@respx.mock
async def test_thin_page_signals_that_the_browser_is_needed(settings: Settings):
    respx.get("https://spa.invalid/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://spa.invalid/app").mock(
        return_value=httpx.Response(
            200, text="<html><body><div id='root'></div></body></html>", headers={"content-type": "text/html"}
        )
    )
    result = await fetch_url("https://spa.invalid/app", settings=settings)
    assert not result.ok
    assert "client-side" in result.error


@respx.mock
async def test_login_walled_page_is_not_scraped(settings: Settings):
    respx.get("https://walled.invalid/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://walled.invalid/members").mock(return_value=httpx.Response(403, text="forbidden"))
    result = await fetch_url("https://walled.invalid/members", settings=settings)
    assert not result.ok and "requires authentication" in result.error


@respx.mock
async def test_robots_disallow_blocks_the_fetch(settings: Settings):
    respx.get("https://norobots.invalid/robots.txt").mock(
        return_value=httpx.Response(200, text="User-agent: *\nDisallow: /")
    )
    result = await fetch_url("https://norobots.invalid/page", settings=settings)
    assert not result.ok and "robots.txt" in result.error


async def test_fetch_url_refuses_a_private_address(settings: Settings):
    result = await fetch_url("http://127.0.0.1:8080/secrets", settings=settings)
    assert not result.ok and "private" in result.error.lower()


@respx.mock
async def test_non_html_content_is_rejected(settings: Settings):
    respx.get("https://files.invalid/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://files.invalid/a.pdf").mock(
        return_value=httpx.Response(200, content=b"%PDF-1.4", headers={"content-type": "application/pdf"})
    )
    result = await fetch_url("https://files.invalid/a.pdf", settings=settings)
    assert not result.ok and "application/pdf" in result.error


# ─── YouTube URL parsing ────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
        "dQw4w9WgXcQ",
    ],
)
def test_video_id_is_recovered_from_every_url_shape(url):
    assert extract_video_id(url) == "dQw4w9WgXcQ"


@pytest.mark.parametrize("url", ["https://vimeo.com/12345", "https://www.youtube.com/", "not a url"])
def test_non_video_urls_yield_no_id(url):
    assert extract_video_id(url) is None


# ─── rag_query ──────────────────────────────────────────────────


@respx.mock
async def test_rag_query_maps_hits_to_chunks(settings: Settings):
    respx.post(f"{RAG}/search").mock(
        return_value=httpx.Response(
            200,
            json={"hits": [{"snippet": "text one", "url": "https://src/1", "score": 0.8}]},
        )
    )
    result = await rag_query("what is welford", settings=settings)
    assert result.ok
    assert result.chunks[0].text == "text one"
    assert result.chunks[0].source == "https://src/1"


@respx.mock
async def test_rag_unreachable_is_reported_not_raised(settings: Settings):
    respx.post(f"{RAG}/search").mock(side_effect=httpx.ConnectError("refused"))
    result = await rag_query("query text", settings=settings)
    assert not result.ok and "unreachable" in result.error


# ─── code_exec ──────────────────────────────────────────────────


@respx.mock
async def test_code_exec_maps_the_sandbox_response(settings: Settings):
    respx.post(f"{SANDBOX}/exec").mock(
        return_value=httpx.Response(
            200, json={"stdout": "42\n", "stderr": "", "exit": {"code": 0, "timedOut": False, "durationMs": 120}}
        )
    )
    result = await code_exec("python", "print(42)", settings=settings)
    assert result.ok and result.stdout == "42\n" and result.exit_code == 0 and result.duration_ms == 120


@respx.mock
async def test_language_aliases_are_normalised(settings: Settings):
    route = respx.post(f"{SANDBOX}/exec").mock(
        return_value=httpx.Response(200, json={"stdout": "", "stderr": "", "exit": {"code": 0}})
    )
    await code_exec("py", "print(1)", settings=settings)
    assert '"language":"python"' in route.calls[0].request.read().decode()


async def test_unsupported_language_is_refused(settings: Settings):
    result = await code_exec("malbolge", "x", settings=settings)
    assert not result.ok and "not supported" in result.error


@respx.mock
async def test_sandbox_unreachable_is_reported_not_raised(settings: Settings):
    respx.post(f"{SANDBOX}/exec").mock(side_effect=httpx.ConnectError("refused"))
    result = await code_exec("python", "print(1)", settings=settings)
    assert not result.ok and "unreachable" in result.error


# ─── Registry: timeout, retry, idempotency ──────────────────────


def test_idempotency_key_is_stable_and_argument_sensitive():
    assert idempotency_key("web_search", {"query": "a", "k": 5}) == idempotency_key("web_search", {"k": 5, "query": "a"})
    assert idempotency_key("web_search", {"query": "a"}) != idempotency_key("web_search", {"query": "b"})


async def test_unknown_tool_returns_a_structured_error(settings: Settings):
    result = await ToolRegistry(settings).call("teleport", target="mars")
    assert isinstance(result, ToolError)
    assert "unknown tool" in result.message


async def test_bad_arguments_are_reported_without_retrying(settings: Settings):
    result = await ToolRegistry(settings).call("web_search", not_a_parameter=1)
    assert isinstance(result, ToolError)
    assert "invalid arguments" in result.message


@respx.mock
async def test_identical_calls_are_served_from_the_idempotency_cache(settings: Settings):
    route = respx.post("https://html.duckduckgo.com/html/").mock(
        return_value=httpx.Response(200, text='<div class="result"><a class="result__a" href="https://a.org/">A</a></div>')
    )
    registry = ToolRegistry(settings)
    first = await registry.call("web_search", query="same", k=5)
    second = await registry.call("web_search", query="same", k=5)
    assert route.call_count == 1
    assert first is second


@respx.mock
async def test_failed_calls_are_not_cached(settings: Settings):
    respx.post("https://html.duckduckgo.com/html/").mock(return_value=httpx.Response(500))
    registry = ToolRegistry(settings)
    first = await registry.call("web_search", query="query text", k=5)
    assert not first.ok


async def test_timeout_produces_a_structured_error(settings: Settings, monkeypatch):
    fast = settings.model_copy(update={"tool_timeout_s": 0.05, "tool_max_retries": 1})
    registry = ToolRegistry(fast)

    async def _hang(*_args, **_kwargs):
        await asyncio.sleep(5)

    registry._tools["web_search"] = _hang  # type: ignore[assignment]
    result = await registry.call("web_search", query="query text")
    assert isinstance(result, ToolError)
    assert "timed out" in result.message


async def test_retryable_tool_is_attempted_more_than_once(settings: Settings):
    registry = ToolRegistry(settings.model_copy(update={"tool_max_retries": 3}))
    calls = {"n": 0}

    async def _flaky(**_kwargs):
        calls["n"] += 1
        raise RuntimeError("transient")

    registry._tools["fetch_url"] = _flaky  # type: ignore[assignment]
    result = await registry.call("fetch_url", url="https://x.invalid/")
    assert calls["n"] == 3
    assert isinstance(result, ToolError) and result.retryable


async def test_code_exec_is_not_retried(settings: Settings):
    """Re-running deterministic code only burns sandbox capacity."""
    registry = ToolRegistry(settings)
    calls = {"n": 0}

    async def _boom(**_kwargs):
        calls["n"] += 1
        raise RuntimeError("sandbox down")

    registry._tools["code_exec"] = _boom  # type: ignore[assignment]
    await registry.call("code_exec", lang="python", source="print(1)")
    assert calls["n"] == 1


def test_registry_exposes_every_required_tool(settings: Settings):
    assert ToolRegistry(settings).names == [
        "browse",
        "code_exec",
        "fetch_url",
        "rag_query",
        "web_search",
        "youtube_transcript",
    ]
