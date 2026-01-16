import type { ToolDefinition } from "@nexusai/shared";
import { toolRegistry } from "../tool-registry.js";
import { logger } from "../../logger.js";

const definition: ToolDefinition = {
  name: "web_search",
  description: "Search the public web and return top results with titles, snippets, and URLs.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number", description: "Max results (default 5)" },
    },
    required: ["query"],
  },
  risk: "safe",
};

/**
 * Uses DuckDuckGo Instant Answer API (no key required) as a Phase 1 default.
 * Swap in Tavily / Brave / Serper in Phase 2 by wiring a proper API key.
 */
async function webSearch(input: Record<string, unknown>): Promise<unknown> {
  const query = String(input.query ?? "").trim();
  const limit = Math.max(1, Math.min(20, Number(input.limit ?? 5)));
  if (!query) return { results: [], note: "Empty query" };

  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const resp = await fetch(url, { headers: { "user-agent": "NexusAI/1.0" } });
  if (!resp.ok) {
    logger.warn({ status: resp.status }, "ddg web_search failed");
    return { results: [], error: `Search provider returned ${resp.status}` };
  }
  const data = (await resp.json()) as {
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
  };

  const results: Array<{ title: string; snippet: string; url: string }> = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({ title: data.Heading ?? query, snippet: data.AbstractText, url: data.AbstractURL });
  }
  for (const t of data.RelatedTopics ?? []) {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.slice(0, 120), snippet: t.Text, url: t.FirstURL });
    } else if (t.Topics) {
      for (const sub of t.Topics) {
        if (sub.Text && sub.FirstURL) {
          results.push({ title: sub.Text.slice(0, 120), snippet: sub.Text, url: sub.FirstURL });
        }
      }
    }
    if (results.length >= limit) break;
  }
  return { query, results: results.slice(0, limit) };
}

toolRegistry.register(definition, webSearch);
