import { startTelemetry } from "./observability/otel.js";
startTelemetry();
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import sensible from "@fastify/sensible";
import { LlmRouter } from "@nexusai/llm-router";
import { NexusError } from "@nexusai/shared";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { RunManager } from "./agent/run-manager.js";
import { agentsRoutes } from "./routes/agents.js";
import { wsRoutes } from "./routes/ws.js";
import { healthRoutes } from "./routes/health.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { toolsRoutes } from "./routes/tools.js";
import { metricsApiRoutes } from "./routes/metrics-api.js";
import { authRoutes } from "./routes/auth.js";
import { approvalRoutes } from "./routes/approvals.js";
import { collaborationRoutes } from "./routes/collaboration.js";
import { disconnectKafka } from "./kafka/client.js";
import "./agent/tools/index.js"; // register built-in tools

async function main() {
  const router = new LlmRouter({
    anthropicKey: config.ANTHROPIC_API_KEY,
    openaiKey: config.OPENAI_API_KEY,
    googleKey: config.GOOGLE_API_KEY,
  });
  const runManager = new RunManager(router);

  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);
  await app.register(sensible);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NexusError) {
      return reply.code(err.statusCode).send(err.toJSON());
    }
    if (err.validation) {
      return reply.code(400).send({ code: "VALIDATION_ERROR", message: err.message, details: err.validation });
    }
    logger.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });

  await app.register(healthRoutes);
  await app.register(toolsRoutes);
  await app.register(marketplaceRoutes);
  await app.register(metricsApiRoutes);
  await app.register(authRoutes);
  await app.register(approvalRoutes);
  await app.register((f, _, done) => {
    collaborationRoutes(f, { router }).finally(done);
  });
  await app.register((f, _, done) => {
    agentsRoutes(f, { runManager }).finally(done);
  });
  await app.register(wsRoutes);

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT }, "nexusai orchestrator up");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    try {
      await app.close();
      await disconnectKafka();
    } catch (err) {
      logger.error({ err }, "shutdown error");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
