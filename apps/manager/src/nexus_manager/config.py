"""Environment-driven settings for the manager service.

Budget caps live here as fields but are enforced in `safety.budget`, not by prompting the
model to behave.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["ollama", "anthropic", "openai", "gemini"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ─── LLM providers ──────────────────────────────────────────
    default_llm_provider: Provider = Field(default="ollama", alias="DEFAULT_LLM_PROVIDER")

    ollama_host: str = Field(default="http://127.0.0.1:11434", alias="OLLAMA_HOST")
    ollama_default_model: str = Field(default="llama3:8b", alias="OLLAMA_DEFAULT_MODEL")
    ollama_planner_model: str = Field(default="llama3:8b", alias="OLLAMA_PLANNER_MODEL")

    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")

    anthropic_default_model: str = Field(default="claude-sonnet-5", alias="ANTHROPIC_DEFAULT_MODEL")
    openai_default_model: str = Field(default="gpt-4o", alias="OPENAI_DEFAULT_MODEL")
    gemini_default_model: str = Field(default="gemini-2.0-flash", alias="GEMINI_DEFAULT_MODEL")

    # ─── Search ─────────────────────────────────────────────────
    # Tavily is used when a key is present; otherwise the keyless provider is used so search
    # works without a signup. Both return the same SearchHit shape.
    tavily_api_key: str | None = Field(default=None, alias="TAVILY_API_KEY")
    search_provider: Literal["auto", "tavily", "duckduckgo"] = Field(default="auto", alias="SEARCH_PROVIDER")

    # ─── Existing NexusAI services ──────────────────────────────
    rag_url: str = Field(default="http://127.0.0.1:5000", alias="RAG_URL")
    sandbox_url: str = Field(default="http://127.0.0.1:4500", alias="SANDBOX_URL")

    # ─── Infrastructure ─────────────────────────────────────────
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    redis_url: str = Field(default="redis://127.0.0.1:6379/0", alias="REDIS_URL")

    # ─── Budget caps (enforced in code) ─────────────────────────
    max_total_tokens: int = Field(default=200_000, alias="MAX_TOTAL_TOKENS")
    max_usd: float = Field(default=1.00, alias="MAX_USD")
    max_agents_spawned: int = Field(default=8, alias="MAX_AGENTS_SPAWNED")
    max_depth: int = Field(default=2, alias="MAX_DEPTH")
    worker_timeout_s: float = Field(default=90.0, alias="WORKER_TIMEOUT_S")

    # ─── Tool behaviour ─────────────────────────────────────────
    tool_timeout_s: float = Field(default=30.0, alias="TOOL_TIMEOUT_S")
    tool_max_retries: int = Field(default=3, alias="TOOL_MAX_RETRIES")
    per_domain_rate_limit_s: float = Field(default=1.0, alias="PER_DOMAIN_RATE_LIMIT_S")
    robots_cache_ttl_s: int = Field(default=3600, alias="ROBOTS_CACHE_TTL_S")
    user_agent: str = Field(
        default="NexusAI-Manager/0.1 (+https://github.com/parthksingh1/NexusAI)",
        alias="MANAGER_USER_AGENT",
    )

    # ─── Observability ──────────────────────────────────────────
    langsmith_api_key: str | None = Field(default=None, alias="LANGSMITH_API_KEY")
    langsmith_project: str = Field(default="nexus-manager", alias="LANGSMITH_PROJECT")

    manager_port: int = Field(default=4100, alias="MANAGER_PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def key_for(self, provider: Provider) -> str | None:
        return {
            "anthropic": self.anthropic_api_key,
            "openai": self.openai_api_key,
            "gemini": self.google_api_key,
            "ollama": "local",
        }.get(provider)

    def default_model_for(self, provider: Provider) -> str:
        return {
            "ollama": self.ollama_default_model,
            "anthropic": self.anthropic_default_model,
            "openai": self.openai_default_model,
            "gemini": self.gemini_default_model,
        }[provider]

    def planner_model_for(self, provider: Provider) -> str:
        """Planning benefits from a stronger model than the workers need."""
        if provider == "ollama":
            return self.ollama_planner_model
        return self.default_model_for(provider)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
