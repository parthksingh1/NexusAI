// Explicit re-exports — guarantees the emitted .d.ts lists every named export,
// regardless of module-resolution quirks between tsc and downstream bundlers.

// ─── Types ────────────────────────────────────────────────────
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

// ─── Zod schemas + derived types ──────────────────────────────
export * from "./schemas.js";

// ─── Kafka topics + event payload types ───────────────────────
export * from "./events.js";

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
