import type { FastifyInstance } from "fastify";
import { redisSub } from "../redis.js";
import { logger } from "../logger.js";

/**
 * WebSocket endpoint for live run events. Clients connect to /ws/runs/:runId.
 * Backed by Redis pub/sub — the ReAct loop publishes each step to `run:<id>` and
 * every WS consumer for that run receives it.
 */
export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { runId: string } }>("/ws/runs/:runId", { websocket: true }, (socket, req) => {
    const runId = req.params.runId;
    const channel = `run:${runId}`;

    const handler = (ch: string, msg: string) => {
      if (ch !== channel) return;
      if (socket.readyState === socket.OPEN) socket.send(msg);
    };

    redisSub.subscribe(channel).catch((err) => logger.warn({ err, runId }, "ws subscribe failed"));
    redisSub.on("message", handler);

    socket.send(JSON.stringify({ type: "connected", runId }));

    socket.on("close", () => {
      redisSub.off("message", handler);
      redisSub.unsubscribe(channel).catch(() => {});
    });
  });
}
