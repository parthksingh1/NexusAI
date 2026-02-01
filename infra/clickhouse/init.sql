-- NexusAI ClickHouse schemas — LLMOps + time-series analytics

CREATE DATABASE IF NOT EXISTS nexusai;

-- Per-call LLM usage: powers cost/latency/A-B dashboards
CREATE TABLE IF NOT EXISTS nexusai.llm_calls (
    ts              DateTime64(3) DEFAULT now64(),
    request_id      String,
    agent_id        String,
    user_id         String,
    provider        LowCardinality(String),
    model           LowCardinality(String),
    task_type       LowCardinality(String),
    prompt_tokens   UInt32,
    completion_tokens UInt32,
    total_tokens    UInt32,
    latency_ms      UInt32,
    cost_usd        Float64,
    cache_hit       UInt8,
    success         UInt8,
    error_code      String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (agent_id, ts)
TTL ts + INTERVAL 180 DAY;

-- Agent step events (ReAct thought/action/observation)
CREATE TABLE IF NOT EXISTS nexusai.agent_events (
    ts              DateTime64(3) DEFAULT now64(),
    agent_id        String,
    run_id          String,
    step            UInt32,
    event_type      LowCardinality(String),
    tool            String,
    payload         String,
    duration_ms     UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (agent_id, run_id, step);

-- Real-time data-agent ingestion (stocks/crypto/news)
CREATE TABLE IF NOT EXISTS nexusai.market_ticks (
    ts              DateTime64(3),
    symbol          LowCardinality(String),
    source          LowCardinality(String),
    price           Float64,
    volume          Float64,
    sentiment       Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(ts)
ORDER BY (symbol, ts)
TTL ts + INTERVAL 30 DAY;
