# NexusAI Architecture

This document describes how NexusAI is put together: the services, the data stores, the message flows, the concurrency and failure model, and the scaling strategy. If you want the user-facing overview, start with the root [`README.md`](./README.md). If you want to operate it, see [`RUNBOOK.md`](./RUNBOOK.md).

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [High-Level Topology](#high-level-topology)
3. [Services](#services)
4. [Data Stores](#data-stores)
5. [Messaging & Event Contracts](#messaging--event-contracts)
6. [Agent Execution — The ReAct Loop](#agent-execution--the-react-loop)
7. [LLM Routing](#llm-routing)
8. [Hybrid RAG Pipeline](#hybrid-rag-pipeline)
9. [Memory System](#memory-system)
10. [Sandboxed Code Execution](#sandboxed-code-execution)
11. [Real-Time Data Agents](#real-time-data-agents)
12. [Collaboration Protocol](#collaboration-protocol)
13. [Safety Layer](#safety-layer)
14. [Self-Improvement Loop](#self-improvement-loop)
15. [Security Model](#security-model)
16. [Observability](#observability)
17. [Scaling & Capacity](#scaling--capacity)
18. [Failure Modes](#failure-modes)
19. [Trade-offs & Non-Goals](#trade-offs--non-goals)

---

## Design Principles

1. **Stateless services, stateful stores.** Every application service is horizontally scalable. All durable state lives in Postgres, Redis, Kafka, Neo4j, or ClickHouse.
2. **Typed contracts everywhere.** Kafka topic names, event payloads, HTTP request/response bodies, database rows, and tool parameters share a single source of truth (`@nexusai/shared` + Prisma + Zod).
3. **Fail open on telemetry, fail closed on safety.** Observability code paths (OTel, ClickHouse writes, Neo4j writes) must never abort a run. Safety code paths (approval gates, blocked patterns) must never silently allow.
4. **Same code path local and in prod.** Local `docker-compose` and production Kubernetes run the same container images and config shape. There is no "dev mode" branch in application code.
5. **Assume LLM calls can fail.** Every provider call has retries within-provider and cross-provider fallback. Cost and latency are first-class concerns, not afterthoughts.
6. **Composition over inheritance.** Tools are data (definitions) + a handler function. Memory types, connectors, and streaming sources follow the same shape.

---

## High-Level Topology

```
                       ┌───────────────────────┐
                       │    Web (Next.js 15)   │
                       │    Dashboard          │
                       │    Playground (Monaco)│
                       │    Live streams       │
                       │    Approvals UI       │
                       │    Metrics dashboards │
                       └──────────┬────────────┘
                                  │ REST + WebSocket
                        ┌─────────▼──────────┐
                        │    Orchestrator    │
                        │    (Fastify/TS)    │
                        │                    │
                        │ ┌────────────────┐ │
                        │ │ LLM Router     │ │
                        │ │ Tool Registry  │ │
                        │ │ ReAct Loop     │ │
                        │ │ Safety Gate    │ │
                        │ │ Reflection     │ │
                        │ │ Billing/Cron   │ │
                        │ └────────────────┘ │
                        └──┬──┬──┬──┬────────┘
                           │  │  │  │
               ┌───────────┘  │  │  └───────────────┐
               │              │  │                  │
               ▼              ▼  ▼                  ▼
        ┌──────────┐  ┌─────────────┐      ┌──────────────┐
        │ RAG      │  │ Sandbox     │      │ Realtime     │
        │ (FastAPI)│  │ (Node/Docker│      │ (Node/Kafka) │
        └────┬─────┘  └─────┬───────┘      └──────┬───────┘
             │              │                     │
             └──────┬───────┴──────────┬──────────┘
                    ▼                  ▼
     ┌──────────────────────────────────────────────────────┐
     │              Data & Messaging Layer                  │
     │                                                      │
     │  Postgres(+pgvector)  Neo4j   ClickHouse            │
     │  Redis (cache+pubsub) Kafka (KRaft)                 │
     │  Prometheus  OTel→Jaeger  Grafana                   │
     └──────────────────────────────────────────────────────┘
```

---

## Services

### `apps/web` — Next.js 15 dashboard
React 19 + Tailwind. All API calls go through a Next.js rewrite (`/api/orch/*` → `http://orchestrator:4000/*`) to keep CORS clean and allow the orchestrator URL to be swapped without touching the UI. WebSockets connect directly to the orchestrator (or realtime service) because Next.js rewrites don't support WS.

Key pages: `/agents` (list + create), `/agents/[id]` (detail + live run console), `/playground` (Monaco + sandbox WS), `/streams` (real-time charts), `/marketplace`, `/approvals`, `/metrics` (ClickHouse-backed charts), `/billing`, `/login`.

### `apps/orchestrator` — the control plane
Fastify on Node 20. This is where most of the business logic lives:
- HTTP REST + WebSocket endpoints
- Multi-provider LLM router with streaming
- Tool registry (plugin-style registration at import time)
- ReAct executor — drives the agent loop, persists steps, broadcasts events
- Safety gate with risk scoring + human-in-the-loop approvals
- Reflection + prompt optimizer (self-improvement)
- JWT + API-key auth
- Stripe billing + cron scheduler
- Prometheus metrics + OpenTelemetry tracing

Stateless. Scales horizontally. A run's durable state is in Postgres; ephemeral state (pub/sub for WebSocket subscribers, approval signalling) is in Redis.

### `apps/rag` — retrieval service
Python + FastAPI + asyncpg + SQLAlchemy. Owns the retrieval pipeline:
- Dense search via pgvector cosine
- Sparse search via Postgres `tsvector` + `websearch_to_tsquery`
- Fusion with normalized score blending (α-weighted)
- HyDE query expansion (optional)
- LLM-based query decomposition (multi-hop)
- Cross-encoder reranking (Cohere / Jina / heuristic fallback)
- Connectors: Notion, GitHub, Slack, URL

Deliberately kept in Python because most ML tooling (embeddings, reranker clients, future cross-encoder local models) is Python-native.

### `apps/sandbox` — code execution
Spawns short-lived Docker containers via Dockerode. Each exec gets:
- No network (`NetworkMode: "none"`)
- Read-only rootfs + size-capped `/tmp` tmpfs
- Memory cap (default 256 MB) enforced via cgroups
- Pids cap (128) + CPU quota (50%)
- All Linux capabilities dropped
- gVisor (`runsc`) runtime when available — kernel-level isolation

Stdout/stderr is demuxed from Docker's stream protocol and streamed to the orchestrator (or UI) over WebSocket.

### `apps/realtime` — data-agent plane
Node + kafkajs. Three source adapters (crypto via Binance WS, news via Hacker News polling, weather via open-meteo polling), unified into `MarketTick` events:

```
source adapter ─► handleTick() ─► [optional] LLM sentiment ─► z-score detector
                                                                    │
                                                                    ├─► Kafka: nexus.market.tick.v1
                                                                    ├─► ClickHouse buffered insert (2s batch)
                                                                    └─► fireAlert() if anomaly
                                                                        │
                                                                        ├─► Redis sorted-set (dashboard)
                                                                        └─► Redis pub/sub (live WS)
```

### `apps/simulation` — safe testing
Stateless mock API server. Returns deterministic (seeded-random) responses for endpoints agents commonly hit: email send, stock quotes, CRM contacts. Also supports scenario replay — a test harness uploads a script of (URL → response) steps and the service serves them in order. Point agents here in CI to avoid real-world side effects.

---

## Data Stores

### Postgres 16 + pgvector
Primary OLTP store.
- `nexus.*` schema for users, orgs, API keys, agents, runs, steps, memory, approvals, cron jobs.
- `rag.*` schema for documents and chunks (vector + tsvector columns).
- Foreign keys + cascade deletes everywhere.
- Prisma is the TypeScript client; raw SQL is used only for vector ops (`<=>` operator) and tsvector queries that Prisma can't express.

**Why Postgres + pgvector instead of a dedicated vector DB?** One less moving part. pgvector is fast enough to 10M vectors for all-but-the-largest deployments, and combining it with `tsvector` gives us a unified hybrid search without cross-store joins.

### ClickHouse 24
Append-only time-series store for LLMOps. Tables:
- `nexusai.llm_calls` — every LLM call, partitioned by month, TTL 180 days
- `nexusai.agent_events` — every ReAct step, for latency breakdowns
- `nexusai.market_ticks` — real-time data agent feed

All inserts are buffered and batched. ClickHouse downtime is tolerable — the orchestrator logs a warning and moves on.

### Neo4j 5 (community + APOC)
Memory graph. Nodes:
- `Agent` (id, name)
- `Memory` (id, type, content, importance, createdAt)
- `Tool`, `Run`, `Concept`

Relationships:
- `(Agent)-[:HAS_MEMORY]->(Memory)`
- `(Agent)-[:USED_TOOL {outcome}]->(Tool)`
- `(Memory)-[:RELATED_TO {weight}]->(Memory)`
- `(Run)-[:INVOKED]->(Tool)`

This lets the reflection process walk the graph to find memories related to a current task, or surface tools that have high success-rate relationships with specific agents.

### Redis 7
Multiple roles:
- Pub/sub channels `run:<runId>` fan out live ReAct steps to WebSocket subscribers.
- Pub/sub channel `nexus:alerts` distributes real-time anomaly alerts.
- Sorted-set `nexus:alerts` holds the last 500 alerts for dashboard consumption.
- Approval signalling: `approvals:<requestId>` channel communicates human decisions back to the waiting run.
- Rate-limit windows: `rl:<userId>:<bucket>` sorted-sets implement sliding-window rate limits.

Persistent (`appendonly yes`) so alert history survives restarts.

### Kafka (KRaft mode)
Durable event log for cross-service decoupling:
- `nexus.agent.run.requested.v1` — a new run was queued
- `nexus.agent.run.started.v1` — run transitioned to RUNNING
- `nexus.agent.step.v1` — every ReAct step
- `nexus.agent.run.finished.v1` — terminal status
- `nexus.agent.message.v1` — agent-to-agent comms (collaboration)
- `nexus.tool.invoked.v1` — tool call with input/output/duration/risk
- `nexus.llm.call.v1` — per-LLM-call telemetry
- `nexus.market.tick.v1` — real-time ticks
- `nexus.alert.fired.v1` — anomaly alerts

Topic names are defined once in `packages/shared/src/events.ts` — never hard-coded.

KRaft mode avoids Zookeeper; same broker code, simpler ops.

---

## Messaging & Event Contracts

Kafka is the durable log; Redis pub/sub is the low-latency fan-out. They complement rather than duplicate:

- **Kafka** — consumers that can afford to be ~10ms behind and need replay (analytics, ClickHouse writes, cross-service coordination).
- **Redis pub/sub** — UI subscribers that want to see a step the instant it's persisted. No durability, no replay — if a browser reconnects, it fetches historical steps from Postgres via `GET /runs/:id`.

Every event is JSON with a required `ts` / `createdAt` / similar timestamp. Schemas are versioned in the topic name suffix (`.v1`) — bumping a topic to `.v2` is how we do breaking changes.

---

## Agent Execution — The ReAct Loop

The core loop lives in [`apps/orchestrator/src/agent/react-loop.ts`](./apps/orchestrator/src/agent/react-loop.ts).

```
  ┌──────────────────────────────────────────────────────────┐
  │ buildSystemPrompt(persona, goal, recalledMemories)       │
  │ messages = [system, user(input)]                         │
  └─────────────────────┬────────────────────────────────────┘
                        │
                        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ while step < maxSteps:                                   │
  │   1. classify task → pick model via router               │
  │   2. LLM.complete(messages, tools)                       │
  │   3. persist THOUGHT step, broadcast to Kafka + Redis    │
  │   4. logLlmCall → ClickHouse (async, best-effort)        │
  │   5. if no toolCalls → emit FINAL, finalize run, return  │
  │   6. for each toolCall in parallel:                      │
  │        a. assessRisk(tool, input)                        │
  │        b. if blocked → short-circuit with error          │
  │        c. if dangerous → awaitApproval (may block)       │
  │        d. invoke tool, capture output                    │
  │        e. persist OBSERVATION, broadcast                 │
  │   7. append tool-results to messages, loop               │
  └──────────────────────────────────────────────────────────┘
                        │
                        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ finalizeRun → DB update + Kafka run.finished.v1          │
  │ reflectOnRun (background) → memory writes                │
  └──────────────────────────────────────────────────────────┘
```

Key properties:
- Runs are **non-blocking** for the HTTP caller. `POST /agents/:id/runs` returns a `runId` immediately and fires-and-forgets the loop. The caller subscribes to WebSocket for live steps.
- **Step persistence precedes broadcast.** If the process dies mid-run, the browser can reconnect and replay from Postgres.
- **Tool parallelism.** Within a single model turn, multiple tool calls execute concurrently via `Promise.all`.
- **Budget enforcement.** `maxSteps` caps the loop (default 12). Rate limits cap runs/user/hour. Subscription-tier cost caps cap USD/user/month.

---

## LLM Routing

[`packages/llm-router/src/router.ts`](./packages/llm-router/src/router.ts)

Each model in the catalog has: provider, id, context window, cost/1M tokens (in + out), typical p50 latency/1k tokens, vision support, JSON-mode support, tool support, and a reasoning tier (1-3).

Routing is two-phase:

1. **Hard filter.** Drop models that don't satisfy constraints (provider init'd, preferred provider match, vision required, JSON required, minimum reasoning tier for the task).
2. **Soft score.** Normalize cost and latency to `[0, 1]` across remaining candidates. Compute:

   ```
   score = w_reasoning * (tier / 3) - w_cost * costNorm - w_latency * latencyNorm
   ```

   Task-type weights live in a lookup table: `reasoning` tasks weight reasoning heavily and cost modestly; `fast` tasks weight latency heavily; `classification` tasks weight cost heavily.

If the primary call raises, the router tries the next-best model from a different provider (single retry). Failures beyond that bubble up as typed errors (`LlmProviderError`).

**Cost accounting.** Every call's prompt + completion tokens × per-model rates are computed and attached to the result. The orchestrator logs this to ClickHouse (for dashboards), increments a Prometheus counter, and — if Stripe is configured — reports usage records for metered billing.

---

## Hybrid RAG Pipeline

```
query
  │
  ├── decompose_query (LLM) ─► [sub-query-1, sub-query-2, ...] if complex
  │
  ▼
for each sub-query:
  │
  ├── [optional] HyDE ─► hypothetical answer ─► embed that
  │
  ├── embed_text(source) ─► query_vector
  │
  ├── dense_search(query_vector)  ──┐
  ├── sparse_search(query_terms)   ─┤
  │                                  │
  ▼                                  ▼
  fuse by chunk_id, max_score
  │
  ▼
merge across sub-queries (best score wins per chunk)
  │
  ▼
[optional] cross-encoder rerank (Cohere / Jina / heuristic)
  │
  ▼
topK hits → cited response
```

Parameters exposed to the caller:
- `topK` — final hit count (default 8)
- `hybridAlpha` — dense/sparse balance (0 = sparse only, 1 = dense only, default 0.5)
- `useHyde` — expand with a hypothetical answer before embedding
- `useRerank` — apply cross-encoder reranking

Ingestion:
- Four chunking strategies: fixed, recursive (LangChain-style), semantic (placeholder, recursive for now), markdown (header-aware).
- Batched embeddings (OpenAI `text-embedding-3-small`, 1536 dims).
- Idempotent on `(ownerId, source, sourceId)` — re-ingesting the same document replaces its chunks atomically.

---

## Memory System

Four memory types, each with different write patterns and usage:

| Type | When written | Used by |
| ---- | ------------ | ------- |
| `episodic` | After every run (Q&A pair) | System prompt context-stuffing |
| `semantic` | By connectors + explicit ingest | RAG retrieval |
| `procedural` | By reflection when a reusable skill is identified | System prompt "learned skills" section |
| `reflection` | By reflection after every run (what worked / what to improve) | Prompt optimizer input |

Every memory is dual-written:
- Postgres `nexus.AgentMemory` (with pgvector embedding, importance, timestamps)
- Neo4j `Memory` node, linked to its `Agent` via `HAS_MEMORY`

Postgres is authoritative for reads used inline (fast, direct SQL). Neo4j is authoritative for graph traversals the reflection and optimizer use: "find all reflections related to tool failures on GitHub tasks," etc.

---

## Sandboxed Code Execution

[`apps/sandbox/src/executor.ts`](./apps/sandbox/src/executor.ts)

A sandboxed exec is:

```yaml
Image:       python:3.11-alpine | node:20-alpine | alpine:3.20
Runtime:     runc (default) or runsc (gVisor, opt-in)
NetworkMode: none
ReadonlyRootfs: true
Tmpfs:       /tmp rw,noexec,nosuid,size=64m
Memory:      256MB (caller-overridable up to 1GB)
PidsLimit:   128
CpuQuota:    50%
CapDrop:     ALL
SecurityOpt: no-new-privileges:true
AutoRemove:  false (we remove after demuxing stream)
```

Docker's multiplexed stream format (8-byte header per chunk) is demuxed in-process; stdout and stderr are yielded as separate events.

For production on GKE, the sandbox deployment sets `runtimeClassName: gvisor`. Google's GKE Sandbox runs the workload in a user-space kernel — a kernel vuln in the executed code cannot compromise the host.

---

## Real-Time Data Agents

The realtime service is organized around a unified `MarketTick`:

```ts
type MarketTick = {
  ts: string;
  symbol: string;
  source: "crypto" | "stocks" | "news" | "weather";
  price: number;
  volume: number;
  sentiment: number;
};
```

Each source adapter produces ticks; `handleTick` is the single hot path that:

1. Enriches news ticks with LLM sentiment (batched to 16 items or 500ms).
2. Observes the tick in a per-`(source, symbol)` windowed z-score detector.
3. Fires an alert to Redis if the tick is anomalous.
4. Publishes to Kafka `nexus.market.tick.v1`.
5. Appends to a 2-second buffered ClickHouse insert batch.

The WebSocket endpoint `/ws/ticks` creates a fresh Kafka consumer per subscriber (unique `groupId`) so every browser receives every tick without step-on-toes partition assignment.

---

## Collaboration Protocol

[`apps/orchestrator/src/agent/collaboration.ts`](./apps/orchestrator/src/agent/collaboration.ts)

```
input → Planner (LLM, JSON output)
           │
           ▼
        Plan.steps = [step1, step2, ..., stepN]
           │
           ▼
    for each step:
      Executor (ReAct loop, short horizon, tools enabled)
           │
           ▼
      Critic (LLM, JSON verdict {ok, reason})
           │
           ▼
      append step output to `compiled`
           │
           ▼
    Synthesizer (LLM, summarization) → final answer
```

Roles are three separate LLM calls with distinct system prompts; there is no shared memory between them other than the explicit message payloads. This keeps reasoning chains clean — a planner that starts doing execution itself is a common failure mode we avoid by forcing the protocol.

---

## Safety Layer

[`apps/orchestrator/src/safety/risk.ts`](./apps/orchestrator/src/safety/risk.ts)

```
tool call comes from ReAct loop
        │
        ▼
 assessRisk(toolDef, input)
        │
  ┌─────┴──────┐
  │            │
score < 0.35   0.35 ≤ score < 0.7   score ≥ 0.7   score = 1.0
  │            │                    │             │
  │            │                    │             ▼
  │            │                    │         BLOCKED (SafetyViolationError)
  │            │                    ▼
  │            │            awaitApproval()
  │            │                    │
  │            │            ┌───────┴────────┐
  │            │            │                │
  │            │       approved           rejected/timeout
  │            │            │                │
  ▼            ▼            ▼                ▼
 execute     execute      execute         return error
```

`assessRisk` combines:
- **Declarative risk** — the tool's own `risk` field
- **Pattern heuristics** — regexes catching obvious exfiltration/destruction attempts
- **Secret detection** — combinations of "set/assign" + "api_key/password/secret/token"

Score and level are returned to the caller; blocked inputs throw immediately.

Human-in-the-loop approval writes an `ApprovalRequest` row and blocks on a Redis pub/sub subscription. The UI polls `/approvals` and publishes the decision to the waiting subscriber. Timeout auto-rejects to guarantee forward progress.

---

## Self-Improvement Loop

After every run, [`reflectOnRun`](./apps/orchestrator/src/agent/reflection.ts) is called in the background:

1. Pull the full run transcript (steps + tool I/O) from Postgres.
2. Ask a reasoning-tier model (Claude Opus by default) to score the run and extract:
   - `what_worked`
   - `what_to_improve`
   - `reusable_skill` (may be null)
3. Write reflection + (if present) procedural skill to both Postgres and Neo4j.

Separately, [`optimizePrompt`](./apps/orchestrator/src/agent/prompt-optimizer.ts) can be triggered via `POST /agents/:id/optimize`. It reads the last 20 reflections for an agent, partitions them into wins and failures, and asks a prompt-engineer persona to propose an improved system prompt. The proposal is returned to the user for explicit acceptance — we never auto-overwrite persona prompts.

---

## Security Model

- **Authentication.** JWT (HS256) for browser sessions, API keys (`nxs_` prefix, HMAC hash at rest) for server-to-server. Both routed through `authenticateRequest`.
- **Passwords.** scrypt (`N=16384, r=8, p=1, keylen=64`) with per-password random salt.
- **Tenant isolation.** Every query filters by `ownerId`. API keys are scoped to a user; org-level keys arrive in a later iteration.
- **Network isolation in the sandbox.** `NetworkMode: "none"` means executed code cannot reach the internet, the Docker daemon socket, or other containers.
- **Secret handling.** All secrets read from env at boot. In production, External Secrets pulls them from Google Secret Manager; they never land in a ConfigMap.
- **Rate limits.** Per-user sliding-window limits in Redis.
- **Hard cost caps.** Per-tier monthly USD ceiling enforced before the next run starts.
- **Full audit trail.** Every step, tool call, LLM call, and approval decision is persisted with a timestamp and participant IDs.

---

## Observability

| Layer | What | Sink | UI |
| ----- | ---- | ---- | -- |
| Metrics | Per-service Prometheus counters/histograms/gauges | Prometheus scrape at `/metrics` | Grafana `:3001` |
| Traces | OTel auto-instrumentation for HTTP, DB, Kafka | OTel Collector → Jaeger | Jaeger UI `:16686` |
| Logs | Structured JSON (pino / structlog) | stdout → Docker / kubectl logs / Cloud Logging | — |
| LLMOps | Per-call cost/latency/tokens/cache-hit | ClickHouse `nexusai.llm_calls` | `/metrics` in web UI |
| Agent events | Every ReAct step with role + content | Kafka + Redis pub/sub | Live WS consoles |
| Alerts | Anomalies, threshold breaks, bad sentiment | Redis + Kafka | `/streams` in web UI |

Key Prometheus metrics that matter for capacity planning:
- `nexus_active_runs` — target 20-30 per orchestrator pod, drives HPA scale-up
- `nexus_agent_step_duration_ms{kind="action"}` p95 — tool latency
- `nexus_llm_cost_usd_total{model}` — cost attribution

---

## Scaling & Capacity

**Target:** 10,000+ concurrent agents, <200ms p95 for synchronous endpoints (agent list, tool list, auth), streaming endpoints bounded by LLM TTFT.

Scaling knobs per service:

| Service | Scaling axis | Bottleneck |
| ------- | ------------ | ---------- |
| Web | stateless | negligible |
| Orchestrator | stateless, HPA on CPU + `nexus_active_runs` | outbound LLM concurrency |
| RAG | stateless, HPA on CPU | embedding provider QPS, Postgres vector index |
| Sandbox | node-pool that tolerates privileged or gVisor workloads | host Docker daemon throughput |
| Realtime | stateless, one-partition-per-consumer | Kafka broker count |
| Postgres | vertical (read replicas via Cloud SQL read pools later) | IOPS for pgvector HNSW builds |
| Kafka | add brokers / partitions | partition count per topic |
| ClickHouse | sharded cluster (ClickHouse Cloud) | ingestion rate |
| Neo4j | read replicas (AuraDB) | write throughput |

**Backpressure.** The orchestrator enforces:
- Per-user rate limits (Redis sliding window)
- Max steps per run (hard cap 50)
- Max parallel tool calls per step (unbounded today; likely needs a semaphore at scale)

**Cache warming.** LLM calls don't currently share a cache, but the ClickHouse `cache_hit` field is wired up — a Redis-backed prompt-result cache is a natural next step.

---

## Failure Modes

**LLM provider outage.** Router fails over to the next-best model from a different provider (single retry). If all providers fail, the run terminates with `FAILED` status and an error message.

**Postgres unavailable.** Orchestrator `/ready` returns 503; HPA stops scaling up. Runs in flight fail fast (step persistence is required). ClickHouse + Neo4j writes degrade gracefully (warnings in logs, no run abort).

**Kafka unavailable.** Orchestrator logs a warning per publish attempt; runs proceed because Postgres step persistence and Redis pub/sub are primary. Downstream analytics lag but recover when Kafka returns.

**Redis unavailable.** WebSocket live streaming stops. Runs still complete; the UI falls back to polling `/runs/:id` for final state.

**Sandbox outage.** `code_exec` tool returns an error object; agent receives it as an observation and can reason about it (often produces a sensible "I couldn't run the code, here's what it would have done" answer).

**ClickHouse outage.** LLM call logging and metrics pages degrade. No runs fail. ClickHouse batches are lost — acceptable for analytics data.

**Stripe outage.** Billing checkout fails with 503. Existing subscriptions keep working (we don't verify per-call). Usage reports fail silently, will re-sync via webhook.

**Approval request times out.** The waiting ReAct loop receives `approved = false` and treats the tool call as failed. The run can still complete (agent decides what to do with the failure).

---

## Trade-offs & Non-Goals

**We use Postgres + pgvector instead of Pinecone/Weaviate.** One fewer store. Hybrid search is easier with co-located `tsvector`. The ceiling (~10M vectors per shard with HNSW) is high enough for typical deployments; past that, add a managed vector DB as a tier.

**We use Kafka (KRaft) instead of RabbitMQ / NATS.** Durable log semantics are important for the event bus — we need to replay agent events for analytics and debugging. KRaft removes the Zookeeper dependency.

**We do not auto-apply prompt optimizations.** The optimizer returns a *proposal*; acceptance requires an explicit API call. Silent prompt drift would create a debugging nightmare.

**Reflection uses a frontier model by default.** Reflection is called once per run, not once per step, so the cost is amortized. Using Haiku here would be cheaper but empirically misses subtle failure patterns.

**No RLHF / fine-tuning in the platform itself.** NexusAI is a deployment and orchestration plane. Bring your own fine-tuned model by adding it to the router's catalog.

**No multi-region active-active.** Out of scope for initial release. Postgres + pgvector + ClickHouse all support cross-region replication; a future multi-region variant would need session-affinity routing and conflict resolution for memory writes.

**Browser Monaco editor is a textarea today.** The "playground" page uses a simple textarea plus WebSocket-streamed output, not the full Monaco component — swap-in is one PR when needed.
