"""One interface across local and cloud models.

The router deliberately does not fall back between providers. If a run was started against
Ollama and Ollama is down, it raises `ProviderUnavailable` rather than quietly reaching for
a paid API — spending a user's money without consent is worse than failing the run.
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator
from typing import TypeVar

import structlog
from pydantic import BaseModel

from ..config import Provider, Settings
from ..config import settings as default_settings
from ..observability import metrics
from .models import (
    ChatRequest,
    ChatResponse,
    LLMCallError,
    Message,
    ProviderUnavailable,
)
from .providers.base import BaseProvider
from .providers.cloud import AnthropicProvider, GeminiProvider, OpenAIProvider
from .providers.ollama import OllamaProvider

log = structlog.get_logger(__name__)

T = TypeVar("T", bound=BaseModel)

# Status codes worth retrying. Anything else is a client mistake that a retry repeats.
_RETRYABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}


def _is_retryable(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if isinstance(status, int):
        return status in _RETRYABLE_STATUS
    text = str(exc).lower()
    if any(token in text for token in ("rate limit", "429", "overloaded", "timeout", "timed out")):
        return True
    return any(f" {code}" in text or f"{code} " in text for code in ("500", "502", "503", "504"))


class LLMRouter:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or default_settings
        self._providers: dict[str, BaseProvider] = {
            "ollama": OllamaProvider(self._settings),
            "anthropic": AnthropicProvider(self._settings),
            "openai": OpenAIProvider(self._settings),
            "gemini": GeminiProvider(self._settings),
        }

    # ─── Provider access ────────────────────────────────────────

    def _pick(self, provider: Provider | None) -> BaseProvider:
        name = provider or self._settings.default_llm_provider
        if name not in self._providers:
            raise ProviderUnavailable(f"unknown provider {name!r}")
        return self._providers[name]

    async def available_providers(self) -> dict[str, bool]:
        """Which providers can serve a call right now: cloud keys present, Ollama reachable."""
        names = list(self._providers)
        checks = await asyncio.gather(
            *(self._providers[n].available() for n in names), return_exceptions=True
        )
        return {n: (c is True) for n, c in zip(names, checks, strict=True)}

    async def ollama_models(self) -> list[str]:
        provider = self._providers["ollama"]
        assert isinstance(provider, OllamaProvider)
        return await provider.list_models()

    # ─── Retry ──────────────────────────────────────────────────

    async def _with_retries(self, provider: BaseProvider, model: str, kind: str, call):
        """Exponential backoff with jitter on transient failures only.

        `ProviderUnavailable` is never retried: if Ollama is not running, waiting will not
        start it, and the caller needs that answer immediately.
        """
        attempts = 3
        delay = 0.5
        last: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                return await call()
            except ProviderUnavailable:
                metrics.llm_calls_total.labels(provider.name, model, "unavailable").inc()
                raise
            except Exception as exc:
                last = exc
                if attempt == attempts or not _is_retryable(exc):
                    break
                sleep_for = delay * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
                log.warning(
                    "llm_retry",
                    provider=provider.name,
                    model=model,
                    kind=kind,
                    attempt=attempt,
                    sleep_s=round(sleep_for, 2),
                    error=str(exc)[:200],
                )
                await asyncio.sleep(sleep_for)

        metrics.llm_calls_total.labels(provider.name, model, "error").inc()
        raise LLMCallError(f"{provider.name}/{model} failed after {attempts} attempt(s): {last}") from last

    def _record(self, response: ChatResponse) -> None:
        labels = (response.provider, response.model)
        metrics.llm_latency_ms.labels(*labels).observe(response.latency_ms)
        metrics.llm_tokens_total.labels(*labels, "prompt").inc(response.usage.prompt_tokens)
        metrics.llm_tokens_total.labels(*labels, "completion").inc(response.usage.completion_tokens)
        metrics.llm_calls_total.labels(*labels, "success").inc()
        if response.cost_usd:
            metrics.llm_cost_usd_total.labels(*labels).inc(response.cost_usd)

    # ─── Public API ─────────────────────────────────────────────

    async def chat(
        self,
        messages: list[Message] | list[dict],
        *,
        provider: Provider | None = None,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> ChatResponse:
        target = self._pick(provider)
        req = ChatRequest(
            messages=[m if isinstance(m, Message) else Message(**m) for m in messages],
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            stop=stop,
        )
        resolved = target.resolve_model(req)
        response = await self._with_retries(target, resolved, "chat", lambda: target.chat(req))
        self._record(response)
        return response

    async def chat_structured(
        self,
        messages: list[Message] | list[dict],
        response_model: type[T],
        *,
        provider: Provider | None = None,
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> tuple[T, ChatResponse]:
        """Return a validated Pydantic instance plus the raw response for accounting.

        Ollama constrains decoding with the model's JSON schema; the cloud providers use
        Instructor. Neither path parses JSON out of prose with a regex.
        """
        target = self._pick(provider)
        req = ChatRequest(
            messages=[m if isinstance(m, Message) else Message(**m) for m in messages],
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        resolved = target.resolve_model(req)
        parsed, response = await self._with_retries(
            target, resolved, "structured", lambda: target.chat_structured(req, response_model)
        )
        self._record(response)
        return parsed, response

    async def stream(
        self,
        messages: list[Message] | list[dict],
        *,
        provider: Provider | None = None,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        target = self._pick(provider)
        req = ChatRequest(
            messages=[m if isinstance(m, Message) else Message(**m) for m in messages],
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        async for piece in target.stream(req):
            yield piece
