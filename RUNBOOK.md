# NexusAI Phase 1 Runbook

This runbook covers Phase 1 — a runnable monorepo with agent orchestration, LLM routing, hybrid RAG,
a Next.js dashboard, and full local infrastructure.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm i -g pnpm@9.12.0`)
- Python ≥ 3.11
- Docker Desktop (must be running)
- At least one LLM API key: `ANTHROPIC_API_KEY` (recommended), `OPENAI_API_KEY`, or `GOOGLE_API_KEY`
- Windows users: use **bash** (Git Bash / WSL). All commands below are bash.

## 1. Install dependencies

```bash
cp .env.example .env
# Edit .env — paste at least ANTHROPIC_API_KEY and OPENAI_API_KEY (OpenAI is used for embeddings)

pnpm install

# Python deps for the RAG service
cd apps/rag
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -e .
cd ../..
```

## 2. Start infrastructure

```bash
docker-compose up -d
docker-compose ps      # confirm: postgres, redis, kafka, neo4j, clickhouse, prometheus, grafana
```

Wait ~20s for postgres/kafka/neo4j to become healthy.

## 3. Database setup + seed

```bash
bash scripts/seed.sh
```

This pushes the Prisma schema to Postgres, creates a demo user + seed agent, and loads Neo4j
memory-graph constraints.

## 4. Start all services

In separate terminals (or use `pnpm dev` from the root for parallel Node services):

```bash
# Terminal 1 — orchestrator
pnpm --filter @nexusai/orchestrator dev

# Terminal 2 — RAG
cd apps/rag && source .venv/bin/activate && uvicorn app.main:app --reload --port 5000

# Terminal 3 — web
pnpm --filter @nexusai/web dev
```

Open `http://localhost:3000` → `/agents` → open the seeded **Research Assistant** → click **Run agent**.
Watch ReAct steps stream live over WebSocket.

## 5. Service map

| Service       | URL                              | Purpose                                |
| ------------- | -------------------------------- | -------------------------------------- |
| Web dashboard | http://localhost:3000            | Next.js UI                             |
| Orchestrator  | http://localhost:4000            | REST + `/ws/runs/:runId` WebSocket     |
| RAG           | http://localhost:5000            | `/search`, `/ingest`                   |
| Postgres      | localhost:5432 (nexus/nexus)     | Primary DB + pgvector                  |
| Redis         | localhost:6379                   | Pub/sub + cache                        |
| Kafka         | localhost:9092                   | Event bus                              |
| Neo4j         | http://localhost:7474            | Memory graph (neo4j / nexuspass)       |
| ClickHouse    | http://localhost:8123            | LLMOps time-series                     |
| Prometheus    | http://localhost:9090            | Metrics scrape                         |
| Grafana       | http://localhost:3001            | Dashboards (admin / admin)             |

## 6. Verifying the full path

```bash
# Health
curl localhost:4000/health
curl localhost:5000/health

# List agents
curl localhost:4000/agents | jq

# Start a run (replace <AGENT_ID> from the response above)
curl -X POST localhost:4000/agents/<AGENT_ID>/runs \
  -H 'content-type: application/json' \
  -d '{"input":"What is 123 * 4567?","maxSteps":5,"stream":true}'

# Read the run detail (replace <RUN_ID>)
curl localhost:4000/runs/<RUN_ID> | jq

# Ingest a document into the RAG service
curl -X POST localhost:5000/ingest \
  -H 'content-type: application/json' \
  -d '{
    "ownerId":"00000000-0000-0000-0000-000000000001",
    "source":"url",
    "sourceId":"https://example.com/hello",
    "title":"Hello doc",
    "url":"https://example.com/hello",
    "text":"NexusAI is an autonomous agent operating system. It supports ReAct loops, hybrid RAG, and memory graphs.",
    "chunking":"recursive"
  }'

# Search
curl -X POST localhost:5000/search \
  -H 'content-type: application/json' \
  -d '{"ownerId":"00000000-0000-0000-0000-000000000001","query":"what is nexusai","topK":5,"useRerank":true}'
```

## 7. What ships in Phase 1

- ✅ Monorepo (pnpm + turbo) with shared TS types, Zod schemas, event contracts
- ✅ Multi-provider LLM router (Claude / GPT / Gemini) with cost/latency/complexity scoring + fallback
- ✅ Prisma schema: users, orgs, agents, runs, steps, memory (pgvector), RAG chunks, marketplace, approvals
- ✅ Orchestrator (Fastify): REST + WebSocket, ReAct loop, tool registry, Kafka producer, Redis pub/sub, Prometheus
- ✅ Tools: `web_search` (DDG), `calculator`, `knowledge_search` (calls RAG service)
- ✅ RAG service (FastAPI): hybrid dense+sparse search, HyDE, pluggable rerank, four chunking strategies
- ✅ Next.js 15 dashboard with dark mode, agent list, create dialog, **live run console over WebSocket**
- ✅ Full infrastructure via docker-compose: postgres+pgvector, redis, kafka (KRaft), neo4j, clickhouse, prometheus, grafana
- ✅ Dockerfiles for orchestrator, RAG, and web

## 8. All phases — shipped

| Phase | Included |
| ----- | -------- |
| 1 | Monorepo, shared types, LLM router, Prisma, orchestrator ReAct loop, RAG skeleton, Next.js dashboard, docker-compose infra |
| 2 | Cohere/Jina cross-encoder rerank, query decomposition, Notion/GitHub/Slack/URL connectors, Neo4j memory graph, reflection loop |
| 3 | Sandbox runner (Docker + gVisor-ready), code_exec tool, github_create_pr tool, Monaco-style playground with WS streaming |
| 4 | Realtime service (Binance WS + HN + open-meteo), rolling z-score anomaly detection, LLM sentiment, ClickHouse cost analytics, OTel + Jaeger |
| 5 | JWT auth + API keys + scrypt passwords, marketplace UI, collaboration protocol (planner/executor/critic), risk scoring + human-in-the-loop approvals |
| 6 | Prompt optimizer, skill memory, simulation service, TypeScript + Python SDK, CLI (`nexus`), Stripe metered billing, cron-scheduled autonomous runs, full K8s manifests (GKE), Terraform for GKE + Cloud SQL + MemoryStore + Artifact Registry + Secret Manager |

## 9. Troubleshooting

- **Orchestrator can't reach Postgres** → ensure `DATABASE_URL` in `.env` uses `localhost:5432` when running the service outside Docker.
- **WebSocket never receives steps** → check that Redis is up (`docker-compose ps`) and the orchestrator logs show "redis connected".
- **RAG search returns empty** → you must ingest at least one document first. The `knowledge_search` tool will still return `hits: []` gracefully.
- **Prisma push fails with "extension vector"** → the postgres container init must have run (volume can get cached). `docker-compose down -v && docker-compose up -d` wipes state.
- **Anthropic 401** → verify `ANTHROPIC_API_KEY` starts with `sk-ant-`. The router will fall back to OpenAI or Gemini if available.
