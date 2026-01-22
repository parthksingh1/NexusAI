import Redis from "ioredis";
import pino from "pino";

const log = pino({ name: "alerts" });
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

export type Alert = {
  id: string;
  kind: "anomaly" | "threshold" | "sentiment";
  symbol: string;
  message: string;
  severity: "info" | "warn" | "critical";
  value?: number;
  z?: number;
  ts: string;
};

/**
 * Alerts flow to Redis sorted-set (dashboard) + pub/sub (live subscribers).
 * Dedup: same (kind,symbol) within 60s is suppressed.
 */
export async function fireAlert(alert: Alert): Promise<void> {
  const dedupKey = `nexus:alert:dedup:${alert.kind}:${alert.symbol}`;
  const set = await redis.set(dedupKey, "1", "EX", 60, "NX");
  if (!set) return;

  const ts = Date.parse(alert.ts);
  await redis.zadd("nexus:alerts", ts, JSON.stringify(alert));
  await redis.zremrangebyrank("nexus:alerts", 0, -501);
  await redis.publish("nexus:alerts", JSON.stringify(alert));
  log.info({ kind: alert.kind, symbol: alert.symbol, sev: alert.severity }, "alert fired");
}

export async function recentAlerts(limit = 50): Promise<Alert[]> {
  const raw = await redis.zrevrange("nexus:alerts", 0, limit - 1);
  return raw.map((s) => JSON.parse(s) as Alert);
}

export { redis as alertsRedis };
