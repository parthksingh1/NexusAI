import { prisma } from "@nexusai/db";
import type { LlmRouter } from "@nexusai/llm-router";
import { KAFKA_TOPICS } from "@nexusai/shared";
import { v4 as uuidv4 } from "uuid";
import { runReactLoop } from "./react-loop.js";
import { reflectOnRun } from "./reflection.js";
import { publish } from "../kafka/client.js";
import { logger } from "../logger.js";

export type StartRunArgs = {
  agentId: string;
  input: string;
  maxSteps: number;
};

/**
 * Enqueues a run. The actual ReAct execution runs async — the HTTP caller gets
 * the runId immediately and subscribes to the WebSocket for live updates.
 */
export class RunManager {
  constructor(private readonly router: LlmRouter) {}

  async start(args: StartRunArgs): Promise<{ runId: string }> {
    const agent = await prisma.agent.findUnique({ where: { id: args.agentId } });
    if (!agent) throw new Error(`Agent not found: ${args.agentId}`);
    if (agent.status === "RUNNING") throw new Error(`Agent ${args.agentId} is already running`);

    const runId = uuidv4();
    await prisma.agentRun.create({
      data: {
        id: runId,
        agentId: args.agentId,
        input: args.input,
        status: "RUNNING",
      },
    });
    await prisma.agent.update({ where: { id: args.agentId }, data: { status: "RUNNING" } });

    await publish(KAFKA_TOPICS.AGENT_RUN_REQUESTED, runId, {
      runId,
      agentId: args.agentId,
      ownerId: agent.ownerId,
      input: args.input,
      maxSteps: args.maxSteps,
      requestedAt: new Date().toISOString(),
    });
    await publish(KAFKA_TOPICS.AGENT_RUN_STARTED, runId, {
      runId,
      agentId: args.agentId,
      startedAt: new Date().toISOString(),
    });

    // Fire-and-forget — the loop itself persists every step and emits final status.
    // After completion, trigger the reflection loop (Pillar 6) in the background.
    void runReactLoop(this.router, {
      agent,
      runId,
      input: args.input,
      maxSteps: args.maxSteps,
    })
      .then(() => reflectOnRun(this.router, runId))
      .catch((err) => {
        logger.error({ err, runId }, "ReAct loop crashed");
      });

    return { runId };
  }

  async cancel(runId: string): Promise<void> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) return;
    if (run.status !== "RUNNING") return;
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    await prisma.agent.update({ where: { id: run.agentId }, data: { status: "IDLE" } });
  }
}
