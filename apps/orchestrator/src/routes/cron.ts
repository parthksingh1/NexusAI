import type { FastifyInstance } from "fastify";
import { prisma } from "@nexusai/db";
import { z } from "zod";
import cron from "node-cron";
import type { RunManager } from "../agent/run-manager.js";
import { logger } from "../logger.js";

const scheduled = new Map<string, cron.ScheduledTask>();

const CreateSchema = z.object({
  agentId: z.string().uuid(),
  schedule: z.string().min(9).max(100),   // standard 5-part cron
  input: z.string().min(1).max(8000),
  enabled: z.boolean().default(true),
});

export async function cronRoutes(app: FastifyInstance, opts: { runManager: RunManager }): Promise<void> {
  app.get("/cron", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; agentId: string; schedule: string; input: string; enabled: boolean; createdAt: Date }>>(
      'SELECT id, "agentId", schedule, input, enabled, "createdAt" FROM nexus."CronJob" ORDER BY "createdAt" DESC',
    ).catch(() => []);
    return { jobs: rows };
  });

  app.post("/cron", async (req) => {
    const body = CreateSchema.parse(req.body);
    if (!cron.validate(body.schedule)) return { error: "invalid cron expression" };
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      'INSERT INTO nexus."CronJob" (id, "agentId", schedule, input, enabled, "createdAt") VALUES ($1,$2,$3,$4,$5,now())',
      id, body.agentId, body.schedule, body.input, body.enabled,
    );
    if (body.enabled) scheduleJob(id, body, opts.runManager);
    return { id, ...body };
  });

  app.delete<{ Params: { id: string } }>("/cron/:id", async (req, reply) => {
    scheduled.get(req.params.id)?.stop();
    scheduled.delete(req.params.id);
    await prisma.$executeRawUnsafe('DELETE FROM nexus."CronJob" WHERE id=$1', req.params.id);
    return reply.code(204).send();
  });
}

function scheduleJob(id: string, def: { agentId: string; schedule: string; input: string }, runManager: RunManager): void {
  const task = cron.schedule(def.schedule, async () => {
    try {
      await runManager.start({ agentId: def.agentId, input: def.input, maxSteps: 12 });
    } catch (err) {
      logger.warn({ err, id }, "cron run failed");
    }
  });
  scheduled.set(id, task);
}

/** Load all enabled cron jobs from DB on startup. Tolerant if the table doesn't exist yet. */
export function startCronScheduler(runManager: RunManager): void {
  prisma
    .$queryRawUnsafe<Array<{ id: string; agentId: string; schedule: string; input: string; enabled: boolean }>>(
      'SELECT id, "agentId", schedule, input, enabled FROM nexus."CronJob" WHERE enabled = true',
    )
    .then((rows) => {
      for (const r of rows) scheduleJob(r.id, r, runManager);
      if (rows.length) logger.info({ count: rows.length }, "cron jobs scheduled");
    })
    .catch((err) => logger.warn({ err: err.message }, "cron table missing — run migration"));
}
