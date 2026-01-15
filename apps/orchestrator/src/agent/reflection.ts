import { LlmRouter } from "@nexusai/llm-router";
import { prisma } from "@nexusai/db";
import { v4 as uuidv4 } from "uuid";
import { graphMemory } from "../memory/neo4j.js";
import { logger } from "../logger.js";

/**
 * After a run completes, ask the model to self-evaluate and extract reusable skills.
 * Reflections are written to both Postgres (AgentMemory) and Neo4j (graph).
 * This is Pillar 6 (self-improving agents) — the foundation layer.
 */
export async function reflectOnRun(router: LlmRouter, runId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: { steps: { orderBy: { step: "asc" } }, agent: true },
  });
  if (!run || !run.agent) return;

  const transcript = run.steps
    .map((s) => `[${s.kind}${s.tool ? ` ${s.tool}` : ""}] ${s.content.slice(0, 400)}`)
    .join("\n");

  try {
    const result = await router.complete({
      messages: [
        {
          role: "system",
          content:
            "You are a run-quality critic. Evaluate the agent's trajectory and extract learnings.\n" +
            "Respond with strict JSON: {\"score\": 0-1, \"what_worked\": \"...\", \"what_to_improve\": \"...\", \"reusable_skill\": \"...|null\"}",
        },
        {
          role: "user",
          content: `Goal: ${run.agent.goal}\n\nInput: ${run.input}\n\nTranscript:\n${transcript}\n\nFinal: ${run.result ?? run.errorMessage ?? "(none)"}`,
        },
      ],
      taskType: "reasoning",
      temperature: 0.1,
      maxTokens: 600,
      jsonMode: true,
    });

    let parsed: { score?: number; what_worked?: string; what_to_improve?: string; reusable_skill?: string | null } = {};
    try {
      parsed = JSON.parse(result.content);
    } catch {
      logger.warn({ runId, content: result.content.slice(0, 200) }, "reflection JSON parse failed");
      return;
    }

    const reflection = [
      `score=${parsed.score ?? "?"}`,
      parsed.what_worked ? `worked: ${parsed.what_worked}` : null,
      parsed.what_to_improve ? `improve: ${parsed.what_to_improve}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const memId = uuidv4();
    await prisma.agentMemory.create({
      data: { id: memId, agentId: run.agentId, type: "REFLECTION", content: reflection, importance: parsed.score ?? 0.6 },
    });
    await graphMemory.recordMemory({
      id: memId,
      agentId: run.agentId,
      type: "reflection",
      content: reflection,
      importance: parsed.score ?? 0.6,
      createdAt: new Date().toISOString(),
    });

    // Store a reusable skill as procedural memory
    if (parsed.reusable_skill && parsed.reusable_skill.length > 10) {
      const skillId = uuidv4();
      await prisma.agentMemory.create({
        data: { id: skillId, agentId: run.agentId, type: "PROCEDURAL", content: parsed.reusable_skill, importance: 0.9 },
      });
      await graphMemory.recordMemory({
        id: skillId,
        agentId: run.agentId,
        type: "procedural",
        content: parsed.reusable_skill,
        importance: 0.9,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.warn({ err, runId }, "reflection failed");
  }
}
