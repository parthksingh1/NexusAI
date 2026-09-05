# Manager architecture

How `apps/manager` turns a sentence into a cited answer, and the decisions behind it.

## Contents

1. [Flow](#flow)
2. [The planner](#the-planner)
3. [The graph](#the-graph)
4. [Workers](#workers)
5. [The budget model](#the-budget-model)
6. [Safety guards](#safety-guards)
7. [Provider matrix](#provider-matrix)
8. [Failure modes](#failure-modes)

---

## Flow

```
POST /chat {goal, provider}
      │
      ├─ 1. plan()                 one structured LLM call
      │      └─ repair()           fix what models reliably get wrong
      │
      ├─ 2. respond 202            run_id + plan, before any work starts
      │
      └─ 3. background execution
             │
             ├─ build a LangGraph StateGraph: node per task, edges from depends_on
             ├─ LangGraph fans out the nodes in each superstep
             ├─ each node: budget check → worker → tools → RunEvent
             └─ terminal node writes answer + citations into state
```

Planning is inline and execution is deferred. The caller gets the decomposition immediately
and can render the graph while the work happens, rather than staring at a spinner with no
idea what was going to be done.

## The planner

One LLM call, schema-constrained, producing a `PlanDraft`.

### Why a draft and not the real contract

`Plan` validates its own DAG: duplicate ids, dependencies on tasks that do not exist,
self-edges and cycles are all rejected at construction. That is correct for the execution
contract — a cyclic plan would deadlock the graph — but wrong to demand of a model's first
attempt. Asking for `Plan` directly turns every routine formatting slip into a failed run.

So the model is asked for `PlanDraft`, which validates almost nothing, and `repair()` turns
it into a valid `Plan`.

### What repair fixes

| Problem | Fix |
| --- | --- |
| Malformed or duplicated task ids | Regenerate, remapping every dependency that referenced the old value |
| Dependencies on tasks that do not exist | Drop the edge |
| `parallel_group` contradicting the edges | Recompute as longest-path depth; the edges are the real contract |
| No synthesis task | Add one depending on everything else |
| Synthesis wired to only some tasks | Rewire to all of them |
| More than one synthesis task | Keep the last; fold the others into research |
| More than 8 tasks | Truncate, reserving a slot so adding synthesis cannot overflow |

### Required fields are not decoration

This one cost a full debugging cycle and is worth stating plainly.

A field carrying a default reads as **optional** to a schema-constrained decoder, and models
skip optional fields. The first version of `TaskDraft` had `goal: str = ""`. `llama3:8b`
returned a structurally perfect plan — correct types, sensible dependencies, sane groups —
with no `goal` on any task, because the schema said it did not have to. Every task was
discarded as empty and the run failed with "no usable tasks".

The same bug then appeared in the workers: `ResearchOutput.summary` had a default, so a
researcher that had genuinely fetched three pages got back `{}` and reported success with
nothing in it, leaving the synthesizer with no material.

The rule that came out of it: **any field carrying content is required in the schema.**
Fields that `repair()` can reconstruct — ids, dependencies, groups — stay optional.

### Cost ceiling

A plan estimated above $0.80 is sent back once for a cheaper decomposition. If the second
attempt is still expensive it is accepted, because `BudgetTracker` enforces the real ceiling
during execution and a planning loop would burn tokens arguing with the model.

## The graph

One LangGraph node per task, edges from `depends_on`. LangGraph fans out the nodes in a
superstep, so the parallel groups become real concurrency with no scheduling code.

### The state reducer matters

`RunState.results` carries a merging reducer:

```python
results: Annotated[dict[str, WorkerResult], merge_results]
```

Without it, two nodes finishing in the same superstep each write a whole `results` dict and
one silently overwrites the other. The symptom would be a run that quietly loses a worker's
output, which is far worse than a crash.

### Resume is not a re-run

`resume_run` invokes the graph with `None` as input. That is what makes LangGraph continue an
interrupted thread from its last checkpoint. Passing a fresh initial state starts a new
execution and pays for finished work twice — a subtle and expensive mistake, so the resume
path is a separate function with the reason in its docstring.

Checkpoints go to the existing Postgres via `AsyncPostgresSaver`, after stripping the
Prisma-style `?schema=` parameter that psycopg does not understand.

## Workers

Workers are leaves. A worker calls tools; it never spawns another worker. Only the manager
creates work — that is what bounds the agent count and keeps the graph acyclic.

`BaseWorker.execute` wraps every worker with the timeout, event emission, budget accounting
and error containment each one needs, so no subclass has to remember them. A worker that
raises returns a failed `WorkerResult` rather than propagating: one dead tool must not end a
run.

| Worker | Notable decision |
| --- | --- |
| researcher | A citation the worker never fetched is dropped. A URL the model produced from memory cannot support a claim. |
| web_scraper | The browser is used only when static extraction reports a client-rendered page — launching Chromium costs seconds a worker timeout cannot spare. Extraction fields are strings, because a model asked for a typed value it cannot find will invent one. |
| video_analyst | Timestamps outside the video's duration are discarded. Each key moment links back to that second of the video. |
| coder | `verified` is true only when the sandbox exited zero. The model's opinion of its own code does not set that flag. |
| synthesizer | Runs even when upstream workers failed, so a dead video tool still returns the research. Confidence is derived from how much of the plan succeeded, not asked of the model. |

## The budget model

Caps are enforced in code. A model asked to stay under a limit is not a limit.

One `BudgetTracker` per run, shared by every worker, so the caps are per run rather than per
worker — eight workers each honouring a $1 ceiling would spend $8.

Spend is registered **before** the cap is checked. A call that pushes a run over the limit
still cost money, and pretending otherwise would make the accounting drift below reality.

When a cap trips mid-run, nothing raises out of the graph:

1. `budget_exceeded` is published.
2. Remaining nodes short-circuit, returning a skipped result without spending.
3. The synthesizer still runs on whatever partial results exist.
4. The run reports `partial` with the cap that stopped it.

`BudgetExceeded` carries `cap`, so the run reports *which* limit was hit rather than a
generic failure.

## Safety guards

Three checks before any outbound request, ordered by cost.

**URL denylist** — rejects private, loopback, link-local, reserved and multicast addresses,
plus cloud instance-metadata endpoints (`169.254.169.254`, `100.100.100.200`). Schemes other
than http and https are refused, so `file://` and `chrome://` cannot be reached. DNS is
resolved and the resolved addresses are checked too, so a public hostname pointing at an
internal address is caught. This raises rather than returning a boolean, so no caller can
accidentally ignore it.

**robots.txt** — fetched once per host and cached in Redis for an hour. A host whose
robots.txt cannot be fetched is treated as permitting the request: absence of a policy is
not a prohibition. Both our user-agent token and the wildcard are checked.

**Rate limit** — one request per second per domain, held in Redis as a `SET NX PX` lock so
the limit applies across every worker and across replicas, not per worker. It falls back to
an in-process clock when Redis is unavailable.

Beyond those: pages returning 401 or 403 are not scraped. Age-restricted and private videos
report why rather than being worked around. Code execution goes over HTTP to the existing
sandbox — this service never calls `subprocess`, `eval` or `exec`.

## Provider matrix

| Provider | Structured output | Cost | Notes |
| --- | --- | --- | --- |
| Ollama | Native JSON mode, fed the Pydantic JSON schema as `format` | Free | Constrains decoding rather than asking politely |
| Anthropic | Instructor | $3/$15 per Mtok (Sonnet) | |
| OpenAI | Instructor | $2.50/$10 per Mtok (4o) | |
| Gemini | Instructor | $0.10/$0.40 per Mtok (2.0 Flash) | Reads `GOOGLE_API_KEY` |

### No fallback between providers

If a run starts on Ollama and Ollama is down, the router raises `ProviderUnavailable`. It
does not reach for a paid API. Silently switching a free local run onto a billed provider
spends the user's money without consent, which is worse than failing the run.

Retries are three attempts with exponential backoff and jitter, on transient failures only.
A 4xx other than 429 is a client mistake that a retry merely repeats.

Unlisted cloud models are priced at a non-zero default, so an unpriced model cannot become a
way to spend without the tracker noticing.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| Ollama not running | Run fails immediately with the host in the message. No paid fallback. |
| Model not pulled | Error names the model and says to pull it |
| Local model too slow for the worker timeout | Worker returns a timeout result; other workers continue; run reports `partial` |
| One website unreachable | That source is skipped; the search snippet is used instead |
| Page requires login | Not scraped; reported as requiring authentication |
| Video has no transcript | Video task fails; research still returns |
| Sandbox down | Code task fails; other tasks and synthesis continue |
| Retrieval service down | Reported; web search still supplies material |
| Redis down | Rate limit and robots cache become per-process; runs continue |
| Postgres down | In-memory checkpointing; runs execute but cannot be resumed |
| Budget cap hit | Remaining nodes skipped; synthesis over partial results; status `partial` |
| Every upstream task failed | Synthesis reports it has nothing to work with; status `error` |
| Process killed mid-run | `POST /runs/{id}/resume` continues from the last checkpoint |
