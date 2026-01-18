import type { FastifyInstance } from "fastify";
import { prisma } from "@nexusai/db";
import { redis } from "../redis.js";
import { metrics } from "../metrics.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, "ok" | string> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = "ok";
    } catch (e) {
      checks.postgres = e instanceof Error ? e.message : "fail";
    }
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch (e) {
      checks.redis = e instanceof Error ? e.message : "fail";
    }
    const ok = Object.values(checks).every((v) => v === "ok");
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ready" : "degraded", checks });
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });
}
