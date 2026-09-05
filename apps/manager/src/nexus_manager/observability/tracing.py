"""LangSmith tracing.

Opt-in: with no LANGSMITH_API_KEY the tracer is not configured and nothing is sent
anywhere. Tracing is enabled by setting the environment variables the LangChain libraries
read, which is what makes every LangGraph node and LLM call appear in a trace without the
application code carrying tracing calls of its own.
"""

from __future__ import annotations

import os

import structlog

from ..config import Settings
from ..config import settings as default_settings

log = structlog.get_logger(__name__)


def configure_tracing(settings: Settings | None = None) -> bool:
    """Turn on LangSmith tracing when a key is present. Returns whether it was enabled."""
    cfg = settings or default_settings
    if not cfg.langsmith_api_key:
        log.info("tracing_disabled", reason="LANGSMITH_API_KEY is not set")
        return False

    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGSMITH_API_KEY"] = cfg.langsmith_api_key
    os.environ["LANGCHAIN_API_KEY"] = cfg.langsmith_api_key
    os.environ["LANGSMITH_PROJECT"] = cfg.langsmith_project
    os.environ["LANGCHAIN_PROJECT"] = cfg.langsmith_project
    log.info("tracing_enabled", project=cfg.langsmith_project)
    return True


def tracing_enabled() -> bool:
    return os.environ.get("LANGSMITH_TRACING") == "true"
