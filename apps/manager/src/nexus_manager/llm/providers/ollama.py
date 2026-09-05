"""Ollama provider — the free, local path.

Structured output uses Ollama's native JSON mode with the Pydantic model's JSON schema as
the `format` argument, which constrains decoding rather than asking the model politely.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ...config import Settings
from ..models import ChatRequest, ChatResponse, LLMCallError, ProviderUnavailable, TokenUsage, price_call
from .base import BaseProvider

T = TypeVar("T", bound=BaseModel)


class OllamaProvider(BaseProvider):
    name = "ollama"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._host = settings.ollama_host.rstrip("/")

    def resolve_model(self, req: ChatRequest) -> str:
        return req.model or self._settings.ollama_default_model

    async def available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._host}/api/tags")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._host}/api/tags")
                resp.raise_for_status()
                return [m["name"] for m in resp.json().get("models", [])]
        except (httpx.HTTPError, KeyError, ValueError):
            return []

    def _payload(self, req: ChatRequest, model: str, *, fmt: dict | None = None) -> dict:
        payload: dict = {
            "model": model,
            "messages": [m.model_dump() for m in req.messages],
            "stream": False,
            "options": {"temperature": req.temperature, "num_predict": req.max_tokens},
        }
        if req.stop:
            payload["options"]["stop"] = req.stop
        if fmt is not None:
            payload["format"] = fmt
        return payload

    def _to_response(self, data: dict, model: str, started: float) -> ChatResponse:
        usage = TokenUsage(
            prompt_tokens=int(data.get("prompt_eval_count") or 0),
            completion_tokens=int(data.get("eval_count") or 0),
        )
        return ChatResponse(
            content=(data.get("message") or {}).get("content", ""),
            usage=usage,
            model=model,
            provider=self.name,
            latency_ms=int((time.perf_counter() - started) * 1000),
            cost_usd=price_call(self.name, model, usage),
        )

    async def _post(self, path: str, payload: dict, timeout: float) -> dict:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(f"{self._host}{path}", json=payload)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise ProviderUnavailable(f"Ollama at {self._host} is unreachable: {exc}") from exc
        except httpx.ReadTimeout as exc:
            model = payload.get("model")
            raise LLMCallError(
                f"Ollama model {model!r} did not respond within {timeout:.0f}s. On CPU-only hardware a "
                f"large structured response can exceed this; use a smaller model or raise OLLAMA_TIMEOUT_S."
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"Ollama at {self._host} is unreachable: {exc}") from exc
        if resp.status_code == 404:
            raise LLMCallError(f"Ollama model not found: {payload.get('model')!r}. Pull it with `ollama pull`.")
        if resp.status_code >= 400:
            raise LLMCallError(f"Ollama returned {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    async def chat(self, req: ChatRequest) -> ChatResponse:
        model = self.resolve_model(req)
        started = time.perf_counter()
        data = await self._post("/api/chat", self._payload(req, model), timeout=self._settings.ollama_timeout_s)
        return self._to_response(data, model, started)

    async def chat_structured(self, req: ChatRequest, response_model: type[T]) -> tuple[T, ChatResponse]:
        model = self.resolve_model(req)
        started = time.perf_counter()
        schema = response_model.model_json_schema()
        data = await self._post("/api/chat", self._payload(req, model, fmt=schema), timeout=self._settings.ollama_timeout_s)
        response = self._to_response(data, model, started)
        try:
            parsed = response_model.model_validate_json(response.content)
        except (ValidationError, json.JSONDecodeError) as exc:
            raise LLMCallError(
                f"Ollama model {model} returned output that does not satisfy {response_model.__name__}: {exc}"
            ) from exc
        return parsed, response

    async def stream(self, req: ChatRequest) -> AsyncIterator[str]:
        model = self.resolve_model(req)
        payload = self._payload(req, model)
        payload["stream"] = True
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                async with client.stream("POST", f"{self._host}/api/chat", json=payload) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode()[:300]
                        raise LLMCallError(f"Ollama returned {resp.status_code}: {body}")
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        piece = (chunk.get("message") or {}).get("content", "")
                        if piece:
                            yield piece
                        if chunk.get("done"):
                            return
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"Ollama at {self._host} is unreachable: {exc}") from exc
