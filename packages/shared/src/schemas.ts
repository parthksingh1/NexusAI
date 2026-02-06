import { z } from "zod";

// ─── Agent persona & routing ────────────────────────────────────
export const AgentPersonaSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  systemPrompt: z.string().min(1).max(8000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32000).optional(),
});

export const ModelRoutingPolicySchema = z.object({
  preferredProvider: z.enum(["anthropic", "openai", "gemini"]).optional(),
  maxCostPerCallUsd: z.number().positive().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  requireVision: z.boolean().optional(),
  requireJsonMode: z.boolean().optional(),
});

// ─── Agent CRUD ─────────────────────────────────────────────────
export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(80),
  goal: z.string().min(1).max(2000),
  persona: AgentPersonaSchema,
  tools: z.array(z.string()).default([]),
  modelRoutingPolicy: ModelRoutingPolicySchema.default({}),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

// ─── Run start ──────────────────────────────────────────────────
export const StartRunSchema = z.object({
  input: z.string().min(1).max(16000),
  maxSteps: z.number().int().positive().max(50).default(12),
  stream: z.boolean().default(true),
});

// ─── Tool invocation ────────────────────────────────────────────
export const ToolInvocationSchema = z.object({
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
});

// ─── RAG ────────────────────────────────────────────────────────
export const RagQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().positive().max(50).default(8),
  hybridAlpha: z.number().min(0).max(1).default(0.5),     // dense↔sparse balance
  useHyde: z.boolean().default(false),
  useRerank: z.boolean().default(true),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const IngestDocumentSchema = z.object({
  source: z.enum(["notion", "github", "slack", "url", "upload"]),
  sourceId: z.string(),
  title: z.string(),
  url: z.string().url().optional(),
  text: z.string().min(1),
  chunking: z.enum(["fixed", "recursive", "semantic", "markdown"]).default("recursive"),
});

// ─── Inference types ────────────────────────────────────────────
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type StartRunInput = z.infer<typeof StartRunSchema>;
export type RagQueryInput = z.infer<typeof RagQuerySchema>;
export type IngestDocumentInput = z.infer<typeof IngestDocumentSchema>;
