import { prisma } from "@nexusai/db";
import type { Agent, AgentStep } from "@nexusai/db";
import type {
  AgentPersona,
  AgentStepEvent,
  ModelRoutingPolicy,
  LlmTaskType,
} from "@nexusai/shared";
import { KAFKA_TOPICS } from "@nexusai/shared";
import type { ChatMessage, LlmRouter } from "@nexusai/llm-router";
import { v4 as uuidv4 } from "uuid";
import { toolRegistry } from "./tool-registry.js";
import { publish } from "../kafka/client.js";
import { redis } from "../redis.js";
import { logger } from "../logger.js";
import { metrics } from "../metrics.js";
import { memory } from "./memory.js";
import { assessRisk, awaitApproval } from "../safety/risk.js";
import { logLlmCall } from "../observability/llm-logger.js";
import { v4 as uuidv4Req } from "uuid";

const SYSTEM_PROMPT_TEMPLATE = (persona: AgentPersona, goal: string, recalled: string) => `You are ${persona.name}.

${persona.systemPrompt}

## Operating goal
${goal}

## ReAct protocol
You follow strict Reason → Act → Observe cycles:
  - Think step-by-step in plain prose before calling any tool.
  - Call tools via the provided tool-calling interface (never output bare JSON).
  - After a tool returns, reflect on whether the goal is satisfied.
  - When confident, produce a FINAL answer grounded in what the tools returned.

## Constraints
  - Be concise and factual. Cite sources when tools return URLs.
  - Prefer knowledge_search for internal docs; web_search for current events.
  - Never fabricate tool outputs — only reference what tools actually returned.

${recalled ? `## Relevant prior context\n${recalled}\n` : ""}`;

export type ReactRunParams = {
  agent: Agent;
  runId: string;
  input: string;
  maxSteps: number;
  onStep?: (event: AgentStepEvent) => void;
};

export type ReactRunResult = {
  status: "succeeded" | "failed";
  result?: string;
  errorMessage?: string;
  totalTokens: number;
  totalCostUsd: number;
};

/**
 * Core ReAct loop. Drives the agent through Reason → Act → Observe cycles until:
 *   - model emits a final answer without tool calls
 *   - maxSteps is exhausted
 *   - an unrecoverable error occurs
 *
 * Emits events at every step: persisted to Postgres, streamed over Kafka, and pushed to Redis pub/sub
 * for WebSocket consumers.
 */
export async function runReactLoop(router: LlmRouter, params: ReactRunParams): Promise<ReactRunResult> {
  const { agent, runId, input, maxSteps, onStep } = params;
  metrics.activeRuns.inc();
  metrics.agentRunsStarted.inc({ agent_id: agent.id });

  const persona = agent.persona as AgentPersona;
  const routingPolicy = (agent.modelRoutingPolicy ?? {}) as ModelRoutingPolicy;
  const taskType: LlmTaskType = inferTaskType(input);

  const recalled = (await memory.recall(agent.id, 6)).map((m) => `- [${m.type}] ${m.content}`).join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT_TEMPLATE(persona, agent.goal, recalled) },
    { role: "user", content: input },
  ];

  const tools = toolRegistry.list(agent.tools.length ? agent.tools : undefined);
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
    const stepTimer = metrics.agentStepDuration.startTimer({ kind: "thought" });

    let result;
    try {
      result = await router.complete({
        messages,
        tools,
        taskType,
        policy: routingPolicy,
        temperature: persona.temperature,
        maxTokens: persona.maxTokens,
        agentId: agent.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, runId }, "LLM call failed");
      await finalizeRun(agent.id, runId, "FAILED", undefined, msg, totalTokens, totalCostUsd);
      metrics.activeRuns.dec();
      metrics.agentRunsFinished.inc({ status: "failed" });
      return { status: "failed", errorMessage: msg, totalTokens, totalCostUsd };
    }

    totalTokens += result.usage.totalTokens;
    totalCostUsd += result.costUsd;
    metrics.llmCallsCost.inc({ provider: result.provider, model: result.model }, result.costUsd);

    // ─── Persist + broadcast thought ──────────────────────────
    if (result.content.trim()) {
      await persistStep({
        runId,
        agentId: agent.id,
        step: stepNum,
        kind: "THOUGHT",
        content: result.content,
        model: result.model,
        tokensIn: result.usage.promptTokens,
        tokensOut: result.usage.completionTokens,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        onStep,
      });
    }
    stepTimer();

    // ─── Tool calls? Act. Otherwise: final answer. ────────────
    if (result.toolCalls.length === 0) {
      await persistStep({
        runId,
        agentId: agent.id,
        step: stepNum + 0.5 as unknown as number,
        kind: "FINAL",
        content: result.content,
        onStep,
      });
      await memory.recordEpisodic(agent.id, `Q: ${input}\nA: ${result.content.slice(0, 500)}`, 0.6);
      await finalizeRun(agent.id, runId, "SUCCEEDED", result.content, undefined, totalTokens, totalCostUsd);
      metrics.activeRuns.dec();
      metrics.agentRunsFinished.inc({ status: "succeeded" });
      return { status: "succeeded", result: result.content, totalTokens, totalCostUsd };
    }

    // Append the assistant turn with tool calls
    messages.push({
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls,
    });

    // Log LLM call to ClickHouse (fire-and-forget)
    void logLlmCall({
      requestId: uuidv4Req(),
      agentId: agent.id,
      taskType,
      result,
      success: true,
    });

    // ─── Execute each tool call in parallel ───────────────────
    const actionTimer = metrics.agentStepDuration.startTimer({ kind: "action" });
    const toolResults = await Promise.all(
      result.toolCalls.map(async (tc) => {
        const start = Date.now();
        let output: unknown;
        let success = true;

        // Safety gate
        const def = toolRegistry.get(tc.name)?.definition;
        if (def) {
          const risk = assessRisk(def, tc.arguments);
          if (risk.blocked) {
            output = { error: "blocked by safety policy", reasons: risk.reasons };
            metrics.toolInvocations.inc({ tool: tc.name, success: "false" });
            return { tc, output };
          }
          if (def.requiresApproval || risk.level === "dangerous") {
            const approved = await awaitApproval(runId, tc.name, tc.arguments, risk);
            if (!approved) {
              output = { error: "awaiting human approval — rejected or timed out" };
              metrics.toolInvocations.inc({ tool: tc.name, success: "false" });
              return { tc, output };
            }
          }
        }

        try {
          output = await toolRegistry.invoke(tc.name, tc.arguments, {
            agentId: agent.id,
            runId,
            ownerId: agent.ownerId,
          });
          metrics.toolInvocations.inc({ tool: tc.name, success: "true" });
        } catch (err) {
          success = false;
          output = { error: err instanceof Error ? err.message : String(err) };
          metrics.toolInvocations.inc({ tool: tc.name, success: "false" });
        }
        const durationMs = Date.now() - start;

        await publish(KAFKA_TOPICS.TOOL_INVOKED, runId, {
          runId,
          agentId: agent.id,
          tool: tc.name,
          input: tc.arguments,
          output,
          success,
          durationMs,
          riskLevel: toolRegistry.get(tc.name)?.definition.risk ?? "safe",
        });

        return { tc, output };
      }),
    );
    actionTimer();

    // ─── Persist + broadcast observations, feed back to model ─
    for (const { tc, output } of toolResults) {
      const obsContent = typeof output === "string" ? output : JSON.stringify(output);
      await persistStep({
        runId,
        agentId: agent.id,
        step: stepNum,
        kind: "OBSERVATION",
        content: obsContent.slice(0, 8000),
        tool: tc.name,
        toolInput: tc.arguments,
        toolOutput: output as object,
        onStep,
      });
      messages.push({
        role: "tool",
        content: obsContent,
        toolCallId: tc.id,
        name: tc.name,
      });
    }
  }

  // Out of steps
  await finalizeRun(agent.id, runId, "FAILED", undefined, "Max steps exceeded", totalTokens, totalCostUsd);
  metrics.activeRuns.dec();
  metrics.agentRunsFinished.inc({ status: "failed" });
  return { status: "failed", errorMessage: "Max steps exceeded", totalTokens, totalCostUsd };
}

// ─── Helpers ────────────────────────────────────────────────────
async function persistStep(args: {
  runId: string;
  agentId: string;
  step: number;
  kind: "THOUGHT" | "ACTION" | "OBSERVATION" | "FINAL";
  content: string;
  tool?: string;
  toolInput?: object;
  toolOutput?: object;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  onStep?: (event: AgentStepEvent) => void;
}): Promise<AgentStep> {
  const stepInt = Math.floor(args.step * 10);
  const row = await prisma.agentStep.create({
    data: {
      id: uuidv4(),
      runId: args.runId,
      step: stepInt,
      kind: args.kind,
      content: args.content,
      tool: args.tool,
      toolInput: (args.toolInput ?? undefined) as any,
      toolOutput: (args.toolOutput ?? undefined) as any,
      latencyMs: args.latencyMs,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      costUsd: args.costUsd as any,
      model: args.model,
    },
  });

  const evt: AgentStepEvent = {
    runId: args.runId,
    agentId: args.agentId,
    step: stepInt,
    kind: args.kind.toLowerCase() as AgentStepEvent["kind"],
    content: args.content,
    tool: args.tool,
    toolInput: args.toolInput,
    toolOutput: args.toolOutput,
    latencyMs: args.latencyMs,
    model: args.model,
  };

  // Best-effort broadcast — failures shouldn't abort the run
  await Promise.allSettled([
    publish(KAFKA_TOPICS.AGENT_STEP, args.runId, evt),
    redis.publish(`run:${args.runId}`, JSON.stringify(evt)),
  ]);

  args.onStep?.(evt);
  return row;
}

async function finalizeRun(
  agentId: string,
  runId: string,
  status: "SUCCEEDED" | "FAILED" | "CANCELLED",
  result: string | undefined,
  errorMessage: string | undefined,
  totalTokens: number,
  totalCostUsd: number,
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      result,
      errorMessage,
      totalTokens,
      totalCostUsd: totalCostUsd as any,
    },
  });
  await prisma.agent.update({ where: { id: agentId }, data: { status: "IDLE" } });
  await publish(KAFKA_TOPICS.AGENT_RUN_FINISHED, runId, {
    runId,
    agentId,
    status: status.toLowerCase() as "succeeded" | "failed" | "cancelled",
    result,
    errorMessage,
    totalTokens,
    totalCostUsd,
    finishedAt: new Date().toISOString(),
  });
  await redis.publish(`run:${runId}`, JSON.stringify({ type: "finished", status, result, errorMessage }));
}

/**
 * Very light heuristic task classifier. Phase 6 will replace this with a classifier call
 * or a learned routing policy.
 */
function inferTaskType(input: string): LlmTaskType {
  const lower = input.toLowerCase();
  if (/\b(code|function|class|bug|typescript|python|sql)\b/.test(lower)) return "coding";
  if (/\b(summariz|tl;dr|recap|brief)\b/.test(lower)) return "summarization";
  if (/\b(extract|parse|structure|json)\b/.test(lower)) return "extraction";
  if (/\b(classif|categor|label)\b/.test(lower)) return "classification";
  if (/\b(plan|strategy|why|reason|analyze|decide|trade-?off)\b/.test(lower)) return "reasoning";
  return "chat";
}
