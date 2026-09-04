# `apps/evals` — agent evaluation & regression gating

A Python/FastAPI service that answers the question the rest of NexusAI can't: **did that change
make the agents better or worse?**

You define a *suite* of test cases, point it at a *target* (a NexusAI agent, an arbitrary HTTP
endpoint, or a zero-cost echo), and every case is scored by one or more *assertions*. Runs are
persisted, so any two runs can be diffed into a ship / no-ship verdict.

- **Port:** 5100
- **Storage:** its own `evals` Postgres schema, created on startup (no Prisma migration needed)
- **Metrics:** `/metrics` (Prometheus), `/health`

---

## Concepts

| Concept | What it is |
| --- | --- |
| **Suite** | A named set of cases belonging to an owner. Upserted by `(ownerId, name)`, so CI can re-post a definition idempotently. |
| **Case** | One `input`, an optional `expected`, and a list of assertions. `weight` scales its share of the run score. |
| **Target** | Where the input is sent: `agent`, `http`, or `echo`. |
| **Run** | One execution of a suite against a target. Persisted per case, so a run that dies halfway still has usable partial results. |
| **Gate** | A diff of a candidate run against a baseline that returns `gatePassed` plus the reasons it failed. |

## Assertion types

Deterministic — no API keys, no cost:

| Type | `value` | Notable `options` |
| --- | --- | --- |
| `exact` | string to match | `caseSensitive` (default false) |
| `contains` | string or list of strings | `caseSensitive`. A list gives partial credit but only passes when all are present. |
| `not_contains` | string or list | `caseSensitive`. Use for leak checks (secrets, PII, refusal text). |
| `regex` | pattern | `caseSensitive`, `dotAll` |
| `json_path` | expected value at the path | `path` (dotted, supports list indices: `items.1.status`). No `path` just asserts valid JSON. |
| `numeric` | expected number | `tolerance`. Pulls the first number out of prose and ignores thousands separators. |
| `latency_budget` | — | `maxMs`. Degrades linearly to zero at 2× budget. |
| `cost_budget` | — | `maxUsd`. Same degradation curve. |

Model-backed — needs keys, costs money:

| Type | `value` | Notable `options` |
| --- | --- | --- |
| `embedding_similarity` | reference text (falls back to the case's `expected`) | `threshold` (default 0.82). Needs `OPENAI_API_KEY`. |
| `llm_judge` | the rubric | `threshold` (default 0.7). Needs `GOOGLE_API_KEY`. |

Every assertion also takes `weight` (default 1.0) and `required` (default true). A case passes
when **every required assertion** passes; its score is the weighted mean of all assertion scores.
A case with no assertions is a smoke test — it passes if it produced any output.

Assertions never raise. A misconfigured or failing scorer records a zero with the reason attached,
so one bad check cannot take down a run.

## Targets

```jsonc
{ "type": "echo" }                                  // returns the input; free smoke tests

{ "type": "agent", "agentId": "…", "maxSteps": 8 }  // starts an orchestrator run and polls it
                                                    // to completion; picks up real cost + latency

{ "type": "http", "url": "https://…",               // any endpoint
  "inputField": "input", "outputPath": "output" }
```

A suite stores a default target; a run can override it — that is how you evaluate the same suite
against a candidate agent and a baseline agent.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/suites` | Create or update a suite (upsert by owner + name) |
| `GET` | `/suites?ownerId=` | List suites |
| `GET` | `/suites/{id}` | Suite with all cases |
| `PUT` | `/suites/{id}/cases` | Replace the whole case set |
| `DELETE` | `/suites/{id}` | Delete a suite and its runs |
| `POST` | `/suites/{id}/runs` | Start a run (202, returns `runId`; poll for progress) |
| `GET` | `/runs/{id}` | Run status, summary and per-case results |
| `GET` | `/suites/{id}/runs` | Run history, newest first |
| `GET` | `/runs/{id}/compare?baseline=…` | Regression gate verdict |

### Example

```bash
# 1. Define a suite
curl -X POST localhost:5100/suites -H 'content-type: application/json' -d '{
  "ownerId": "demo-user",
  "name": "support-agent",
  "target": {"type": "agent", "agentId": "<agent-uuid>"},
  "cases": [
    {
      "key": "refund-policy",
      "input": "What is our refund window?",
      "expected": "30 days",
      "assertions": [
        {"type": "contains", "value": "30 days"},
        {"type": "not_contains", "value": ["I cannot", "as an AI"]},
        {"type": "cost_budget", "options": {"maxUsd": 0.02}}
      ]
    }
  ]
}'

# 2. Run it
curl -X POST localhost:5100/suites/$SUITE/runs -H 'content-type: application/json' \
  -d '{"label": "baseline"}'

# 3. …change the agent, run again, then gate the change
curl "localhost:5100/runs/$CANDIDATE/compare?baseline=$BASELINE&maxRegressions=0"
```

### The gate

`compare` is deliberately conservative: **any case that got worse counts as a regression**, even
when the aggregate pass rate improved — averages hide the case you broke. It returns:

```jsonc
{
  "passRateDelta": -0.33, "meanScoreDelta": -0.33,
  "costDelta": 0.0041, "p95LatencyDelta": 120,
  "regressions": [{"caseKey": "refund-policy", "scoreDelta": -1.0, "verdict": "regressed"}],
  "fixes": [], "unchanged": 2,
  "gatePassed": false,
  "gateReasons": ["1 regressed case(s), limit 0: ['refund-policy']"]
}
```

Query parameters tune it: `maxRegressions` (default 0), `maxCostIncrease` (default off), and
`minPassRateDelta` (default off — an opt-in aggregate check on top of the per-case gate).
Cases missing from the candidate always fail the gate, so you can't green a run by deleting tests.

---

## Running it

```bash
# With the rest of the platform
docker compose up -d postgres evals

# Locally
cd apps/evals
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev]"   # Windows
pnpm --filter @nexusai/evals dev
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | Postgres. The service creates its own `evals` schema. |
| `ORCHESTRATOR_URL` | `http://localhost:4000` | Where `agent` targets are executed |
| `OPENAI_API_KEY` | — | Only for `embedding_similarity` |
| `GOOGLE_API_KEY` | — | Only for `llm_judge` |
| `JUDGE_MODEL` | `gemini-1.5-pro` | Judge model |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Similarity model |
| `EVAL_CONCURRENCY` | `4` | Cases run in parallel per run |
| `AGENT_RUN_TIMEOUT_S` | `300` | Ceiling on waiting for one agent run |

The LLM SDKs are imported lazily, so the deterministic assertions run with neither key set.

## Tests

```bash
cd apps/evals
python -m pytest -q                                     # unit tests only
EVALS_TEST_DATABASE_URL=postgresql://nexus:nexus@127.0.0.1:5433/nexusai python -m pytest -q
```

The database-backed suite skips itself when `EVALS_TEST_DATABASE_URL` is unset. CI runs both
against a Postgres service container.

> On Windows, prefer `127.0.0.1` over `localhost` in the URL — `localhost` resolves to `::1`
> first, which does not always reach the Docker port mapping.
