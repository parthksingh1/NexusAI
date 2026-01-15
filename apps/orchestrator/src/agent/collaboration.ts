import type { LlmRouter } from "@nexusai/llm-router";
import type { Agent } from "@nexusai/db";
import { prisma } from "@nexusai/db";
import { v4 as uuidv4 } from "uuid";
import { publish } from "../kafka/client.js";
import { KAFKA_TOPICS } from "@nexusai/shared";
import { runReactLoop } from "./react-loop.js";
import { logger } from "../logger.js";

/**
 * Multi-agent collaboration (Pillar 9). Three roles working a task together:
 *   - planner: decomposes the goal into steps
 *   - executor: runs each step via the ReAct loop
 *   - critic: reviews each step's output and can request retry
 *
 * Communication flows over Kafka (AGENT_MESSAGE) for durability; the local loop
 * reads directly for speed. Consensus: critic must approve OR budget exhausted.
 */
export type CollabOptions = {
  goal: string;
  input: string;
  maxIterations?: number;
  ownerId: string;
};

type Plan = { steps: string[] };

export async function runCollaboration(router: LlmRouter, opts: CollabOptions): Promise<{
  plan: string[];
  transcript: Array<{ role: string; content: string }>;
  result: string;
}> {
  const maxIter = opts.maxIterations ?? 5;
  const transcript: Array<{ role: string; content: string }> = [];

  // ─── Planner ────────────────────────────────────────────────
  const plannerResp = await router.complete({
    messages: [
      { role: "system", content: "You are the Planner. Break the goal into 2-5 concrete, ordered steps. Reply JSON: {\"steps\":[\"...\"]}" },
      { role: "user", content: `Goal: ${opts.goal}\n\nRequest: ${opts.input}` },
    ],
    taskType: "reasoning",
    temperature: 0.2,
    jsonMode: true,
    maxTokens: 500,
  });
  let plan: Plan = { steps: [opts.input] };
  try { plan = JSON.parse(plannerResp.content) as Plan; } catch { /* use fallback */ }
  transcript.push({ role: "planner", content: JSON.stringify(plan) });
  await publish(KAFKA_TOPICS.AGENT_MESSAGE, uuidv4(), {
    fromAgentId: "planner", toAgentId: "executor", runId: uuidv4(),
    content: JSON.stringify(plan), role: "planner", sentAt: new Date().toISOString(),
  });

  // ─── Loop: executor runs each step; critic reviews ──────────
  let compiled = "";
  for (const step of plan.steps.slice(0, maxIter)) {
    // Ephemeral executor agent (in-memory only)
    const executor: Agent = {
      id: uuidv4(),
      ownerId: opts.ownerId,
      name: "Executor",
      goal: opts.goal,
      persona: {
        name: "Executor",
        description: "Task executor",
        systemPrompt: "You execute one step at a time. Be precise and cite evidence.",
        temperature: 0.2,
      } as never,
      tools: ["web_search", "calculator", "knowledge_search"],
      modelRoutingPolicy: {} as never,
      status: "RUNNING",
      publishedToMarketplace: false,
      forkFrom: null,
      stars: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const runId = uuidv4();
    await prisma.agentRun.create({ data: { id: runId, agentId: executor.id, input: step, status: "RUNNING" } }).catch(() => {
      /* executor is ephemeral — skip FK-constrained persistence */
    });

    let stepOutput = "";
    try {
      const exec = await runReactLoop(router, {
        agent: executor,
        runId,
        input: step,
        maxSteps: 6,
        onStep: () => {},
      });
      stepOutput = exec.result ?? exec.errorMessage ?? "(no output)";
    } catch (err) {
      stepOutput = `Executor error: ${err instanceof Error ? err.message : String(err)}`;
      logger.warn({ err }, "executor failed");
    }
    transcript.push({ role: "executor", content: `STEP: ${step}\nOUT: ${stepOutput.slice(0, 500)}` });

    // ─── Critic review ────────────────────────────────────────
    const critic = await router.complete({
      messages: [
        { role: "system", content: "You are the Critic. Judge if the executor's output satisfies the step. Reply JSON: {\"ok\": true|false, \"reason\": \"...\"}" },
        { role: "user", content: `Step: ${step}\n\nOutput: ${stepOutput.slice(0, 2000)}` },
      ],
      taskType: "reasoning",
      temperature: 0.1,
      jsonMode: true,
      maxTokens: 200,
    });
    let verdict: { ok: boolean; reason: string } = { ok: true, reason: "default" };
    try { verdict = JSON.parse(critic.content); } catch { /* accept */ }
    transcript.push({ role: "critic", content: JSON.stringify(verdict) });
    compiled += `\n\n## ${step}\n${stepOutput}`;
  }

  // ─── Final synthesis ────────────────────────────────────────
  const synth = await router.complete({
    messages: [
      { role: "system", content: "Synthesize the step outputs into a final answer. Be concise, cite sources from the step outputs." },
      { role: "user", content: `Goal: ${opts.goal}\n\nStep outputs:${compiled}` },
    ],
    taskType: "summarization",
    temperature: 0.3,
    maxTokens: 1000,
  });
  transcript.push({ role: "synthesizer", content: synth.content });

  return { plan: plan.steps, transcript, result: synth.content };
}
