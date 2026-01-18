import type { FastifyInstance } from "fastify";
import { prisma } from "@nexusai/db";
import { NotFoundError } from "@nexusai/shared";

/** Marketplace: publish / fork / star. Phase 5 will flesh this out. */
export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/marketplace/agents", async (req) => {
    const agents = await prisma.agent.findMany({
      where: { publishedToMarketplace: true },
      orderBy: { stars: "desc" },
      take: 50,
    });
    return { agents };
  });

  app.post<{ Params: { id: string } }>("/marketplace/agents/:id/publish", async (req) => {
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: { publishedToMarketplace: true },
    });
    return agent;
  });

  app.post<{ Params: { id: string } }>("/marketplace/agents/:id/fork", async (req) => {
    const source = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!source) throw new NotFoundError("Agent", req.params.id);
    const ownerId = (req.headers["x-user-id"] as string) ?? "00000000-0000-0000-0000-000000000001";
    const forked = await prisma.agent.create({
      data: {
        ownerId,
        name: `${source.name} (fork)`,
        goal: source.goal,
        persona: source.persona as any,
        tools: source.tools,
        modelRoutingPolicy: source.modelRoutingPolicy as any,
        forkFrom: source.id,
      },
    });
    return forked;
  });
}
