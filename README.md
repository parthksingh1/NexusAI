# NexusAI

**Autonomous AI Agent Operating System.**

NexusAI is a production-grade, distributed platform for building, deploying, and operating autonomous AI agents. Agents can reason through complex goals, use tools, collaborate with other agents, ingest organizational knowledge, execute code in sandboxes, react to real-time data streams, and improve themselves over time — all with enterprise-grade safety, observability, and cost controls.

It is designed to be **run locally with a single `docker-compose up`** and **deployed to production on Kubernetes** (GKE) without changing the application code.

---

## Table of Contents

1. [What is NexusAI?](#what-is-nexusai)
2. [Key Capabilities](#key-capabilities)
3. [System Architecture](#system-architecture)
4. [Repository Layout](#repository-layout)
5. [Quick Start](#quick-start)
6. [Using NexusAI](#using-nexusai)
7. [SDKs & CLI](#sdks--cli)
8. [Deployment](#deployment)
9. [Configuration](#configuration)
10. [Observability](#observability)
11. [Safety Model](#safety-model)
12. [Further Reading](#further-reading)

---

## What is NexusAI?

Most teams adopting LLMs end up building the same scaffolding from scratch: an agent loop, a tool registry, a retrieval pipeline, a model router, cost tracking, observability, a sandbox for code execution, and auth. NexusAI ships all of that as an opinionated, production-ready platform.

Think of it as a control plane for autonomous agents:

- A **user or application** defines an agent (name, goal, persona, allowed tools, routing policy).
- The **orchestrator** runs that agent through a ReAct loop — reasoning with an LLM, calling tools, feeding observations back.
- The **RAG service** grounds answers in your organization's documents (Notion, GitHub, Slack, URLs, uploads).
- The **sandbox service** executes untrusted code safely.
- The **realtime service** lets agents react to crypto, news, and weather streams in real time.
- The **memory graph** (Neo4j) stores episodic, semantic, procedural, and reflection memories across runs.
- The **web dashboard** provides live run consoles, approval queues, marketplaces, streams, and cost analytics.

Everything is **typed end-to-end**, **streamed over WebSockets**, and **horizontally scalable**.

---

## Key Capabilities

### Agent orchestration
- Multi-step ReAct loop (Reason → Act → Observe → repeat).
- Tool registry with typed parameters and per-tool risk levels.
- Agent lifecycle (idle / running / paused / stopped / error).
- Agent-to-agent messaging via Kafka.
- Live step streaming to browser via WebSocket + Redis pub/sub.

### Multi-model LLM router
- Unified interface across **Anthropic Claude**, **OpenAI GPT**, and **Google Gemini**.
- Task-weighted scoring picks the right model per call (reasoning vs. extraction vs. classification vs. fast).
- Hard constraints (max cost/call, max latency, vision required, JSON mode) + soft scoring (cost/latency/reasoning fit).
- Automatic fallback to a secondary provider if the primary fails.
- Streaming, tool calls, and cost tracking are uniform across all providers.

### Advanced RAG
- **Hybrid search** — dense (pgvector cosine) + sparse (Postgres tsvector/FTS) — fused and normalized.
- **HyDE** (Hypothetical Document Embeddings) for zero-shot queries.
- **Query decomposition** — an LLM splits complex questions into multi-hop sub-queries.
- **Cross-encoder reranking** — Cohere rerank-3 or Jina reranker v2, with lexical-overlap fallback.
- **Connectors** — Notion pages, GitHub READMEs/issues, Slack history, arbitrary URLs.
- **Chunking strategies** — fixed, recursive, semantic, markdown.
- **Citation-grounded outputs** — tool outputs include source URLs the model is instructed to cite.

### Code agent & sandbox
- Docker-based execution for Python, Node.js, and Bash.
- Hard limits: no network, read-only rootfs, capability-dropped, memory + pids cap, CPU quota, tmpfs on `/tmp`.
- **gVisor runtime** (`runsc`) when available on host — defense-in-depth against kernel escapes.
- WebSocket streaming of stdout/stderr into the web UI (Monaco-style playground).
- `code_exec` and `github_create_pr` tools are first-class agent capabilities.

### Real-time data agents
- Live WebSocket ingest of crypto trades (Binance), Hacker News front page, open-meteo weather.
- Rolling z-score anomaly detector (Welford + windowed).
- LLM-scored sentiment with batched backpressure.
- Kafka fan-out + buffered ClickHouse writes.
- Dedup'd alert engine in Redis (sorted-set + pub/sub).
- Live charts (Recharts) in the web dashboard.

### Memory system
- **Postgres + pgvector** — per-memory embeddings, importance scores, recency.
- **Neo4j graph** — typed memory relations (HAS_MEMORY, USED_TOOL, RELATED_TO), agent + tool + concept nodes.
- Four memory types: **episodic** (things that happened), **semantic** (facts learned), **procedural** (reusable skills), **reflection** (self-critique).
- Automatic reflection after every run — the critic LLM scores the run, extracts learnings, and promotes good strategies to procedural memory.

### Marketplace
- Publish any agent you own to a public catalog.
- Fork agents with one click — creates your own copy preserving persona/tools/policy.
- Star ranking, search, and provenance tracking (`forkFrom`).

### Collaboration protocol
- Multi-agent debate with roles: **planner → executor → critic → synthesizer**.
- Kafka `AGENT_MESSAGE` bus for cross-agent communication.
- Consensus model: critic approval or iteration budget exhaustion.

### Safety layer
- **Tool risk scoring** — `safe`/`moderate`/`dangerous`, plus heuristic pattern matching for blocked inputs.
- **Human-in-the-loop approvals** — dangerous tool calls pause the run until a human decides (via UI or API).
- **Timeout enforcement** — approvals expire after 2 minutes by default.
- **Rate limiting** — per-user sliding window in Redis.
- **Full audit trail** — every step, tool invocation, LLM call, and approval is persisted.

### Self-improving agents
- Post-run reflection extracts "what worked" / "what to improve" / reusable skills.
- Prompt optimizer analyzes reflection history and proposes improved system prompts.
- Skill memory is recalled into system prompts on subsequent runs.

### Observability
- **Prometheus** metrics on every service (counters, histograms, gauges).
- **OpenTelemetry** tracing exported to Jaeger (distributed request flows).
- **ClickHouse** time-series: per-call LLM usage for cost/latency/A-B dashboards.
- **Grafana** for infra + app dashboards.
- Structured JSON logs (pino / structlog).

### Billing & monetization
- Tiered subscriptions (Free / Pro / Team / Enterprise).
- **Stripe metered billing** — per-agent-run usage is reported to Stripe for overage charges.
- Hard monthly cost caps per tier enforced server-side.
- Webhook handler for `checkout.session.completed` and `customer.subscription.deleted`.

### Developer platform
- **TypeScript SDK** (`@nexusai/sdk`) — promise + async-iterator API, isomorphic (Node + browser).
- **Python SDK** (`nexusai`) — sync httpx + async websockets.
- **CLI** (`nexus`) — list/create/run agents, ingest and search RAG, scripted from your terminal.
- **Autonomous workflows** — cron-scheduled agent runs with persistent schedules.
- **Simulation service** — deterministic mock APIs (email, CRM, quotes) for safe CI testing.

---

## System Architecture

```
                          ┌────────────────────────────────┐
                          │  Web (Next.js 15 + TS)         │
                          │  Dashboard · Playground        │
                          │  Live runs · Streams           │
                          │  Approvals · Marketplace       │
                          └──────────────┬─────────────────┘
                                         │  REST + WebSocket
                                         ▼
          ┌────────────────┬─────────────────────┬────────────────┐
          │                │                     │                │
          ▼                ▼                     ▼                ▼
  ┌──────────────┐ ┌───────────────┐  ┌───────────────┐ ┌───────────────┐
  │ Orchestrator │ │ RAG           │  │ Sandbox       │ │ Realtime      │
  │ (Node/TS)    │ │ (Python FA)   │  │ (Node/TS)     │ │ (Node/TS)     │
  │ ReAct loop   │ │ Hybrid search │  │ Docker exec   │ │ WS ingest     │
  │ Tool registry│ │ HyDE + rerank │  │ gVisor        │ │ z-score       │
  │ Safety gate  │ │ Connectors    │  │ WS streaming  │ │ Sentiment     │
  │ Billing      │ │ Ingest pipe   │  │               │ │ Alerts        │
  └───────┬──────┘ └───────┬───────┘  └───────┬───────┘ └───────┬───────┘
          │                │                  │                 │
          └────────┬───────┴───────┬──────────┴────────┬────────┘
                   │               │                   │
                   ▼               ▼                   ▼
            ┌────────────────────────────────────────────────┐
            │          Data & Messaging Layer                │
            │                                                │
            │  Postgres+pgvector · ClickHouse · Neo4j        │
            │  Redis · Kafka (KRaft) · OTel · Prometheus     │
            └────────────────────────────────────────────────┘
```

For a deep dive into component responsibilities, data flows, failure modes, and scaling strategies, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Repository Layout

```
nexusai/
├── apps/
│   ├── web/           Next.js 15 dashboard
│   ├── orchestrator/  Fastify service — agents, tools, ReAct, auth, billing
│   ├── rag/           Python FastAPI — hybrid RAG + connectors
│   ├── sandbox/       Docker sandbox runner (code execution)
│   ├── realtime/      Real-time ingest + anomaly + alerts
│   └── simulation/    Mock APIs for safe CI testing
├── packages/
│   ├── shared/        Shared TS types + Zod schemas + Kafka contracts
│   ├── llm-router/    Multi-provider LLM routing
│   ├── db/            Prisma schema + singleton client
│   ├── sdk-ts/        Official TypeScript SDK
│   ├── sdk-py/        Official Python SDK
│   └── cli/           `nexus` CLI
├── infra/
│   ├── postgres/      pgvector init scripts
│   ├── clickhouse/    LLMOps schemas
│   ├── neo4j/         Graph init
│   ├── prometheus/    Scrape config
│   ├── otel/          Collector config
│   ├── k8s/           Production Kubernetes manifests (GKE-ready)
│   └── terraform/     GCP infrastructure as code
├── scripts/
│   └── seed.sh        One-shot local bootstrap
├── .github/workflows/ CI pipelines
├── docker-compose.yml All-in-one local infra
├── turbo.json         Task orchestration
├── pnpm-workspace.yaml
└── RUNBOOK.md         Operations guide
```

---

## Quick Start

**Prerequisites**
- Node.js 20+, pnpm 9+
- Python 3.11+
- Docker Desktop (running)
- At least one LLM key: `ANTHROPIC_API_KEY` (recommended), `OPENAI_API_KEY` (needed for embeddings), or `GOOGLE_API_KEY`

**Boot the stack**

```bash
# 1. Configure
cp .env.example .env            # then paste your API keys

# 2. Install
pnpm install
cd apps/rag && python -m venv .venv && source .venv/bin/activate && pip install -e . && cd ../..

# 3. Start all infrastructure
docker-compose up -d

# 4. Apply schema + seed demo user + demo agent
bash scripts/seed.sh

# 5. Run the services
pnpm --filter @nexusai/orchestrator dev   # :4000
pnpm --filter @nexusai/web dev            # :3000
cd apps/rag && uvicorn app.main:app --reload --port 5000
```

Open **http://localhost:3000** → Agents → run the seeded **Research Assistant**. You'll see the ReAct steps stream live over WebSocket.

Full runbook with troubleshooting: [`RUNBOOK.md`](./RUNBOOK.md).

---

## Using NexusAI

### Create & run an agent via REST

```bash
# Create
curl -X POST localhost:4000/agents -H 'content-type: application/json' -d '{
  "name": "Market analyst",
  "goal": "Research tech stocks and produce cited summaries",
  "persona": {
    "name": "Market analyst",
    "description": "Careful equity research",
    "systemPrompt": "You analyze public markets. Cite sources.",
    "temperature": 0.2
  },
  "tools": ["web_search", "calculator", "knowledge_search"],
  "modelRoutingPolicy": { "preferredProvider": "anthropic", "maxLatencyMs": 3000 }
}'

# Run (returns runId; subscribe to ws://localhost:4000/ws/runs/<runId> for live steps)
curl -X POST localhost:4000/agents/<AGENT_ID>/runs -H 'content-type: application/json' -d '{
  "input": "Summarize NVDA performance this quarter with sources",
  "maxSteps": 12,
  "stream": true
}'
```

### Ingest a document into the RAG knowledge base

```bash
curl -X POST localhost:5000/ingest -H 'content-type: application/json' -d '{
  "ownerId": "<YOUR_USER_ID>",
  "source": "url",
  "sourceId": "https://example.com/strategy-doc",
  "title": "Company strategy 2026",
  "url": "https://example.com/strategy-doc",
  "text": "...",
  "chunking": "markdown"
}'
```

Use one of the connector endpoints to pull from Notion / GitHub / Slack / URLs directly:

```bash
curl -X POST localhost:5000/connectors/github/repo -d '{"ownerId":"...","owner":"vercel","repo":"next.js"}' -H 'content-type: application/json'
```

### Multi-agent collaboration

```bash
curl -X POST localhost:4000/collaborate -H 'content-type: application/json' -d '{
  "goal": "Plan a 3-day technical conference on agents",
  "input": "Budget $50k, 300 attendees, needs CFP + venue + track layout",
  "maxIterations": 5
}'
```

The planner breaks the goal into steps, the executor runs each with tools, the critic reviews, and the synthesizer produces the final answer.

### Approve a dangerous tool call

When an agent calls `github_create_pr` (risk level `dangerous`), its run pauses. Go to **/approvals** in the web dashboard, review the input, and click **Approve** or **Reject**. Or via API:

```bash
curl -X POST localhost:4000/approvals/<id>/decide -d '{"decision":"approved"}' -H 'content-type: application/json'
```

---

## SDKs & CLI

### TypeScript SDK

```ts
import { NexusClient } from "@nexusai/sdk";

const nx = new NexusClient({ apiKey: process.env.NEXUSAI_API_KEY });

const agent = await nx.agents.create({
  name: "Researcher",
  goal: "Help me research topics thoroughly",
  persona: { name: "Researcher", systemPrompt: "Cite every claim." },
  tools: ["web_search", "knowledge_search"],
});

for await (const step of nx.agents.run(agent.id, "Summarize today's AI news")) {
  if ("kind" in step) console.log(step.kind, step.content);
  else if (step.type === "done") console.log("DONE:", step.result);
}
```

### Python SDK

```python
from nexusai import NexusClient
import asyncio

nx = NexusClient(api_key="nxs_...")

agent = nx.agents.create(
    name="Researcher",
    goal="Help me research topics thoroughly",
    persona={"name": "Researcher", "systemPrompt": "Cite every claim."},
    tools=["web_search", "knowledge_search"],
)

async def main():
    async for step in nx.agents.run(agent["id"], "Summarize today's AI news"):
        print(step.get("kind"), step.get("content"))

asyncio.run(main())
```

### CLI

```bash
pnpm --filter @nexusai/cli build
alias nexus="node $(pwd)/packages/cli/dist/bin.js"

nexus agents:list
nexus agents:create -n "Researcher" -g "Help with research" -t "web_search,calculator"
nexus agents:run <agent-id> "What's the market cap of NVDA?"

echo "Company founding date: 2019" | nexus ingest -t "Company facts" -s "facts-v1"
nexus search "when was the company founded"
```

---

## Deployment

### Local (single command)

```bash
docker-compose up -d
```

Brings up Postgres, Redis, Kafka, Neo4j, ClickHouse, Prometheus, Grafana, OpenTelemetry Collector, and Jaeger on their standard ports.

### Production (Kubernetes on GKE)

Manifests are in [`infra/k8s/`](./infra/k8s/). They include:

- `Deployment` + `Service` for every app
- `HorizontalPodAutoscaler` (CPU + custom `nexus_active_runs` metric)
- `PodDisruptionBudget` for zero-downtime rollouts
- `HTTPRoute` via Gateway API for ingress
- `RuntimeClass: gvisor` on the sandbox deployment (GKE Sandbox)
- `ConfigMap` + `Secret` (pulls from Google Secret Manager via External Secrets)

### Infrastructure as Code

Terraform in [`infra/terraform/`](./infra/terraform/) provisions:

- GKE Autopilot cluster (regional, workload identity, release channel: REGULAR)
- Cloud SQL Postgres 16 with pgvector (HA, PITR, query insights)
- MemoryStore Redis 7.2 (STANDARD_HA)
- Artifact Registry (Docker)
- Secret Manager entries

```bash
cd infra/terraform
terraform init -backend-config="bucket=your-tfstate-bucket"
terraform apply
gcloud container clusters get-credentials nexusai-prod --region us-central1
kubectl apply -f ../k8s/
```

### CI/CD

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs typecheck + Python lint on every PR and builds + pushes images to GHCR on `main`.

---

## Configuration

Every service reads from environment variables (no config files required). See [`.env.example`](./.env.example) for the full list. Key groups:

| Variable | Purpose |
| -------- | ------- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | LLM providers (need at least one) |
| `DATABASE_URL` | Postgres + pgvector connection |
| `REDIS_URL` | Redis connection |
| `KAFKA_BROKERS` | Kafka brokers (comma-separated) |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Memory graph |
| `CLICKHOUSE_URL` | LLMOps time-series |
| `JWT_SECRET` | JWT signing (rotate in prod) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Billing |
| `COHERE_API_KEY`, `JINA_API_KEY` | Optional: cross-encoder rerank |
| `GITHUB_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN` | Optional: connectors |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional: OpenTelemetry tracing |

---

## Observability

NexusAI ships a full observability stack out of the box:

| Signal | Source | Sink | View |
| ------ | ------ | ---- | ---- |
| **Metrics** | `/metrics` on each service | Prometheus | Grafana at `:3001` |
| **Traces** | OpenTelemetry SDK in orchestrator | OTel Collector → Jaeger | `:16686` |
| **Logs** | pino (Node) + structlog (Python) | stdout (kubectl logs / Cloud Logging) | — |
| **LLM usage** | orchestrator on every call | ClickHouse `nexusai.llm_calls` | `/metrics` page in the web dashboard |
| **Agent events** | orchestrator ReAct loop | Kafka + Redis pub/sub | live WS in web dashboard |

Key metrics exposed:

- `nexus_agent_runs_started_total`, `nexus_agent_runs_finished_total{status}`
- `nexus_agent_step_duration_ms{kind}` (histogram)
- `nexus_tool_invocations_total{tool,success}`
- `nexus_llm_cost_usd_total{provider,model}`
- `nexus_active_runs` (gauge, drives HPA)

---

## Safety Model

NexusAI was designed with the assumption that agents will occasionally try to do things you don't want.

1. **Tool risk declaration.** Every registered tool has a declared risk level (`safe`/`moderate`/`dangerous`) and an optional `requiresApproval` flag.
2. **Input heuristics.** The safety layer inspects tool inputs for blocked patterns (`rm -rf /`, fork bombs, `DROP TABLE`, secret exfiltration signatures). Matches score 1.0 and are always blocked.
3. **Approval gate.** Tools with risk `dangerous` or `requiresApproval` pause the run and create an `ApprovalRequest`. A human reviews via web UI or API and approves/rejects within the timeout window (default 2 minutes; expired = rejected).
4. **Sandbox isolation.** All code execution runs in a Docker container with no network, read-only rootfs, dropped capabilities, memory + pids caps, and (when available) the gVisor user-space kernel.
5. **Full audit trail.** Every LLM call, tool invocation, and approval decision is persisted to Postgres + ClickHouse for forensics.
6. **Rate limits.** Per-user sliding-window limits in Redis prevent runaway agents from racking up cost.
7. **Hard cost caps.** Each subscription tier has a monthly USD cap enforced before the next run starts.

---

## Further Reading

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — deep dive into system design, data flows, failure modes, scaling
- **[`RUNBOOK.md`](./RUNBOOK.md)** — operational guide: start, stop, seed, troubleshoot
- **[`infra/k8s/`](./infra/k8s/)** — production Kubernetes manifests
- **[`infra/terraform/`](./infra/terraform/)** — GCP infrastructure as code
- **[`packages/shared/src/events.ts`](./packages/shared/src/events.ts)** — canonical Kafka event contracts
- **[`packages/db/prisma/schema.prisma`](./packages/db/prisma/schema.prisma)** — data model

---

## License

Copyright (c) 2026. All rights reserved.
