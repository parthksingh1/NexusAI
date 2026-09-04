"""Cloud providers: Anthropic, OpenAI and Gemini.

Structured output goes through Instructor's unified `from_provider` entry point, which
constrains decoding with the Pydantic model's schema. Plain chat and streaming use each
vendor's native async SDK, because Instructor's surface is built around a response model
and there is nothing to gain from routing unstructured calls through it.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import TypeVar

from pydantic import BaseModel

from ...config import Settings
from ..models import (
    ChatRequest,
    ChatResponse,
    LLMCallError,
    Message,
    ProviderUnavailable,
    TokenUsage,
    price_call,
)
from .base import BaseProvider

T = TypeVar("T", bound=BaseModel)

# Maps our provider name onto Instructor's "vendor/model" string.
_INSTRUCTOR_VENDOR = {"anthropic": "anthropic", "openai": "openai", "gemini": "google"}


def _split_system(messages: list[Message]) -> tuple[str | None, list[dict]]:
    """Anthropic and Gemini take the system prompt as a separate argument rather than as a
    message with role=system."""
    system_parts = [m.content for m in messages if m.role == "system"]
    rest = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]
    return ("\n\n".join(system_parts) or None), rest


class CloudProvider(BaseProvider):
    """Base for the three paid providers. Subclasses supply plain chat and streaming."""

    def __init__(self, name: str, settings: Settings) -> None:
        self.name = name
        self._settings = settings
        self._api_key = settings.key_for(name)  # type: ignore[arg-type]

    def resolve_model(self, req: ChatRequest) -> str:
        return req.model or self._settings.default_model_for(self.name)  # type: ignore[arg-type]

    async def available(self) -> bool:
        return bool(self._api_key)

    def _require_key(self) -> str:
        if not self._api_key:
            raise ProviderUnavailable(
                f"{self.name} is not configured. Set {self.name.upper()}_API_KEY "
                f"(GOOGLE_API_KEY for gemini) to use this provider."
            )
        return self._api_key

    def _usage_from(self, raw: object) -> TokenUsage:
        """Read token counts off whichever response object the vendor returned."""
        usage = getattr(raw, "usage", None)
        if usage is not None:
            # Anthropic: input_tokens/output_tokens. OpenAI: prompt_tokens/completion_tokens.
            prompt = getattr(usage, "input_tokens", None)
            if prompt is None:
                prompt = getattr(usage, "prompt_tokens", 0)
            completion = getattr(usage, "output_tokens", None)
            if completion is None:
                completion = getattr(usage, "completion_tokens", 0)
            return TokenUsage(prompt_tokens=int(prompt or 0), completion_tokens=int(completion or 0))

        meta = getattr(raw, "usage_metadata", None)  # Gemini
        if meta is not None:
            return TokenUsage(
                prompt_tokens=int(getattr(meta, "prompt_token_count", 0) or 0),
                completion_tokens=int(getattr(meta, "candidates_token_count", 0) or 0),
            )
        return TokenUsage()

    async def chat_structured(self, req: ChatRequest, response_model: type[T]) -> tuple[T, ChatResponse]:
        import instructor

        self._require_key()
        model = self.resolve_model(req)
        vendor = _INSTRUCTOR_VENDOR[self.name]
        started = time.perf_counter()
        try:
            client = instructor.from_provider(f"{vendor}/{model}", async_client=True)
            parsed, raw = await client.chat.completions.create_with_completion(
                messages=[m.model_dump() for m in req.messages],
                response_model=response_model,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
            )
        except ProviderUnavailable:
            raise
        except Exception as exc:
            raise LLMCallError(f"{self.name} structured call failed: {exc}") from exc

        usage = self._usage_from(raw)
        response = ChatResponse(
            content=parsed.model_dump_json(),
            usage=usage,
            model=model,
            provider=self.name,
            latency_ms=int((time.perf_counter() - started) * 1000),
            cost_usd=price_call(self.name, model, usage),
        )
        return parsed, response


class AnthropicProvider(CloudProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__("anthropic", settings)

    def _client(self):
        from anthropic import AsyncAnthropic

        return AsyncAnthropic(api_key=self._require_key())

    async def chat(self, req: ChatRequest) -> ChatResponse:
        model = self.resolve_model(req)
        system, messages = _split_system(req.messages)
        started = time.perf_counter()
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": req.max_tokens,
                "temperature": req.temperature,
            }
            if system:
                kwargs["system"] = system
            if req.stop:
                kwargs["stop_sequences"] = req.stop
            resp = await self._client().messages.create(**kwargs)
        except ProviderUnavailable:
            raise
        except Exception as exc:
            raise LLMCallError(f"anthropic call failed: {exc}") from exc

        text = "".join(block.text for block in resp.content if getattr(block, "type", None) == "text")
        usage = self._usage_from(resp)
        return ChatResponse(
            content=text,
            usage=usage,
            model=model,
            provider=self.name,
            latency_ms=int((time.perf_counter() - started) * 1000),
            cost_usd=price_call(self.name, model, usage),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[str]:
        model = self.resolve_model(req)
        system, messages = _split_system(req.messages)
        kwargs = {"model": model, "messages": messages, "max_tokens": req.max_tokens, "temperature": req.temperature}
        if system:
            kwargs["system"] = system
        async with self._client().messages.stream(**kwargs) as stream:
            async for piece in stream.text_stream:
                yield piece


class OpenAIProvider(CloudProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__("openai", settings)

    def _client(self):
        from openai import AsyncOpenAI

        return AsyncOpenAI(api_key=self._require_key())

    async def chat(self, req: ChatRequest) -> ChatResponse:
        model = self.resolve_model(req)
        started = time.perf_counter()
        try:
            resp = await self._client().chat.completions.create(
                model=model,
                messages=[m.model_dump() for m in req.messages],
                max_tokens=req.max_tokens,
                temperature=req.temperature,
                stop=req.stop or None,
            )
        except ProviderUnavailable:
            raise
        except Exception as exc:
            raise LLMCallError(f"openai call failed: {exc}") from exc

        usage = self._usage_from(resp)
        return ChatResponse(
            content=resp.choices[0].message.content or "",
            usage=usage,
            model=model,
            provider=self.name,
            latency_ms=int((time.perf_counter() - started) * 1000),
            cost_usd=price_call(self.name, model, usage),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[str]:
        model = self.resolve_model(req)
        stream = await self._client().chat.completions.create(
            model=model,
            messages=[m.model_dump() for m in req.messages],
            max_tokens=req.max_tokens,
            temperature=req.temperature,
            stream=True,
        )
        async for chunk in stream:
            piece = chunk.choices[0].delta.content
            if piece:
                yield piece


class GeminiProvider(CloudProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__("gemini", settings)

    def _client(self):
        from google import genai

        return genai.Client(api_key=self._require_key())

    def _contents(self, req: ChatRequest) -> tuple[str | None, list[dict]]:
        system, messages = _split_system(req.messages)
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
        ]
        return system, contents

    async def chat(self, req: ChatRequest) -> ChatResponse:
        model = self.resolve_model(req)
        system, contents = self._contents(req)
        started = time.perf_counter()
        config: dict = {"temperature": req.temperature, "max_output_tokens": req.max_tokens}
        if system:
            config["system_instruction"] = system
        if req.stop:
            config["stop_sequences"] = req.stop
        try:
            resp = await self._client().aio.models.generate_content(
                model=model, contents=contents, config=config
            )
        except ProviderUnavailable:
            raise
        except Exception as exc:
            raise LLMCallError(f"gemini call failed: {exc}") from exc

        usage = self._usage_from(resp)
        return ChatResponse(
            content=resp.text or "",
            usage=usage,
            model=model,
            provider=self.name,
            latency_ms=int((time.perf_counter() - started) * 1000),
            cost_usd=price_call(self.name, model, usage),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[str]:
        model = self.resolve_model(req)
        system, contents = self._contents(req)
        config: dict = {"temperature": req.temperature, "max_output_tokens": req.max_tokens}
        if system:
            config["system_instruction"] = system
        stream = await self._client().aio.models.generate_content_stream(
            model=model, contents=contents, config=config
        )
        async for chunk in stream:
            if chunk.text:
                yield chunk.text
