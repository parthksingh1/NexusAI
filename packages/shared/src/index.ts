// Explicit re-exports — guarantees the emitted .d.ts lists every named export,
// regardless of module-resolution quirks between tsc and downstream bundlers.

// ─── Domain types ─────────────────────────────────────────────
export type {
  UUID,
  ISODate,
  AgentStatus,
  AgentPersona,
  Agent,
  LlmProvider,
  LlmTaskType,
  ModelRoutingPolicy,
  RunStatus,
  AgentRun,
  StepKind,
  AgentStep,
  ToolRiskLevel,
  ToolParamSchema,
  ToolDefinition,
  MemoryType,
  Memory,
  ChunkingStrategy,
  RagDocument,
  RagChunk,
  RagHit,
  LlmCallRecord,
  CollaborationRole,
  SubscriptionTier,
} from "./types.js";

// ─── Zod schemas (values) + inferred types ────────────────────
export {
  AgentPersonaSchema,
  ModelRoutingPolicySchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  StartRunSchema,
  ToolInvocationSchema,
  RagQuerySchema,
  IngestDocumentSchema,
} from "./schemas.js";
export type {
  CreateAgentInput,
  UpdateAgentInput,
  StartRunInput,
  RagQueryInput,
  IngestDocumentInput,
} from "./schemas.js";

// ─── Kafka topics (value) + event payload types ───────────────
export { KAFKA_TOPICS } from "./events.js";
export type {
  KafkaTopic,
  AgentRunRequestedEvent,
  AgentRunStartedEvent,
  AgentStepEvent,
  AgentRunFinishedEvent,
  AgentMessageEvent,
  ToolInvokedEvent,
  LlmCallEvent,
} from "./events.js";

// ─── Typed error hierarchy ────────────────────────────────────
export {
  NexusError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  RateLimitError,
  ToolExecutionError,
  LlmProviderError,
  SafetyViolationError,
} from "./errors.js";
