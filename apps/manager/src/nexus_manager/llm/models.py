"""Request/response contracts for the LLM router, plus the pricing table used to cost calls.

Prices are USD per million tokens. Local models cost nothing, which is why the free path is
worth keeping distinct from the paid one rather than silently interchangeable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["system", "user", "assistant"]


class Message(BaseModel):
    role: Role
    content: str


class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class ChatRequest(BaseModel):
    messages: list[Message] = Field(..., min_length=1)
    model: str | None = None
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, gt=0)
    stop: list[str] | None = None


class ChatResponse(BaseModel):
    content: str
    usage: TokenUsage = Field(default_factory=TokenUsage)
    model: str
    provider: str
    latency_ms: int = 0
    cost_usd: float = 0.0


class ProviderUnavailable(RuntimeError):
    """The requested provider cannot serve the call.

    Raised rather than falling back to another provider: a silent switch from a local model
    to a paid API would spend the user's money without consent.
    """


class LLMCallError(RuntimeError):
    """A provider returned an error the router could not recover from after retries."""


# USD per 1M tokens (input, output). Unlisted models fall back to UNKNOWN_PRICING, which is
# deliberately non-zero so an unpriced model still counts against the budget.
PRICING: dict[str, tuple[float, float]] = {
    # Anthropic
    "claude-opus-5": (15.00, 75.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-haiku-4-5-20251001": (1.00, 5.00),
    # OpenAI
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    # Google
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-1.5-pro": (1.25, 5.00),
    "gemini-1.5-flash": (0.075, 0.30),
}

UNKNOWN_PRICING: tuple[float, float] = (1.00, 3.00)


def price_call(provider: str, model: str, usage: TokenUsage) -> float:
    """Cost of one call in USD. Local inference is free."""
    if provider == "ollama":
        return 0.0
    inp, out = PRICING.get(model, UNKNOWN_PRICING)
    return (usage.prompt_tokens * inp + usage.completion_tokens * out) / 1_000_000
