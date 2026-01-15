import { prisma } from "@nexusai/db";
import { v4 as uuidv4 } from "uuid";
import { graphMemory } from "../memory/neo4j.js";
import { logger } from "../logger.js";

/**
 * Thin wrapper around Postgres + pgvector for agent memory.
 * Neo4j graph memory is layered on top in Phase 2 — this module handles episodic/semantic/reflection
 * with simple cosine-distance recall.
 */
export const memory = {
  async recordEpisodic(agentId: string, content: string, importance = 0.5): Promise<void> {
    const id = uuidv4();
    try {
      await prisma.agentMemory.create({
        data: { id, agentId, type: "EPISODIC", content, importance },
      });
      await graphMemory.recordMemory({
        id, agentId, type: "episodic", content, importance,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err }, "failed to record episodic memory");
    }
  },

  async recordReflection(agentId: string, content: string): Promise<void> {
    const id = uuidv4();
    try {
      await prisma.agentMemory.create({
        data: { id, agentId, type: "REFLECTION", content, importance: 0.8 },
      });
      await graphMemory.recordMemory({
        id, agentId, type: "reflection", content, importance: 0.8,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err }, "failed to record reflection");
    }
  },

  /** Recall the N most recent memories for context-stuffing. */
  async recall(agentId: string, limit = 10): Promise<Array<{ content: string; type: string; createdAt: Date }>> {
    const rows = await prisma.agentMemory.findMany({
      where: { agentId },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { content: true, type: true, createdAt: true },
    });
    return rows;
  },
};
