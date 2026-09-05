# `apps/manager` — dynamic multi-agent planner

You give it a goal in plain language. A planner decomposes the goal into tasks, and
specialist agents execute them — several at once where the tasks do not depend on each
other — then a synthesizer merges what they found into a cited answer.

Scope is research, web browsing, YouTube analysis, data extraction and report generation.

- **Port** 4100
- **Models** Ollama locally at no cost, or Claude, GPT or Gemini. Chosen per run.
- **Storage** the existing Postgres, via LangGraph's checkpointer, so an interrupted run
  resumes instead of starting over
- **Streaming** Redis pub/sub plus SSE and WebSocket

---

## How a run works

```
  goal
    │
    ▼
┌─────────┐   Plan (validated, repaired)
│ planner │──────────────────────────────┐
└─────────┘                              │
                                         ▼
                               ┌───────────────────┐
                               │ LangGraph         │
                               │  node per task    │
                               │  edges from deps  │
                               └─────────┬─────────┘
                                         │
              wave 1  (these run at the same time)
        ┌───────────┬────────────┬───────────┬──────────┐
        ▼           ▼            ▼           ▼          ▼
   researcher  web_scraper  video_analyst  coder     (…)
        │           │            │           │
     search      fetch/       transcript   sandbox
     fetch       browse       + summarise  exec
     rag_query
        └───────────┴────────────┴───────────┘
                          │
                       wave 2
                          ▼
                    synthesizer  ──►  answer + citations
```

Every transition is published as a `RunEvent` to Redis and to the SSE and WebSocket streams,
so the graph in the web UI updates as the work happens.

## Task types

| Type | What it does |
| --- | --- |
| `research` | Searches the web and the indexed corpus, reads the best results, extracts claims that each name their source |
| `scrape` | Reads named pages and pulls structured content out of them |
| `video` | Reads a public YouTube transcript and summarises it with real timestamps |
| `code` | Writes code, runs it in the existing sandbox, and iterates until it works |
| `synthesize` | Merges every upstream result into the final cited answer |

Workers are leaves. A worker calls tools; it never spawns another worker. Only the manager
creates work, which is what keeps the agent count bounded and the graph acyclic.

## Budget caps

Enforced in code, not by prompting the model to behave. One tracker per run, shared by every
worker, so the limits are per run.

| Cap | Default | Variable |
| --- | --- | --- |
| Total tokens | 200,000 | `MAX_TOTAL_TOKENS` |
| Spend | $1.00 | `MAX_USD` |
| Agents spawned | 8 | `MAX_AGENTS_SPAWNED` |
| Depth | 2 | `MAX_DEPTH` |
| Per-worker timeout | 90s | `WORKER_TIMEOUT_S` |

When a cap is hit the run does not crash. Remaining nodes are skipped without spending, the
synthesizer runs on whatever partial results exist, and the run reports `partial` with the
cap that stopped it.

## Safety

- Every outbound URL is checked against a denylist covering private, loopback, link-local
  and cloud instance-metadata addresses. DNS is resolved, so a public hostname pointing at
  an internal address is caught too.
- `robots.txt` is honoured for both the static fetcher and the browser, cached per host.
- One request per second per domain, held in Redis so the limit applies across workers.
- Pages returning 401 or 403 are not scraped. Age-restricted and private videos report why
  rather than being worked around.
- Code execution goes to the existing sandbox service over HTTP. This service never calls
  `subprocess`, `eval` or `exec`.

## Running it

```bash
# With the platform
docker compose up -d ollama manager postgres redis
docker compose exec ollama ollama pull llama3:8b

# Locally
cd apps/manager
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev]"   # Windows
pip install -e ../../packages-py/nexus-agents-shared
python -m playwright install chromium
python -m uvicorn nexus_manager.main:app --port 4100 --reload
```

Neither Postgres nor Redis is required to start. Without Postgres, runs execute but cannot
be resumed after a restart. Without Redis, the rate limit and robots cache are scoped to one
process. Both are reported in the log rather than failing quietly.

### Commands

```bash
# What can actually run right now, and why not when it cannot
curl localhost:4100/providers

# Start a run; the plan comes back with the response
curl -X POST localhost:4100/chat -H 'content-type: application/json' -d '{
  "goal": "Compare pgvector, Qdrant and Weaviate on benchmarks and community activity",
  "provider": "ollama"
}'

# Watch it happen
curl -N localhost:4100/runs/<run_id>/events

# The finished run
curl localhost:4100/runs/<run_id>

# Continue a run that was interrupted
curl -X POST localhost:4100/runs/<run_id>/resume
```

From the CLI:

```bash
nexus run "Compare pgvector, Qdrant and Weaviate on benchmarks" --provider ollama --stream
```

Exit codes: `0` completed, `2` partial, `1` error.

From the browser: `/manager` in the web app.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/chat` | Plan a goal and start it. Returns `run_id` and the plan. |
| `GET` | `/runs` | Recent runs |
| `GET` | `/runs/{id}` | Status, plan, per-task results, answer, budget |
| `GET` | `/runs/{id}/events` | SSE stream, replaying what already happened |
| `WS` | `/ws/runs/{id}` | The same events over WebSocket |
| `POST` | `/runs/{id}/resume` | Continue from the last checkpoint |
| `POST` | `/runs/{id}/cancel` | Stop a running execution |
| `GET` | `/providers` | Which models are usable now |
| `GET` | `/healthz` `/readyz` `/metrics` | Liveness, readiness, Prometheus |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEFAULT_LLM_PROVIDER` | `ollama` | Provider when a run does not name one |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Local model server |
| `OLLAMA_DEFAULT_MODEL` | `llama3:8b` | Worker model |
| `OLLAMA_PLANNER_MODEL` | `llama3:8b` | Planner model |
| `OLLAMA_TIMEOUT_S` | `600` | Ceiling on one local call |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` | — | Cloud providers. Gemini reads `GOOGLE_API_KEY`. |
| `TAVILY_API_KEY` | — | Optional. Without it, search uses a keyless backend. |
| `RAG_URL` / `SANDBOX_URL` | — | The existing retrieval and sandbox services |
| `DATABASE_URL` / `REDIS_URL` | — | Checkpointing and event fan-out |
| `LANGSMITH_API_KEY` | — | Opt-in tracing. Nothing is sent without it. |

## Tests

```bash
python -m pytest -m "not integration"     # unit tests, no network
python -m pytest -m integration           # real search, real pages, real video
```

The acceptance scenarios in `tests/integration/test_scenarios.py` run the whole system
against real services. On CPU-only hardware set `MANAGER_TEST_WORKER_TIMEOUT_S` above the
90-second default — see `docs/LOCAL_MODE.md` for measured numbers.

## Evaluation

```bash
python evals/run_ragas.py --provider ollama
```

Scores faithfulness, answer relevancy and context precision over ten research goals, writes
`evals/RESULTS.md`, and exits non-zero when a metric regresses more than the allowed margin
against the previous run scored the same way.
