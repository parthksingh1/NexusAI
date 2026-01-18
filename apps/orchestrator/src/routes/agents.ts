import type { FastifyInstance } from "fastify";
import { prisma } from "@nexusai/db";
import { CreateAgentSchema, UpdateAgentSchema, StartRunSchema, NotFoundError } from "@nexusai/shared";
import type { RunManager } from "../agent/run-manager.js";

export async function agentsRoutes(app: FastifyInstance, opts: { runManager: RunManager }): Promise<void> {
  const { runManager } = opts;

  // ─── List agents ────────────────────────────────────────────
  app.get("/agents", async (req) => {
    const ownerId = getOwnerId(req);
    const agents = await prisma.agent.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
    });
    return { agents };
  });

  // ─── Get agent ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/agents/:id", async (req) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: { runs: { orderBy: { startedAt: "desc" }, take: 10 } },
    });
    if (!agent) throw new NotFoundError("Agent", req.params.id);
    return agent;
  });

  // ─── Create agent ───────────────────────────────────────────
  app.post("/agents", async (req) => {
    const body = CreateAgentSchema.parse(req.body);
    const ownerId = getOwnerId(req);
    const agent = await prisma.agent.create({
      data: {
        ownerId,
        name: body.name,
        goal: body.goal,
        persona: body.persona as any,
        tools: body.tools,
        modelRoutingPolicy: body.modelRoutingPolicy as any,
      },
    });
    return agent;
  });

  // ─── Update agent ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>("/agents/:id", async (req) => {
    const body = UpdateAgentSchema.parse(req.body);
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.goal !== undefined && { goal: body.goal }),
        ...(body.persona !== undefined && { persona: body.persona as any }),
        ...(body.tools !== undefined && { tools: body.tools }),
        ...(body.modelRoutingPolicy !== undefined && { modelRoutingPolicy: body.modelRoutingPolicy as any }),
      },
    });
    return agent;
  });

  // ─── Delete agent ───────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/agents/:id", async (req, reply) => {
    await prisma.agent.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  // ─── Start a run ────────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/agents/:id/runs", async (req) => {
    const body = StartRunSchema.parse(req.body);
    const { runId } = await runManager.start({
      agentId: req.params.id,
      input: body.input,
      maxSteps: body.maxSteps,
    });
    return { runId };
  });

  // ─── Run detail ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/runs/:id", async (req) => {
    const run = await prisma.agentRun.findUnique({
      where: { id: req.params.id },
      include: { steps: { orderBy: { step: "asc" } } },
    });
    if (!run) throw new NotFoundError("Run", req.params.id);
    return run;
  });

  // ─── Cancel a run ───────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/runs/:id/cancel", async (req, reply) => {
    await runManager.cancel(req.params.id);
    return reply.code(204).send();
  });
}

/**
 * Placeholder: Phase 1 dev uses a single demo user; real JWT auth arrives in Phase 5.
 * Reads an X-User-Id header if present, otherwise falls back to the seeded demo user.
 */
function getOwnerId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return "00000000-0000-0000-0000-000000000001";
}
