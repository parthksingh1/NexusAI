import type { FastifyInstance } from "fastify";
import type { LlmRouter } from "@nexusai/llm-router";
import { prisma } from "@nexusai/db";
import { optimizePrompt } from "../agent/prompt-optimizer.js";
import { NotFoundError } from "@nexusai/shared";

export async function optimizeRoutes(app: FastifyInstance, opts: { router: LlmRouter }): Promise<void> {
  app.post<{ Params: { id: string } }>("/agents/:id/optimize", async (req) => {
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) throw new NotFoundError("Agent", req.params.id);
    const proposal = await optimizePrompt(opts.router, req.params.id);
    if (!proposal) return { message: "not enough reflections to optimize yet" };
    return proposal;
  });

  app.post<{ Params: { id: string }; Body: { proposed: string } }>("/agents/:id/optimize/accept", async (req) => {
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) throw new NotFoundError("Agent", req.params.id);
    const persona = agent.persona as Record<string, unknown>;
    persona.systemPrompt = req.body.proposed;
    await prisma.agent.update({
      where: { id: req.params.id },
      data: { persona: persona as any },
    });
    return { ok: true };
  });
}
