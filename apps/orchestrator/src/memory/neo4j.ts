import neo4j, { type Driver, type Session } from "neo4j-driver";
import { config } from "../config.js";
import { logger } from "../logger.js";

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (_driver) return _driver;
  _driver = neo4j.driver(
    config.NEO4J_URI,
    neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD),
    { maxConnectionPoolSize: 50, disableLosslessIntegers: true },
  );
  return _driver;
}

async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const s = getDriver().session();
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

export type MemoryNode = {
  id: string;
  agentId: string;
  type: "episodic" | "semantic" | "procedural" | "reflection";
  content: string;
  importance: number;
  createdAt: string;
};

/**
 * Upsert an Agent node and add a new Memory node linked via HAS_MEMORY.
 * Additional relationships (RELATED_TO, USED_TOOL, LED_TO_OUTCOME) are written
 * by higher-level workflows.
 */
export const graphMemory = {
  async upsertAgent(agentId: string, name: string): Promise<void> {
    try {
      await withSession((s) =>
        s.run("MERGE (a:Agent {id: $id}) ON CREATE SET a.name = $name, a.createdAt = datetime() ON MATCH SET a.name = $name RETURN a", {
          id: agentId,
          name,
        }),
      );
    } catch (err) {
      logger.warn({ err }, "graph upsertAgent failed");
    }
  },

  async recordMemory(m: MemoryNode): Promise<void> {
    try {
      await withSession((s) =>
        s.run(
          `
          MERGE (a:Agent {id: $agentId})
          CREATE (m:Memory {
            id: $id, type: $type, content: $content,
            importance: $importance, agentId: $agentId, createdAt: datetime($createdAt)
          })
          CREATE (a)-[:HAS_MEMORY]->(m)
          RETURN m.id AS id
          `,
          m,
        ),
      );
    } catch (err) {
      logger.warn({ err }, "graph recordMemory failed");
    }
  },

  async linkTool(runId: string, agentId: string, tool: string, outcome: "success" | "failure"): Promise<void> {
    try {
      await withSession((s) =>
        s.run(
          `
          MERGE (a:Agent {id: $agentId})
          MERGE (t:Tool {id: $tool}) ON CREATE SET t.name = $tool
          MERGE (r:Run {id: $runId})
          MERGE (a)-[:USED_TOOL {runId: $runId, outcome: $outcome, at: datetime()}]->(t)
          MERGE (r)-[:INVOKED]->(t)
          `,
          { agentId, tool, runId, outcome },
        ),
      );
    } catch (err) {
      logger.warn({ err }, "graph linkTool failed");
    }
  },

  async relateMemories(fromId: string, toId: string, relation: string, weight = 0.5): Promise<void> {
    try {
      await withSession((s) =>
        s.run(
          `
          MATCH (a:Memory {id: $from}), (b:Memory {id: $to})
          MERGE (a)-[r:RELATED_TO {type: $relation}]->(b)
          SET r.weight = $weight
          `,
          { from: fromId, to: toId, relation, weight },
        ),
      );
    } catch (err) {
      logger.warn({ err }, "graph relateMemories failed");
    }
  },

  /** Fetch recent memories for an agent, newest first. */
  async recall(agentId: string, limit = 10): Promise<MemoryNode[]> {
    try {
      const res = await withSession((s) =>
        s.run(
          `
          MATCH (a:Agent {id: $agentId})-[:HAS_MEMORY]->(m:Memory)
          RETURN m ORDER BY m.createdAt DESC LIMIT $limit
          `,
          { agentId, limit },
        ),
      );
      return res.records.map((r) => {
        const n = r.get("m").properties as MemoryNode;
        return n;
      });
    } catch (err) {
      logger.warn({ err }, "graph recall failed");
      return [];
    }
  },
};

export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}
