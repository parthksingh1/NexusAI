from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import settings
from .schemas import AgentTarget, EchoTarget, HttpTarget, Target

_TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED", "ERROR"}


@dataclass
class Execution:
    output: str
    latency_ms: int
    cost_usd: float
    error: str | None = None


def parse_target(raw: dict[str, Any]) -> Target:
    kind = raw.get("type", "echo")
    if kind == "agent":
        return AgentTarget(**raw)
    if kind == "http":
        return HttpTarget(**raw)
    return EchoTarget()


async def execute(target: Target, case_input: str, client: httpx.AsyncClient) -> Execution:
    """Run one case against the target. Failures are returned as an Execution with `error` set
    rather than raised — a target that falls over on case 3 should not lose cases 1, 2 and 4."""
    start = time.perf_counter()
    try:
        if isinstance(target, EchoTarget):
            return Execution(output=case_input, latency_ms=_elapsed(start), cost_usd=0.0)
        if isinstance(target, HttpTarget):
            return await _run_http(target, case_input, client, start)
        return await _run_agent(target, case_input, client, start)
    except httpx.HTTPError as exc:
        return Execution(output="", latency_ms=_elapsed(start), cost_usd=0.0, error=f"transport error: {exc}")
    except TimeoutError:
        return Execution(output="", latency_ms=_elapsed(start), cost_usd=0.0, error="target timed out")


def _elapsed(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _dig(data: Any, path: str) -> Any:
    cur = data
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    return cur


async def _run_http(target: HttpTarget, case_input: str, client: httpx.AsyncClient, start: float) -> Execution:
    if target.method == "GET":
        resp = await client.get(target.url, params={target.inputField: case_input}, headers=target.headers)
    else:
        resp = await client.post(target.url, json={target.inputField: case_input}, headers=target.headers)
    if resp.status_code >= 400:
        return Execution(
            output="", latency_ms=_elapsed(start), cost_usd=0.0,
            error=f"target returned {resp.status_code}: {resp.text[:300]}",
        )
    try:
        payload = resp.json()
    except (json.JSONDecodeError, ValueError):
        return Execution(output=resp.text, latency_ms=_elapsed(start), cost_usd=0.0)
    try:
        value = _dig(payload, target.outputPath)
    except (KeyError, IndexError, TypeError, ValueError):
        # The path missed — hand the whole body to the scorers rather than dropping the response.
        return Execution(output=json.dumps(payload), latency_ms=_elapsed(start), cost_usd=0.0)
    output = value if isinstance(value, str) else json.dumps(value)
    return Execution(output=output, latency_ms=_elapsed(start), cost_usd=0.0)


async def _run_agent(target: AgentTarget, case_input: str, client: httpx.AsyncClient, start: float) -> Execution:
    """Start an orchestrator run and poll it to completion. The orchestrator's run API is
    fire-and-poll: POST returns a runId, GET /runs/:id carries status, result and cost."""
    base = settings.orchestrator_url.rstrip("/")
    headers = {"X-User-Id": target.ownerId} if target.ownerId else {}
    body: dict[str, Any] = {"input": case_input}
    if target.maxSteps is not None:
        body["maxSteps"] = target.maxSteps

    resp = await client.post(f"{base}/agents/{target.agentId}/runs", json=body, headers=headers)
    if resp.status_code >= 400:
        return Execution(
            output="", latency_ms=_elapsed(start), cost_usd=0.0,
            error=f"failed to start run ({resp.status_code}): {resp.text[:300]}",
        )
    run_id = resp.json().get("runId")
    if not run_id:
        return Execution(output="", latency_ms=_elapsed(start), cost_usd=0.0, error="orchestrator returned no runId")

    deadline = time.monotonic() + settings.agent_run_timeout_s
    delay = 0.5
    while time.monotonic() < deadline:
        await asyncio.sleep(delay)
        delay = min(delay * 1.5, 5.0)  # back off so long runs don't hammer the orchestrator
        poll = await client.get(f"{base}/runs/{run_id}", headers=headers)
        if poll.status_code >= 400:
            continue
        run = poll.json()
        status = str(run.get("status", "")).upper()
        if status not in _TERMINAL:
            continue
        cost = float(run.get("totalCostUsd") or 0.0)
        if status in {"FAILED", "ERROR", "CANCELLED"}:
            return Execution(
                output=run.get("result") or "", latency_ms=_elapsed(start), cost_usd=cost,
                error=run.get("errorMessage") or f"run ended {status}",
            )
        return Execution(output=run.get("result") or "", latency_ms=_elapsed(start), cost_usd=cost)

    # Leave the run going — cancelling it would hide the timeout's cause from the run console.
    return Execution(
        output="", latency_ms=_elapsed(start), cost_usd=0.0,
        error=f"agent run {run_id} did not finish within {settings.agent_run_timeout_s:.0f}s",
    )
