import Fastify from "fastify";
import cors from "@fastify/cors";
import pino from "pino";
import { z } from "zod";

/**
 * Mock API surface for safe agent testing (Pillar 11). Provides deterministic or
 * seeded-random responses for the kinds of endpoints agents commonly hit.
 * Point agents here (via their tools' base URL) in CI to avoid real-world side effects.
 */

const log = pino({ name: "simulation", level: process.env.LOG_LEVEL ?? "info" });

function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

async function main() {
  const app = Fastify({ loggerInstance: log });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" }));

  // ─── Mock email send ────────────────────────────────────────
  app.post("/email/send", async (req) => {
    const body = z.object({ to: z.string().email(), subject: z.string(), body: z.string() }).parse(req.body);
    return { delivered: true, id: `mock_${Date.now()}`, to: body.to };
  });

  // ─── Mock stock quote ───────────────────────────────────────
  app.get<{ Params: { symbol: string } }>("/quote/:symbol", async (req) => {
    const rng = seededRandom(req.params.symbol);
    return { symbol: req.params.symbol, price: 100 + rng() * 50, change: (rng() - 0.5) * 5 };
  });

  // ─── Mock CRM contact ───────────────────────────────────────
  app.get<{ Params: { id: string } }>("/crm/contacts/:id", async (req) => {
    const rng = seededRandom(req.params.id);
    return {
      id: req.params.id,
      name: `Contact ${req.params.id.slice(0, 4)}`,
      email: `contact-${req.params.id.slice(0, 4)}@example.com`,
      ltv: Math.floor(rng() * 10000),
    };
  });

  // ─── Scenario replay ────────────────────────────────────────
  const scenarios = new Map<string, { steps: Array<{ url: string; response: unknown }>; cursor: number }>();

  app.post<{ Body: { id: string; steps: Array<{ url: string; response: unknown }> } }>("/scenarios", async (req) => {
    scenarios.set(req.body.id, { steps: req.body.steps, cursor: 0 });
    return { ok: true, steps: req.body.steps.length };
  });

  app.get<{ Params: { id: string } }>("/scenarios/:id/next", async (req) => {
    const s = scenarios.get(req.params.id);
    if (!s) return { done: true };
    if (s.cursor >= s.steps.length) return { done: true };
    const step = s.steps[s.cursor++];
    return { done: false, ...step };
  });

  const port = Number(process.env.SIMULATION_PORT ?? 4300);
  await app.listen({ port, host: "0.0.0.0" });
  log.info({ port }, "simulation service up");
}

main().catch((err) => {
  log.fatal({ err }, "sim startup failed");
  process.exit(1);
});
