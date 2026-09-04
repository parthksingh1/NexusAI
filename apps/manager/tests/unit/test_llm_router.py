from __future__ import annotations

import httpx
import pytest
import respx
from pydantic import BaseModel

from nexus_manager.config import Settings
from nexus_manager.llm.models import (
    LLMCallError,
    Message,
    ProviderUnavailable,
    TokenUsage,
    price_call,
)
from nexus_manager.llm.router import LLMRouter, _is_retryable

OLLAMA = "http://ollama.invalid:11434"


class Answer(BaseModel):
    city: str
    population_millions: float


@pytest.fixture
def settings() -> Settings:
    return Settings(
        DATABASE_URL="postgresql://unused/unused",
        OLLAMA_HOST=OLLAMA,
        OLLAMA_DEFAULT_MODEL="llama3:8b",
        DEFAULT_LLM_PROVIDER="ollama",
        ANTHROPIC_API_KEY=None,
        OPENAI_API_KEY=None,
        GOOGLE_API_KEY=None,
    )


@pytest.fixture
def router(settings: Settings) -> LLMRouter:
    return LLMRouter(settings)


def _chat_body(content: str, prompt_tokens: int = 11, completion_tokens: int = 7) -> dict:
    return {
        "model": "llama3:8b",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "prompt_eval_count": prompt_tokens,
        "eval_count": completion_tokens,
    }


# ─── Pricing ────────────────────────────────────────────────────


def test_local_inference_is_free():
    usage = TokenUsage(prompt_tokens=10_000, completion_tokens=10_000)
    assert price_call("ollama", "llama3:8b", usage) == 0.0


def test_known_model_is_priced_per_million_tokens():
    usage = TokenUsage(prompt_tokens=1_000_000, completion_tokens=1_000_000)
    assert price_call("anthropic", "claude-sonnet-5", usage) == pytest.approx(18.00)


def test_unknown_model_is_charged_rather_than_treated_as_free():
    """An unpriced cloud model must still consume budget, or it becomes a way to spend
    without the tracker noticing."""
    usage = TokenUsage(prompt_tokens=1_000_000, completion_tokens=0)
    assert price_call("openai", "some-unreleased-model", usage) > 0


# ─── Retry classification ───────────────────────────────────────


@pytest.mark.parametrize("message", ["rate limit exceeded", "429 Too Many Requests", "server overloaded", "timed out"])
def test_transient_failures_are_retryable(message):
    assert _is_retryable(Exception(message))


@pytest.mark.parametrize("message", ["invalid api key", "400 bad request", "not found"])
def test_client_errors_are_not_retryable(message):
    assert not _is_retryable(Exception(message))


def test_status_code_attribute_drives_classification():
    retryable = type("E", (Exception,), {"status_code": 503})()
    fatal = type("E", (Exception,), {"status_code": 401})()
    assert _is_retryable(retryable)
    assert not _is_retryable(fatal)


# ─── Ollama chat ────────────────────────────────────────────────


@respx.mock
async def test_chat_returns_content_usage_and_zero_cost(router: LLMRouter):
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=_chat_body("Paris")))
    resp = await router.chat([Message(role="user", content="capital of France?")])
    assert resp.content == "Paris"
    assert resp.provider == "ollama"
    assert resp.usage.total_tokens == 18
    assert resp.cost_usd == 0.0
    assert resp.latency_ms >= 0


@respx.mock
async def test_chat_accepts_plain_dict_messages(router: LLMRouter):
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=_chat_body("ok")))
    resp = await router.chat([{"role": "user", "content": "hello"}])
    assert resp.content == "ok"


@respx.mock
async def test_unreachable_ollama_raises_rather_than_using_a_paid_provider(router: LLMRouter):
    """The cost-leak footgun this guards against: silently switching to a billed API."""
    respx.post(f"{OLLAMA}/api/chat").mock(side_effect=httpx.ConnectError("connection refused"))
    with pytest.raises(ProviderUnavailable):
        await router.chat([Message(role="user", content="hi")])


@respx.mock
async def test_missing_model_reports_how_to_fix_it(router: LLMRouter):
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(404, text="model not found"))
    with pytest.raises(LLMCallError, match="ollama pull"):
        await router.chat([Message(role="user", content="hi")])


@respx.mock
async def test_server_error_is_retried_then_succeeds(router: LLMRouter):
    route = respx.post(f"{OLLAMA}/api/chat").mock(
        side_effect=[
            httpx.Response(503, text="overloaded"),
            httpx.Response(200, json=_chat_body("recovered")),
        ]
    )
    resp = await router.chat([Message(role="user", content="hi")])
    assert resp.content == "recovered"
    assert route.call_count == 2


@respx.mock
async def test_client_error_is_not_retried(router: LLMRouter):
    route = respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(400, text="bad request"))
    with pytest.raises(LLMCallError):
        await router.chat([Message(role="user", content="hi")])
    assert route.call_count == 1


@respx.mock
async def test_retries_give_up_after_three_attempts(router: LLMRouter):
    route = respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(503, text="down"))
    with pytest.raises(LLMCallError):
        await router.chat([Message(role="user", content="hi")])
    assert route.call_count == 3


# ─── Ollama structured output ───────────────────────────────────


@respx.mock
async def test_structured_output_is_validated_against_the_model(router: LLMRouter):
    body = _chat_body('{"city": "Paris", "population_millions": 2.1}')
    route = respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=body))
    parsed, resp = await router.chat_structured([Message(role="user", content="capital?")], Answer)
    assert parsed.city == "Paris"
    assert parsed.population_millions == pytest.approx(2.1)
    assert resp.usage.total_tokens == 18
    # The schema constrains decoding rather than being requested in prose.
    assert '"format"' in route.calls[0].request.read().decode()


@respx.mock
async def test_structured_output_that_violates_the_schema_is_an_error(router: LLMRouter):
    body = _chat_body('{"city": "Paris"}')  # population_millions missing
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=body))
    with pytest.raises(LLMCallError, match="Answer"):
        await router.chat_structured([Message(role="user", content="capital?")], Answer)


@respx.mock
async def test_non_json_structured_output_is_an_error_not_a_regex_rescue(router: LLMRouter):
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=_chat_body("Paris is the capital.")))
    with pytest.raises(LLMCallError):
        await router.chat_structured([Message(role="user", content="capital?")], Answer)


# ─── Streaming ──────────────────────────────────────────────────


@respx.mock
async def test_stream_yields_content_pieces(router: LLMRouter):
    lines = (
        '{"message":{"content":"Hello"},"done":false}\n'
        '{"message":{"content":" world"},"done":false}\n'
        '{"message":{"content":""},"done":true}\n'
    )
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, text=lines))
    pieces = [p async for p in router.stream([Message(role="user", content="hi")])]
    assert "".join(pieces) == "Hello world"


# ─── Provider selection ─────────────────────────────────────────


async def test_unknown_provider_is_rejected(router: LLMRouter):
    with pytest.raises(ProviderUnavailable, match="unknown provider"):
        await router.chat([Message(role="user", content="hi")], provider="mistral")  # type: ignore[arg-type]


async def test_cloud_provider_without_key_reports_which_variable_to_set(router: LLMRouter):
    with pytest.raises(ProviderUnavailable, match="ANTHROPIC_API_KEY"):
        await router.chat([Message(role="user", content="hi")], provider="anthropic")


async def test_gemini_names_google_api_key_not_gemini_api_key(router: LLMRouter):
    with pytest.raises(ProviderUnavailable, match="GOOGLE_API_KEY"):
        await router.chat([Message(role="user", content="hi")], provider="gemini")


@respx.mock
async def test_available_providers_reflects_keys_and_reachability(settings: Settings):
    respx.get(f"{OLLAMA}/api/tags").mock(return_value=httpx.Response(200, json={"models": []}))
    router = LLMRouter(settings)
    available = await router.available_providers()
    assert available["ollama"] is True
    assert available["anthropic"] is False
    assert available["gemini"] is False


@respx.mock
async def test_available_providers_marks_ollama_down_when_unreachable(settings: Settings):
    respx.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("refused"))
    router = LLMRouter(settings)
    assert (await router.available_providers())["ollama"] is False


@respx.mock
async def test_cloud_key_presence_enables_the_provider():
    respx.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("refused"))
    router = LLMRouter(
        Settings(DATABASE_URL="postgresql://unused/unused", OLLAMA_HOST=OLLAMA, ANTHROPIC_API_KEY="sk-ant-real")
    )
    assert (await router.available_providers())["anthropic"] is True


@respx.mock
async def test_ollama_models_are_listed(router: LLMRouter):
    respx.get(f"{OLLAMA}/api/tags").mock(
        return_value=httpx.Response(200, json={"models": [{"name": "llama3:8b"}, {"name": "qwen2.5:14b"}]})
    )
    assert await router.ollama_models() == ["llama3:8b", "qwen2.5:14b"]


@respx.mock
async def test_model_override_is_sent_to_the_provider(router: LLMRouter):
    route = respx.post(f"{OLLAMA}/api/chat").mock(return_value=httpx.Response(200, json=_chat_body("ok")))
    await router.chat([Message(role="user", content="hi")], model="mistral:7b")
    assert '"model":"mistral:7b"' in route.calls[0].request.read().decode()
