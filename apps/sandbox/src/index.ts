import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import pino from "pino";
import { z } from "zod";
import { SandboxExecutor, type Language } from "./executor.js";

const log = pino({ name: "sandbox", level: process.env.LOG_LEVEL ?? "info" });
const executor = new SandboxExecutor();

const ExecSchema = z.object({
  language: z.enum(["python", "node", "bash"]),
  code: z.string().min(1).max(100_000),
  stdin: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
  memoryMb: z.number().int().positive().max(1024).optional(),
});

async function main() {
  const app = Fastify({ loggerInstance: log });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({ status: "ok" }));

  /** One-shot exec with JSON response (buffered). */
  app.post("/exec", async (req, reply) => {
    const body = ExecSchema.parse(req.body);
    let stdout = "";
    let stderr = "";
    let exit: { code: number; timedOut: boolean; durationMs: number } | null = null;
    for await (const e of executor.run(body as { language: Language; code: string })) {
      if (e.type === "stdout") stdout += e.data;
      else if (e.type === "stderr") stderr += e.data;
      else exit = { code: e.code, timedOut: e.timedOut, durationMs: e.durationMs };
    }
    return reply.send({ stdout, stderr, exit });
  });

  /** Streaming exec over WS. Client sends {language, code, stdin?} as first frame. */
  app.get("/ws/exec", { websocket: true }, (socket) => {
    socket.once("message", async (msg) => {
      let parsed;
      try {
        parsed = ExecSchema.parse(JSON.parse(msg.toString()));
      } catch (e) {
        socket.send(JSON.stringify({ type: "error", message: (e as Error).message }));
        socket.close();
        return;
      }
      try {
        for await (const e of executor.run(parsed)) {
          if (socket.readyState !== socket.OPEN) break;
          socket.send(JSON.stringify(e));
        }
      } catch (e) {
        socket.send(JSON.stringify({ type: "error", message: (e as Error).message }));
      } finally {
        socket.close();
      }
    });
  });

  const port = Number(process.env.SANDBOX_PORT ?? 4100);
  await app.listen({ port, host: "0.0.0.0" });
  log.info({ port }, "sandbox runner up");
}

main().catch((err) => {
  log.fatal({ err }, "sandbox startup failed");
  process.exit(1);
});
