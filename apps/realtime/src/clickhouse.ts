import { createClient } from "@clickhouse/client";

export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: "nexusai",
});

export type MarketTick = {
  ts: string;
  symbol: string;
  source: "crypto" | "stocks" | "news" | "weather";
  price: number;
  volume: number;
  sentiment: number;
};

export async function insertTicks(rows: MarketTick[]): Promise<void> {
  if (!rows.length) return;
  await clickhouse.insert({
    table: "market_ticks",
    values: rows,
    format: "JSONEachRow",
  });
}

export type LlmCallRow = {
  ts: string;
  request_id: string;
  agent_id: string;
  user_id: string;
  provider: string;
  model: string;
  task_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_usd: number;
  cache_hit: number;
  success: number;
  error_code: string;
};

export async function insertLlmCalls(rows: LlmCallRow[]): Promise<void> {
  if (!rows.length) return;
  await clickhouse.insert({ table: "llm_calls", values: rows, format: "JSONEachRow" });
}
