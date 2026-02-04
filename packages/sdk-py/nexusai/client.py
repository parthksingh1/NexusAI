from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
import websockets


class NexusClient:
    """HTTP + WebSocket client for the NexusAI orchestrator."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("NEXUSAI_API_KEY")
        self.base_url = (base_url or os.environ.get("NEXUSAI_URL") or "http://localhost:4000").rstrip("/")
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        h = {"content-type": "application/json"}
        if self.api_key:
            h["x-api-key"] = self.api_key
        return h

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    # ─── Sync HTTP ─────────────────────────────────────────────
    def _get(self, path: str) -> Any:
        r = httpx.get(self._url(path), headers=self._headers(), timeout=self._timeout)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> Any:
        r = httpx.post(self._url(path), headers=self._headers(), json=body, timeout=self._timeout)
        r.raise_for_status()
        if r.status_code == 204:
            return None
        return r.json()

    def _delete(self, path: str) -> None:
        r = httpx.delete(self._url(path), headers=self._headers(), timeout=self._timeout)
        r.raise_for_status()

    # ─── Resources ─────────────────────────────────────────────
    @property
    def agents(self) -> _Agents:
        return _Agents(self)

    @property
    def rag(self) -> _Rag:
        return _Rag(self)

    def collaborate(self, goal: str, task_input: str, max_iterations: int = 5) -> dict:
        return self._post(
            "/collaborate",
            {"goal": goal, "input": task_input, "maxIterations": max_iterations},
        )


class _Agents:
    def __init__(self, client: NexusClient) -> None:
        self._c = client

    def list(self) -> list[dict]:
        return self._c._get("/agents")["agents"]

    def get(self, agent_id: str) -> dict:
        return self._c._get(f"/agents/{agent_id}")

    def create(
        self,
        name: str,
        goal: str,
        persona: dict,
        tools: list[str] | None = None,
        model_routing_policy: dict | None = None,
    ) -> dict:
        return self._c._post(
            "/agents",
            {
                "name": name,
                "goal": goal,
                "persona": persona,
                "tools": tools or [],
                "modelRoutingPolicy": model_routing_policy or {},
            },
        )

    def delete(self, agent_id: str) -> None:
        self._c._delete(f"/agents/{agent_id}")

    def start(self, agent_id: str, input_text: str, max_steps: int = 12) -> dict:
        return self._c._post(
            f"/agents/{agent_id}/runs",
            {"input": input_text, "maxSteps": max_steps, "stream": True},
        )

    async def run(self, agent_id: str, input_text: str, max_steps: int = 12) -> AsyncIterator[dict]:
        """Start a run and async-iterate its live steps over WebSocket."""
        resp = self.start(agent_id, input_text, max_steps)
        run_id = resp["runId"]
        ws_url = self._c.base_url.replace("http://", "ws://").replace("https://", "wss://") + f"/ws/runs/{run_id}"
        async with websockets.connect(ws_url) as ws:
            async for msg in ws:
                event = json.loads(msg)
                if event.get("type") == "connected":
                    continue
                if event.get("type") == "finished":
                    yield event
                    return
                yield event


class _Rag:
    def __init__(self, client: NexusClient) -> None:
        self._c = client

    def ingest(
        self,
        source: str,
        source_id: str,
        title: str,
        text: str,
        url: str | None = None,
    ) -> dict:
        rag_url = os.environ.get("NEXUSAI_RAG_URL", "http://localhost:5000")
        r = httpx.post(
            f"{rag_url}/ingest",
            json={
                "ownerId": os.environ.get("NEXUSAI_OWNER_ID", "00000000-0000-0000-0000-000000000001"),
                "source": source,
                "sourceId": source_id,
                "title": title,
                "text": text,
                "url": url,
            },
            timeout=60.0,
        )
        r.raise_for_status()
        return r.json()

    def search(self, query: str, top_k: int = 8, use_rerank: bool = True) -> list[dict]:
        rag_url = os.environ.get("NEXUSAI_RAG_URL", "http://localhost:5000")
        r = httpx.post(
            f"{rag_url}/search",
            json={
                "ownerId": os.environ.get("NEXUSAI_OWNER_ID", "00000000-0000-0000-0000-000000000001"),
                "query": query,
                "topK": top_k,
                "useRerank": use_rerank,
            },
            timeout=30.0,
        )
        r.raise_for_status()
        return r.json()["hits"]
