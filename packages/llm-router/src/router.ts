import type { LlmTaskType, ModelRoutingPolicy, LlmProvider } from "@nexusai/shared";
import { LlmProviderError } from "@nexusai/shared";
import pino from "pino";
import { MODEL_CATALOG } from "./catalog.js";
import type {
  CompletionRequest,
  CompletionResult,
  LlmProviderClient,
  ModelSpec,
  StreamChunk,
} from "./types.js";
import { AnthropicClient } from "./providers/anthropic.js";
import { OpenAIClient } from "./providers/openai.js";
import { GeminiClient } from "./providers/gemini.js";

const log = pino({ name: "llm-router", level: process.env.LOG_LEVEL ?? "info" });

/**
 * Task-type scoring weights. Tuned empirically; expose via feature flag later.
 *   score = reasoningFit - costPenalty * costWeight - latencyPenalty * latencyWeight
 */
const TASK_WEIGHTS: Record<LlmTaskType, { reasoning: number; cost: number; latency: number; minReasoningTier: 1 | 2 | 3 }> = {
  reasoning:      { reasoning: 1.0, cost: 0.3, latency: 0.1, minReasoningTier: 3 },
  coding:         { reasoning: 0.9, cost: 0.4, latency: 0.2, minReasoningTier: 2 },
  extraction:     { reasoning: 0.4, cost: 0.6, latency: 0.3, minReasoningTier: 1 },
  summarization:  { reasoning: 0.4, cost: 0.6, latency: 0.3, minReasoningTier: 1 },
  classification: { reasoning: 0.3, cost: 0.7, latency: 0.4, minReasoningTier: 1 },
  chat:           { reasoning: 0.5, cost: 0.5, latency: 0.4, minReasoningTier: 1 },
  vision:         { reasoning: 0.6, cost: 0.4, latency: 0.3, minReasoningTier: 1 },
  fast:           { reasoning: 0.2, cost: 0.7, latency: 0.9, minReasoningTier: 1 },
};

export type RouterOptions = {
  anthropicKey?: string;
  openaiKey?: string;
  googleKey?: string;
  /** Optional override of the catalog (useful in tests / private models). */
  catalog?: ModelSpec[];
};

export class LlmRouter {
  private readonly clients: Partial<Record<LlmProvider, LlmProviderClient>> = {};
  private readonly catalog: ModelSpec[];

  constructor(opts: RouterOptions = {}) {
    this.catalog = opts.catalog ?? MODEL_CATALOG;
    if (opts.anthropicKey) this.clients.anthropic = new AnthropicClient(opts.anthropicKey);
    if (opts.openaiKey) this.clients.openai = new OpenAIClient(opts.openaiKey);
    if (opts.googleKey) this.clients.gemini = new GeminiClient(opts.googleKey);
  }

  /**
   * Pick the best model given task + routing policy.
   * Returns null if no model satisfies hard constraints — caller decides fallback.
   */
  selectModel(taskType: LlmTaskType, policy: ModelRoutingPolicy = {}): ModelSpec | null {
    const weights = TASK_WEIGHTS[taskType];

    // Hard filters
    let candidates = this.catalog.filter((m) => {
      if (!this.clients[m.provider]) return false;
      if (policy.preferredProvider && m.provider !== policy.preferredProvider) return false;
      if (policy.requireVision && !m.supportsVision) return false;
      if (policy.requireJsonMode && !m.supportsJsonMode) return false;
      if (m.reasoningTier < weights.minReasoningTier) return false;
      return true;
    });

    // If preferredProvider filters everything out, drop the preference
    if (candidates.length === 0 && policy.preferredProvider) {
      log.warn({ policy, taskType }, "preferredProvider has no valid model; falling back");
      candidates = this.catalog.filter(
        (m) =>
          this.clients[m.provider] &&
          (!policy.requireVision || m.supportsVision) &&
          (!policy.requireJsonMode || m.supportsJsonMode) &&
          m.reasoningTier >= weights.minReasoningTier,
      );
    }

    if (candidates.length === 0) return null;

    // Normalize cost & latency to [0..1] across candidates, then score.
    const maxCost = Math.max(...candidates.map((m) => (m.inputCostPer1M + m.outputCostPer1M) / 2));
    const maxLatency = Math.max(...candidates.map((m) => m.avgLatencyMsPer1K));

    const scored = candidates.map((m) => {
      const avgCost = (m.inputCostPer1M + m.outputCostPer1M) / 2;
      const costNorm = avgCost / (maxCost || 1);
      const latencyNorm = m.avgLatencyMsPer1K / (maxLatency || 1);
      const reasoningFit = m.reasoningTier / 3;
      let score = weights.reasoning * reasoningFit - weights.cost * costNorm - weights.latency * latencyNorm;

      if (policy.maxCostPerCallUsd !== undefined && avgCost > policy.maxCostPerCallUsd * 1000) {
        score -= 1;
      }
      if (policy.maxLatencyMs !== undefined && m.avgLatencyMsPer1K > policy.maxLatencyMs) {
        score -= 1;
      }
      return { m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.m;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = this.selectModel(req.taskType, req.policy);
    if (!model) {
      throw new LlmProviderError("router", `No available model for task=${req.taskType}`);
    }

    const client = this.clients[model.provider];
    if (!client) {
      throw new LlmProviderError(model.provider, "Client not initialized (missing API key?)");
    }

    log.info({ provider: model.provider, model: model.id, taskType: req.taskType }, "routing LLM call");

    try {
      return await client.complete(model, req);
    } catch (err) {
      log.error({ err, model: model.id }, "primary model failed, attempting fallback");
      return await this.completeWithFallback(req, model);
    }
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const model = this.selectModel(req.taskType, req.policy);
    if (!model) throw new LlmProviderError("router", `No available model for task=${req.taskType}`);
    const client = this.clients[model.provider];
    if (!client || !client.stream) {
      const result = await this.complete(req);
      yield { type: "content", delta: result.content };
      yield { type: "done", result };
      return;
    }
    yield* client.stream(model, req);
  }

  /** Try next-best model if primary fails. Single retry; gives up after. */
  private async completeWithFallback(req: CompletionRequest, failed: ModelSpec): Promise<CompletionResult> {
    const alt = this.catalog.find(
      (m) =>
        m.provider !== failed.provider &&
        this.clients[m.provider] &&
        m.reasoningTier >= TASK_WEIGHTS[req.taskType].minReasoningTier,
    );
    if (!alt) throw new LlmProviderError(failed.provider, "No fallback model available");
    const client = this.clients[alt.provider]!;
    return await client.complete(alt, req);
  }
}
