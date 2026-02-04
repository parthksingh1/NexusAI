import type { LlmProvider, LlmTaskType, ModelRoutingPolicy, ToolDefinition } from "@nexusai/shared";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
  name?: string;
};

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type CompletionRequest = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  taskType: LlmTaskType;
  policy?: ModelRoutingPolicy;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  agentId?: string;
  userId?: string;
};

export type CompletionResult = {
  content: string;
  toolCalls: ChatToolCall[];
  provider: LlmProvider;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  latencyMs: number;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
};

export type StreamChunk =
  | { type: "content"; delta: string }
  | { type: "tool_call_delta"; id: string; name?: string; argsDelta?: string }
  | { type: "done"; result: CompletionResult };

export type ModelSpec = {
  provider: LlmProvider;
  id: string;                          // provider-specific model id
  contextWindow: number;
  inputCostPer1M: number;              // USD per 1M input tokens
  outputCostPer1M: number;             // USD per 1M output tokens
  avgLatencyMsPer1K: number;           // observed median
  supportsVision: boolean;
  supportsJsonMode: boolean;
  supportsTools: boolean;
  reasoningTier: 1 | 2 | 3;            // 3 = frontier reasoning
};

export interface LlmProviderClient {
  readonly provider: LlmProvider;
  complete(model: ModelSpec, req: CompletionRequest): Promise<CompletionResult>;
  stream?(model: ModelSpec, req: CompletionRequest): AsyncIterable<StreamChunk>;
}
