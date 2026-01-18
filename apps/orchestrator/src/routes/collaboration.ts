import type { FastifyInstance } from "fastify";
import type { LlmRouter } from "@nexusai/llm-router";
import { z } from "zod";
import { runCollaboration } from "../agent/collaboration.js";
import { authenticateRequest } from "./auth.js";

const CollabSchema = z.object({
  goal: z.string().min(1).max(2000),
  input: z.string().min(1).max(8000),
  maxIterations: z.number().int().positive().max(10).default(5),
});

export async function collaborationRoutes(app: FastifyInstance, opts: { router: LlmRouter }): Promise<void> {
  app.post("/collaborate", async (req) => {
    const user = await authenticateRequest(req);
    const body = CollabSchema.parse(req.body);
    const result = await runCollaboration(opts.router, {
      goal: body.goal,
      input: body.input,
      maxIterations: body.maxIterations,
      ownerId: user.id,
    });
    return result;
  });
}
