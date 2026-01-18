import type { FastifyInstance } from "fastify";
import { prisma } from "@nexusai/db";
import { redis } from "../redis.js";
import { z } from "zod";

const DecideSchema = z.object({ decision: z.enum(["approved", "rejected"]), decidedBy: z.string().optional() });

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/approvals", async () => {
    const pending = await prisma.approvalRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { approvals: pending };
  });

  app.post<{ Params: { id: string } }>("/approvals/:id/decide", async (req) => {
    const body = DecideSchema.parse(req.body);
    const updated = await prisma.approvalRequest.update({
      where: { id: req.params.id },
      data: {
        status: body.decision === "approved" ? "APPROVED" : "REJECTED",
        decidedBy: body.decidedBy ?? "human",
        decidedAt: new Date(),
      },
    });
    await redis.publish(`approvals:${req.params.id}`, body.decision);
    return updated;
  });
}
