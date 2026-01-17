import { createClient } from "@clickhouse/client";
import pino from "pino";
import type { CompletionResult } from "@nexusai/llm-router";

const log = pino({ name: "llm-logger" });

const ch = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  database: "nexusai",
});

/**
 * Logs every LLM call to ClickHouse for cost/latency dashboards + A/B analysis.
 * Best-effort: failures are swallowed so a ClickHouse outage never blocks a run.
 */
export async function logLlmCall(args: {
  requestId: string;
  agentId?: string;
  userId?: string;
  taskType: string;
  result: CompletionResult;
  cacheHit?: boolean;
  success?: boolean;
  errorCode?: string;
}): Promise<void> {
  try {
    await ch.insert({
      table: "llm_calls",
      format: "JSONEachRow",
      values: [
        {
          ts: new Date().toISOString().replace("T", " ").slice(0, 23),
          request_id: args.requestId,
          agent_id: args.agentId ?? "",
          user_id: args.userId ?? "",
          provider: args.result.provider,
          model: args.result.model,
          task_type: args.taskType,
          prompt_tokens: args.result.usage.promptTokens,
          completion_tokens: args.result.usage.completionTokens,
          total_tokens: args.result.usage.totalTokens,
          latency_ms: args.result.latencyMs,
          cost_usd: args.result.costUsd,
          cache_hit: args.cacheHit ? 1 : 0,
          success: args.success !== false ? 1 : 0,
          error_code: args.errorCode ?? "",
        },
      ],
    });
  } catch (err) {
    log.warn({ err }, "ch insert failed");
  }
}

export async function costByDay(agentId?: string, days = 30): Promise<Array<{ day: string; cost: number; tokens: number; calls: number }>> {
  const where = agentId ? `WHERE agent_id = '${agentId.replace(/'/g, "''")}'` : "";
  const rs = await ch.query({
    query: `
      SELECT toDate(ts) AS day,
             sum(cost_usd) AS cost,
             sum(total_tokens) AS tokens,
             count() AS calls
      FROM llm_calls
      ${where} ${where ? "AND" : "WHERE"} ts > now() - INTERVAL ${days} DAY
      GROUP BY day ORDER BY day
    `,
    format: "JSONEachRow",
  });
  return (await rs.json()) as Array<{ day: string; cost: number; tokens: number; calls: number }>;
}

export async function costByModel(days = 7): Promise<Array<{ model: string; cost: number; calls: number; p95_ms: number }>> {
  const rs = await ch.query({
    query: `
      SELECT model,
             sum(cost_usd) AS cost,
             count() AS calls,
             quantile(0.95)(latency_ms) AS p95_ms
      FROM llm_calls
      WHERE ts > now() - INTERVAL ${days} DAY
      GROUP BY model ORDER BY cost DESC
    `,
    format: "JSONEachRow",
  });
  return (await rs.json()) as Array<{ model: string; cost: number; calls: number; p95_ms: number }>;
}
