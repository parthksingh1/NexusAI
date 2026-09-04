"""Provider interface. Each concrete provider adapts one vendor SDK to these three calls."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import TypeVar

from pydantic import BaseModel

from ..models import ChatRequest, ChatResponse

T = TypeVar("T", bound=BaseModel)


class BaseProvider(ABC):
    name: str

    @abstractmethod
    async def chat(self, req: ChatRequest) -> ChatResponse: ...

    @abstractmethod
    async def chat_structured(self, req: ChatRequest, response_model: type[T]) -> tuple[T, ChatResponse]:
        """Return the parsed model alongside the raw response, so the caller can account for
        tokens and cost even when it only cares about the structured value."""

    @abstractmethod
    def stream(self, req: ChatRequest) -> AsyncIterator[str]: ...

    async def available(self) -> bool:
        """Whether this provider can currently serve a call."""
        return True

    def resolve_model(self, req: ChatRequest) -> str:
        raise NotImplementedError
