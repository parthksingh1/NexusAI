# Running the manager entirely offline

The manager runs against Ollama with no API key, no account and no network egress to a model
provider. This describes what that costs you in latency, and how to configure it so the
trade is workable.

## Setup

```bash
docker compose up -d ollama postgres redis manager
docker compose exec ollama ollama pull qwen2.5:14b   # planner
docker compose exec ollama ollama pull llama3.1:8b   # workers
```

Or against an Ollama already installed on the host:

```bash
ollama pull qwen2.5:14b
ollama pull llama3.1:8b

cd apps/manager
OLLAMA_HOST=http://127.0.0.1:11434 \
OLLAMA_PLANNER_MODEL=qwen2.5:14b \
OLLAMA_DEFAULT_MODEL=llama3.1:8b \
DEFAULT_LLM_PROVIDER=ollama \
python -m uvicorn nexus_manager.main:app --port 4100
```

Web search uses a keyless backend by default, so nothing here needs an account. Setting
`TAVILY_API_KEY` switches search to Tavily; both return the same result shape.

## Which model for which job

The planner and the workers are configured separately because they are doing different work.

**The planner** emits one structured object with a nested task array against a JSON schema.
It has to hold the whole decomposition in one response. This is where a small model fails
first — not by producing invalid JSON, but by producing valid JSON that is missing the parts
you care about. Give the planner the largest model you can afford to wait for.

**The workers** summarise supplied text into a flatter structure. An 8B model handles this
adequately, and workers run concurrently, so their latency is what determines wall time.

| Role | Recommended | Minimum | Variable |
| --- | --- | --- | --- |
| Planner | `qwen2.5:14b` | `llama3.1:8b` | `OLLAMA_PLANNER_MODEL` |
| Workers | `llama3.1:8b` | `llama3.2:3b` | `OLLAMA_DEFAULT_MODEL` |

`qwen2.5:14b` is roughly 9GB and `llama3.1:8b` roughly 4.7GB on disk.

## Expected latency

The dominant factor is whether the model fits in GPU memory. Once it does not, generation
falls back to CPU and slows by an order of magnitude — this is a cliff, not a gradient.

Per LLM call, generating a few hundred tokens:

| Hardware | 8B model | 14B model |
| --- | --- | --- |
| M-series Mac (unified memory, 16GB+) | 5–15s | 15–40s |
| RTX 4090 (24GB) | 2–6s | 4–12s |
| RTX 3060 (12GB) | 6–20s | 25–60s, partially offloaded |
| CPU only | 60–180s | several minutes |

### A measurement from CPU-only hardware

Taken on this repository, Windows, no GPU offload, `llama3:8b`:

- Cold model load: **79s**
- 24 tokens after warm-up: **34s**
- A 337-token structured plan: **121s**
- A researcher task, including three real page fetches: **142–191s**

At that speed a five-task run takes roughly six to eight minutes, and the default
`WORKER_TIMEOUT_S=90` cuts off every worker before it finishes.

### Configuring for slow hardware

Raise the ceilings rather than accepting truncated runs:

```bash
WORKER_TIMEOUT_S=600      # default 90
OLLAMA_TIMEOUT_S=900      # default 600
TOOL_TIMEOUT_S=45         # default 30
```

The service defaults stay at the specified values. These are operator settings for hardware
the defaults do not suit, and they are the honest fix — a run that is cut off at 90 seconds
has still spent the electricity.

If a run is timing out, prefer these in order:

1. Use a smaller worker model (`llama3.2:3b`) and keep the larger planner.
2. Raise `WORKER_TIMEOUT_S`.
3. Ask for narrower goals. Three well-scoped tasks finish; eight thin ones do not.

## What local mode gives up

Local models are meaningfully worse at the two things this system depends on most.

**Filling a schema completely.** A small model returns valid JSON with the optional fields
omitted. `repair()` handles the structural cases, and the schemas mark every content-carrying
field as required, but a weaker model still produces thinner summaries and fewer extracted
claims.

**Following a negative instruction.** "Do not plan a video task unless the goal names a
video" is followed less reliably at 8B than at 14B, so local plans sometimes contain a task
that cannot succeed. It fails cleanly and the rest of the run continues, but it costs a
worker slot from the budget.

Nothing is disabled in local mode. Every tool, every worker and every guard behaves
identically; only the quality of the model's output changes.

## Switching to a hosted model

Per run, without restarting anything:

```bash
curl -X POST localhost:4100/chat -H 'content-type: application/json' \
  -d '{"goal": "...", "provider": "gemini"}'
```

`GET /providers` reports which providers are usable and names the environment variable to set
for the ones that are not. Gemini reads `GOOGLE_API_KEY`, not `GEMINI_API_KEY`.

The router never falls back from Ollama to a paid provider on its own. If you asked for the
free path and it is unavailable, the run fails and says so — it does not quietly start
spending.
