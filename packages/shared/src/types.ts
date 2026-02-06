/**
 * Canonical domain types for NexusAI.
 * These flow between orchestrator, RAG, sandbox, web, and SDK.
 */

export type UUID = string;
export type ISODate = string;

// ─── Agent ──────────────────────────────────────────────────────
export type AgentStatus = "idle" | "running" | "paused" | "stopped" | "error";

export type AgentPersona = {
  name: string;
  description: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type Agent = {
  id: UUID;
  ownerId: UUID;
  name: string;
  goal: string;
  persona: AgentPersona;
  tools: string[];
  modelRoutingPolicy: ModelRoutingPolicy;
  status: AgentStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
};

// ─── Model routing ──────────────────────────────────────────────
export type LlmProvider = "anthropic" | "openai" | "gemini";

export type LlmTaskType =
  | "reasoning"          // complex multi-step planning
  | "coding"             // code generation
  | "extraction"         // structured output
  | "summarization"
  | "classification"
  | "chat"
  | "vision"
  | "fast";              // latency-critical, cheap

export type ModelRoutingPolicy = {
  preferredProvider?: LlmProvider;
  maxCostPerCallUsd?: number;
  maxLatencyMs?: number;
  requireVision?: boolean;
  requireJsonMode?: boolean;
};

// ─── Tasks / Runs ───────────────────────────────────────────────
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_human"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentRun = {
  id: UUID;
  agentId: UUID;
  input: string;
  status: RunStatus;
  startedAt: ISODate;
  finishedAt?: ISODate;
  totalTokens: number;
  totalCostUsd: number;
  result?: string;
  errorMessage?: string;
};

// ─── ReAct step trace ───────────────────────────────────────────
export type StepKind = "thought" | "action" | "observation" | "final";

export type AgentStep = {
  id: UUID;
  runId: UUID;
  step: number;
  kind: StepKind;
  content: string;
  tool?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  createdAt: ISODate;
};

// ─── Tools ──────────────────────────────────────────────────────
export type ToolRiskLevel = "safe" | "moderate" | "dangerous";

export type ToolParamSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParamSchema;
  risk: ToolRiskLevel;
  requiresApproval?: boolean;
};

// ─── Memory ─────────────────────────────────────────────────────
export type MemoryType = "episodic" | "semantic" | "procedural" | "reflection";

export type Memory = {
  id: UUID;
  agentId: UUID;
  type: MemoryType;
  content: string;
  importance: number;       // 0..1
  embedding?: number[];
  relatedIds?: UUID[];
  createdAt: ISODate;
  accessedAt?: ISODate;
};

// ─── RAG ────────────────────────────────────────────────────────
export type ChunkingStrategy = "fixed" | "recursive" | "semantic" | "markdown";

export type RagDocument = {
  id: UUID;
  ownerId: UUID;
  source: "notion" | "github" | "slack" | "url" | "upload";
  sourceId: string;
  title: string;
  url?: string;
  createdAt: ISODate;
};

export type RagChunk = {
  id: UUID;
  documentId: UUID;
  text: string;
  tokenCount: number;
  position: number;
  metadata?: Record<string, unknown>;
};

export type RagHit = {
  chunkId: UUID;
  documentId: UUID;
  title: string;
  snippet: string;
  score: number;            // hybrid (dense+sparse+rerank) composite score
  url?: string;
};

// ─── LLM usage record (for ClickHouse) ──────────────────────────
export type LlmCallRecord = {
  requestId: string;
  agentId?: string;
  userId?: string;
  provider: LlmProvider;
  model: string;
  taskType: LlmTaskType;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
  cacheHit: boolean;
  success: boolean;
  errorCode?: string;
};

// ─── Collaboration ──────────────────────────────────────────────
export type CollaborationRole = "planner" | "executor" | "critic" | "researcher";

// ─── Billing ────────────────────────────────────────────────────
export type SubscriptionTier = "free" | "pro" | "team" | "enterprise";
