"""Run code through the existing NexusAI sandbox service.

Execution goes over HTTP to apps/sandbox, which already enforces no network, a read-only
root filesystem, dropped capabilities, and CPU and memory caps. This module never reaches
for subprocess, eval or exec.
"""

from __future__ import annotations

import httpx
import structlog

from ..config import Settings
from ..config import settings as default_settings
from .schemas import CodeInput, ExecResult

log = structlog.get_logger(__name__)

SUPPORTED_LANGUAGES = {"python", "node", "bash"}

_ALIASES = {"py": "python", "python3": "python", "js": "node", "javascript": "node", "nodejs": "node", "sh": "bash"}


async def code_exec(
    lang: str, source: str, stdin: str | None = None, *, settings: Settings | None = None
) -> ExecResult:
    """Execute a snippet in the sandbox and return its output."""
    cfg = settings or default_settings
    try:
        inp = CodeInput(lang=lang, source=source, stdin=stdin)
    except Exception as exc:
        return ExecResult(ok=False, exit_code=-1, error=f"invalid input: {exc}")

    language = _ALIASES.get(inp.lang.lower(), inp.lang.lower())
    if language not in SUPPORTED_LANGUAGES:
        return ExecResult(
            ok=False,
            exit_code=-1,
            error=f"language {inp.lang!r} is not supported; use one of {sorted(SUPPORTED_LANGUAGES)}",
        )

    payload: dict = {"language": language, "code": inp.source}
    if inp.stdin:
        payload["stdin"] = inp.stdin

    try:
        async with httpx.AsyncClient(timeout=max(cfg.tool_timeout_s, 60.0)) as client:
            resp = await client.post(f"{cfg.sandbox_url.rstrip('/')}/exec", json=payload)
    except httpx.HTTPError as exc:
        return ExecResult(ok=False, exit_code=-1, error=f"sandbox unreachable at {cfg.sandbox_url}: {exc}")

    if resp.status_code >= 400:
        return ExecResult(ok=False, exit_code=-1, error=f"sandbox returned {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
    except ValueError as exc:
        return ExecResult(ok=False, exit_code=-1, error=f"sandbox returned invalid JSON: {exc}")

    exit_info = data.get("exit") or {}
    return ExecResult(
        ok=True,
        stdout=data.get("stdout", ""),
        stderr=data.get("stderr", ""),
        exit_code=int(exit_info.get("code", 0)),
        duration_ms=int(exit_info.get("durationMs", 0)),
        timed_out=bool(exit_info.get("timedOut", False)),
    )
