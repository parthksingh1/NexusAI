import type { LlmRouter } from "@nexusai/llm-router";
import { prisma } from "@nexusai/db";
import { logger } from "../logger.js";

/**
 * Self-improving loop (Pillar 6). Periodically samples low-scoring reflections for an agent
 * and proposes an improved system prompt. Writes the candidate to agent.modelRoutingPolicy.proposedPrompt
 * and requires user acceptance before becoming live.
 */
export async function optimizePrompt(router: LlmRouter, agentId: string): Promise<{ proposed: string; reasoning: string } | null> {
  const reflections = await prisma.agentMemory.findMany({
    where: { agentId, type: "REFLECTION" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (reflections.length < 3) return null;

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const persona = agent.persona as { systemPrompt?: string; name?: string };
  const currentPrompt = persona.systemPrompt ?? "";

  const failures = reflections
    .filter((r) => r.importance < 0.5)
    .map((r) => `- ${r.content}`)
    .join("\n");
  const wins = reflections
    .filter((r) => r.importance >= 0.8)
    .map((r) => `- ${r.content}`)
    .join("\n");

  try {
    const resp = await router.complete({
      messages: [
        {
          role: "system",
          content:
            "You are a prompt engineer. Given an agent's current system prompt and a log of past successes and failures, propose an improved system prompt. Preserve the agent's core purpose. Respond strictly as JSON: {\"proposed\": \"...\", \"reasoning\": \"...\"}",
        },
        {
          role: "user",
          content: `CURRENT PROMPT:\n${currentPrompt}\n\nFAILURES:\n${failures || "(none yet)"}\n\nWINS:\n${wins || "(none yet)"}`,
        },
      ],
      taskType: "reasoning",
      temperature: 0.4,
      jsonMode: true,
      maxTokens: 1200,
    });
    const parsed = JSON.parse(resp.content) as { proposed?: string; reasoning?: string };
    if (!parsed.proposed) return null;
    return { proposed: parsed.proposed, reasoning: parsed.reasoning ?? "" };
  } catch (err) {
    logger.warn({ err, agentId }, "prompt optimization failed");
    return null;
  }
}

/**
 * Procedural skill memory — retrieve reusable strategies from past successful runs.
 * Returns a compact string suitable for stuffing into a system prompt.
 */
export async function loadSkills(agentId: string, limit = 5): Promise<string> {
  const skills = await prisma.agentMemory.findMany({
    where: { agentId, type: "PROCEDURAL" },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  if (!skills.length) return "";
  return "## Learned skills\n" + skills.map((s, i) => `${i + 1}. ${s.content}`).join("\n");
}
