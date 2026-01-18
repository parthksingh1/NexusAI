import type { FastifyInstance } from "fastify";
import { costByDay, costByModel } from "../observability/llm-logger.js";

export async function metricsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { agentId?: string; days?: string } }>("/metrics/cost-by-day", async (req) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
    return { series: await costByDay(req.query.agentId, days) };
  });

  app.get<{ Querystring: { days?: string } }>("/metrics/cost-by-model", async (req) => {
    const days = Math.min(30, Math.max(1, Number(req.query.days ?? 7)));
    return { models: await costByModel(days) };
  });
}
