import type { ModelSpec } from "./types.js";

/**
 * Model catalog — prices as of 2026-04. Adjust as providers update.
 * Router picks from this list based on task + policy.
 */
export const MODEL_CATALOG: ModelSpec[] = [
  // ─── Anthropic ────────────────────────────────────────────────
  {
    provider: "anthropic",
    id: "claude-opus-4-6",
    contextWindow: 1_000_000,
    inputCostPer1M: 15,
    outputCostPer1M: 75,
    avgLatencyMsPer1K: 900,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 3,
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    contextWindow: 200_000,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    avgLatencyMsPer1K: 500,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 2,
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5-20251001",
    contextWindow: 200_000,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4,
    avgLatencyMsPer1K: 220,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 1,
  },
  // ─── OpenAI ───────────────────────────────────────────────────
  {
    provider: "openai",
    id: "gpt-4o",
    contextWindow: 128_000,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
    avgLatencyMsPer1K: 550,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 2,
  },
  {
    provider: "openai",
    id: "gpt-4o-mini",
    contextWindow: 128_000,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    avgLatencyMsPer1K: 300,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 1,
  },
  // ─── Google ───────────────────────────────────────────────────
  {
    provider: "gemini",
    id: "gemini-1.5-pro",
    contextWindow: 2_000_000,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5,
    avgLatencyMsPer1K: 700,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 2,
  },
  {
    provider: "gemini",
    id: "gemini-1.5-flash",
    contextWindow: 1_000_000,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
    avgLatencyMsPer1K: 250,
    supportsVision: true,
    supportsJsonMode: true,
    supportsTools: true,
    reasoningTier: 1,
  },
];

export function findModel(provider: string, id: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.id === id);
}
