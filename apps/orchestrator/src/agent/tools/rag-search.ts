import type { ToolDefinition } from "@nexusai/shared";
import { toolRegistry } from "../tool-registry.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";

const definition: ToolDefinition = {
  name: "knowledge_search",
  description: "Search the agent's knowledge base (hybrid dense+sparse). Use for facts, docs, prior conversations.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language search query" },
      topK: { type: "number", description: "Number of results (default 6)" },
    },
    required: ["query"],
  },
  risk: "safe",
};

async function ragSearch(input: Record<string, unknown>, ctx: { ownerId: string }): Promise<unknown> {
  const query = String(input.query ?? "");
  const topK = Math.max(1, Math.min(20, Number(input.topK ?? 6)));

  try {
    const resp = await fetch(`${config.RAG_URL}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, topK, ownerId: ctx.ownerId, useRerank: true }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      logger.warn({ status: resp.status, text }, "RAG search failed");
      return { hits: [], error: `RAG service returned ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    logger.error({ err }, "RAG call threw");
    return { hits: [], error: "RAG service unavailable" };
  }
}

toolRegistry.register(definition, ragSearch);
