import type { FastifyInstance } from "fastify";
import { toolRegistry } from "../agent/tool-registry.js";

export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tools", async () => ({ tools: toolRegistry.list() }));
}
