/**
 * API wrapper with graceful mock fallbacks.
 * When the orchestrator is offline, pages still render with demo data so the UI
 * can be demoed / developed without the full stack running.
 */

import { mockAgents, mockRuns, mockTools, mockRecentRuns, mockCostByDay, mockCostByModel, mockActivity } from "./mock-data";

const BASE = "/api/orch";

async function req<T>(path: string, init: RequestInit = {}, fallback?: T): Promise<T> {
  try {
    const resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!resp.ok) {
      if (fallback !== undefined) return fallback;
      let detail: unknown;
      try { detail = await resp.json(); } catch { detail = await resp.text(); }
      throw new Error(`${resp.status} ${resp.statusText}: ${JSON.stringify(detail)}`);
    }
    if (resp.status === 204) return undefined as T;
    return (await resp.json()) as T;
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export type Agent = {
  id: string;
  name: string;
  goal: string;
  persona: {
    name: string;
    description: string;
    systemPrompt: string;
    temperature?: number;
    maxTokens?: number;
  };
  tools: string[];
  status: "IDLE" | "RUNNING" | "PAUSED" | "STOPPED" | "ERROR";
  createdAt: string;
  updatedAt: string;
};

export type AgentRun = {
  id: string;
  agentId: string;
  input: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  startedAt: string;
  finishedAt?: string;
  result?: string;
  errorMessage?: string;
  totalTokens: number;
  totalCostUsd: string;
  steps?: AgentStep[];
};

export type AgentStep = {
  id: string;
  runId: string;
  step: number;
  kind: "THOUGHT" | "ACTION" | "OBSERVATION" | "FINAL";
  content: string;
  tool?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  model?: string;
  createdAt: string;
};

export type Tool = { name: string; description: string; risk: "safe" | "moderate" | "dangerous" };
export type ActivityEvent = {
  id: string; type: "run.started" | "run.succeeded" | "run.failed" | "agent.created" | "approval.required" | "tool.invoked";
  agentId?: string; agentName?: string; runId?: string; message: string; ts: string;
};

export const api = {
  listAgents: () => req<{ agents: Agent[] }>("/agents", {}, { agents: mockAgents }),
  getAgent: (id: string) => req<Agent & { runs: AgentRun[] }>(`/agents/${id}`, {}, { ...mockAgents[0], id, runs: mockRuns }),
  createAgent: (body: { name: string; goal: string; persona: Record<string, unknown>; tools?: string[] }) =>
    req<Agent>("/agents", { method: "POST", body: JSON.stringify({ modelRoutingPolicy: {}, tools: [], ...body }) }),
  deleteAgent: (id: string) => req<void>(`/agents/${id}`, { method: "DELETE" }),
  listTools: () => req<{ tools: Tool[] }>("/tools", {}, { tools: mockTools }),
  startRun: (agentId: string, input: string, maxSteps = 12) =>
    req<{ runId: string }>(`/agents/${agentId}/runs`, {
      method: "POST",
      body: JSON.stringify({ input, maxSteps, stream: true }),
    }),
  getRun: (runId: string) => req<AgentRun>(`/runs/${runId}`),
  cancelRun: (runId: string) => req<void>(`/runs/${runId}/cancel`, { method: "POST" }),

  // Metrics
  costByDay: (days = 14) => req<{ series: { day: string; cost: number; tokens: number; calls: number }[] }>(
    `/metrics/cost-by-day?days=${days}`, {}, { series: mockCostByDay(days) },
  ),
  costByModel: (days = 7) => req<{ models: { model: string; cost: number; calls: number; p95_ms: number }[] }>(
    `/metrics/cost-by-model?days=${days}`, {}, { models: mockCostByModel() },
  ),

  // Derived: recent runs across all agents
  recentRuns: async () => {
    const { agents } = await api.listAgents();
    // Real impl would be /runs?limit=N on the orchestrator — mock derived
    return { runs: mockRecentRuns(agents) };
  },

  // Activity feed
  activity: () => Promise.resolve<{ events: ActivityEvent[] }>({ events: mockActivity() }),
};

export function openRunSocket(runId: string): WebSocket {
  const orch = process.env.NEXT_PUBLIC_ORCHESTRATOR_WS ?? "ws://localhost:4000";
  return new WebSocket(`${orch}/ws/runs/${runId}`);
}
