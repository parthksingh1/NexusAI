import type { FastifyInstance } from "fastify";
import { prisma } from "@nexusai/db";
import { z } from "zod";
import { stripe, createCheckout, TIERS } from "../billing/stripe.js";
import { authenticateRequest } from "./auth.js";
import { logger } from "../logger.js";

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/billing/tiers", async () => ({ tiers: Object.values(TIERS) }));

  app.post<{ Body: { tier: "PRO" | "TEAM" | "ENTERPRISE"; successUrl: string; cancelUrl: string } }>(
    "/billing/checkout",
    async (req) => {
      const user = await authenticateRequest(req);
      const body = z.object({
        tier: z.enum(["PRO", "TEAM", "ENTERPRISE"]),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      }).parse(req.body);
      const url = await createCheckout(user.id, body.tier, body.successUrl, body.cancelUrl);
      return { url };
    },
  );

  /** Stripe webhook. Body is raw; signature verified against STRIPE_WEBHOOK_SECRET. */
  app.post("/billing/webhook", { config: { rawBody: true } }, async (req, reply) => {
    if (!stripe) return reply.code(503).send({ error: "stripe not configured" });
    const sig = req.headers["stripe-signature"] as string;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return reply.code(500).send({ error: "webhook secret missing" });

    let event;
    try {
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch (err) {
      logger.warn({ err }, "stripe webhook verify failed");
      return reply.code(400).send({ error: "invalid signature" });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as { customer: string; metadata?: { userId?: string } };
        const userId = session.metadata?.userId;
        if (userId) {
          await prisma.user.update({ where: { id: userId }, data: { tier: "PRO" } });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as { customer: string };
        await prisma.user.updateMany({ where: { stripeCustomerId: sub.customer }, data: { tier: "FREE" } });
        break;
      }
    }
    return { received: true };
  });
}
