/**
 * NexusAI TypeScript SDK.
 *
 * ```ts
 * import { NexusClient } from "@nexusai/sdk";
 * const nx = new NexusClient({ apiKey: process.env.NEXUSAI_API_KEY! });
 *
 * const agent = await nx.agents.create({ name: "Researcher", goal: "...", persona: {...} });
 * for await (const step of nx.agents.run(agent.id, "summarize today's AI news")) {
 *   console.log(step.kind, step.content);
 * }
 * ```
 */

export type AgentPersona = {
  name: string;
  description?: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type CreateAgentInput = {
  name: string;
  goal: string;
  persona: AgentPersona;
  tools?: string[];
  modelRoutingPolicy?: {
    preferredProvider?: "anthropic" | "openai" | "gemini";
    maxCostPerCallUsd?: number;
    maxLatencyMs?: number;
  };
};

export type Agent = {
  id: string;
  name: string;
  goal: string;
  status: string;
  tools: string[];
  createdAt: string;
};

export type StepEvent = {
  runId: string;
  step: number;
  kind: "thought" | "action" | "observation" | "final";
  content: string;
  tool?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
};

export type NexusClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export class NexusClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: NexusClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.NEXUSAI_URL ?? "http://localhost:4000";
    this.apiKey = opts.apiKey ?? process.env.NEXUSAI_API_KEY;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", ...extra };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  }

  readonly agents = {
    list: () => this.request<{ agents: Agent[] }>("/agents"),
    get: (id: string) => this.request<Agent>(`/agents/${id}`),
    create: (input: CreateAgentInput) => this.request<Agent>("/agents", { method: "POST", body: JSON.stringify(input) }),
    delete: (id: string) => this.request<void>(`/agents/${id}`, { method: "DELETE" }),
    start: (id: string, input: string, maxSteps = 12) =>
      this.request<{ runId: string }>(`/agents/${id}/runs`, {
        method: "POST",
        body: JSON.stringify({ input, maxSteps, stream: true }),
      }),
    /** Async generator that yields each step as it streams over WebSocket. */
    run: async function* (this: NexusClient, id: string, input: string, maxSteps = 12): AsyncGenerator<StepEvent | { type: "done"; status: string; result?: string }> {
      const { runId } = await this.agents.start(id, input, maxSteps);
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws/runs/${runId}`;
      const WS: typeof WebSocket = (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket;
      if (!WS) throw new Error("WebSocket not available in this runtime");
      const ws = new WS(wsUrl);

      const queue: unknown[] = [];
      let resolveNext: ((v: unknown) => void) | null = null;
      let done = false;

      ws.addEventListener("message", (e: MessageEvent) => {
        const v = JSON.parse(e.data as string);
        if (resolveNext) { const r = resolveNext; resolveNext = null; r(v); }
        else queue.push(v);
      });
      ws.addEventListener("close", () => {
        done = true;
        if (resolveNext) { resolveNext(null); resolveNext = null; }
      });

      while (true) {
        const next = queue.shift() ?? (await new Promise((r) => { resolveNext = r; }));
        if (!next) break;
        const e = next as { type?: string };
        if (e.type === "connected") continue;
        if (e.type === "finished") {
          const f = e as { type: "finished"; status: string; result?: string };
          yield { type: "done", status: f.status.toLowerCase(), result: f.result };
          break;
        }
        yield next as StepEvent;
        if (done) break;
      }
      ws.close();
    },
  };

  readonly rag = {
    ingest: (input: { source: string; sourceId: string; title: string; text: string; url?: string }) =>
      this.request<{ documentId: string; chunks: number }>(
        (this.baseUrl.includes(":5000") ? "" : "") + "/ingest",
        { method: "POST", body: JSON.stringify(input) },
      ),
    search: (query: string, topK = 8) =>
      this.request<{ hits: Array<{ chunkId: string; title: string; snippet: string; score: number }> }>(
        "/search",
        { method: "POST", body: JSON.stringify({ query, topK, useRerank: true }) },
      ),
  };

  readonly collaborate = (input: { goal: string; input: string; maxIterations?: number }) =>
    this.request<{ plan: string[]; transcript: Array<{ role: string; content: string }>; result: string }>(
      "/collaborate",
      { method: "POST", body: JSON.stringify(input) },
    );
}

export default NexusClient;
