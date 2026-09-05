/**
 * Client for the manager service.
 *
 * Unlike lib/api.ts this has no offline fallback. A run either reaches the manager and does
 * real work, or the caller is told the service is unreachable — a page that quietly showed
 * fabricated agent output would be worse than one that shows an error.
 */

const BASE = process.env.NEXT_PUBLIC_MANAGER_URL ?? "http://localhost:4100";

export type ProviderId = "ollama" | "anthropic" | "openai" | "gemini";

export type TaskType = "research" | "scrape" | "video" | "code" | "synthesize";

export interface PlanTask {
  id: string;
  type: TaskType;
  goal: string;
  inputs: Record<string, unknown>;
  depends_on: string[];
  parallel_group: number;
}

export interface Plan {
  goal: string;
  reasoning: string;
  tasks: PlanTask[];
  estimated_cost_usd: number;
  requires_synthesis: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  available: boolean;
  kind: "local" | "cloud";
  models: string[];
  reason: string | null;
}

export interface BudgetSnapshot {
  tokens_used: number;
  max_tokens: number;
  usd_spent: number;
  max_usd: number;
  agents_spawned: number;
  max_agents: number;
  depth: number;
  max_depth: number;
}

export interface WorkerResult {
  ok: boolean;
  output: Record<string, unknown>;
  citations: string[];
  tokens_used: number;
  cost_usd: number;
  error: string | null;
  duration_ms: number;
}

export type RunStatus = "queued" | "planning" | "running" | "done" | "partial" | "error";

export interface RunDetail {
  run_id: string;
  status: RunStatus;
  goal: string;
  plan: Plan | null;
  results: Record<string, WorkerResult>;
  answer: string | null;
  citations: string[];
  budget: BudgetSnapshot | null;
  reason: string | null;
  started_at: number;
  finished_at: number | null;
}

export type EventKind =
  | "plan"
  | "worker_start"
  | "worker_step"
  | "worker_done"
  | "worker_error"
  | "budget_warn"
  | "budget_exceeded"
  | "synthesis"
  | "done"
  | "error";

export interface RunEvent {
  run_id: string;
  ts: number;
  kind: EventKind;
  payload: Record<string, any>;
}

export class ManagerUnreachable extends Error {
  constructor(cause: unknown) {
    super(
      `The manager service at ${BASE} is not responding. Start it with ` +
        `\`docker compose up -d manager\` or \`pnpm --filter @nexusai/manager dev\`.`,
    );
    this.name = "ManagerUnreachable";
    this.cause = cause;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } catch (cause) {
    throw new ManagerUnreachable(cause);
  }

  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = await resp.json();
      detail = body.detail ?? body.error ?? detail;
    } catch {
      /* keep the status line */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return (await resp.json()) as T;
}

export const managerApi = {
  baseUrl: BASE,

  providers: () => req<ProviderInfo[]>("/providers"),

  startRun: (goal: string, provider?: ProviderId, maxUsd?: number) =>
    req<{ run_id: string; plan: Plan | null; status: RunStatus }>("/chat", {
      method: "POST",
      body: JSON.stringify({ goal, provider, max_usd: maxUsd }),
    }),

  getRun: (runId: string) => req<RunDetail>(`/runs/${runId}`),

  listRuns: () => req<Array<{ run_id: string; status: RunStatus; goal: string; started_at: number }>>("/runs"),

  cancelRun: (runId: string) => req<{ cancelled: boolean }>(`/runs/${runId}/cancel`, { method: "POST" }),

  eventsUrl: (runId: string) => `${BASE}/runs/${runId}/events`,
};

/** Node states the graph renders, derived from the event stream. */
export type NodeState = "pending" | "running" | "done" | "error" | "skipped";

export function statusTone(status: RunStatus): string {
  switch (status) {
    case "done":
      return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "running":
    case "planning":
      return "text-sky-400 border-sky-500/30 bg-sky-500/10";
    case "partial":
      return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    case "error":
      return "text-rose-400 border-rose-500/30 bg-rose-500/10";
    default:
      return "text-fg-muted border-border bg-bg-subtle";
  }
}
