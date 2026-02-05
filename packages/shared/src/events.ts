/**
 * Kafka event contracts. Topic names are the single source of truth.
 * Every producer/consumer must import these constants — never hard-code topics.
 */

export const KAFKA_TOPICS = {
  AGENT_RUN_REQUESTED: "nexus.agent.run.requested.v1",
  AGENT_RUN_STARTED: "nexus.agent.run.started.v1",
  AGENT_STEP: "nexus.agent.step.v1",
  AGENT_RUN_FINISHED: "nexus.agent.run.finished.v1",
  AGENT_MESSAGE: "nexus.agent.message.v1",             // agent-to-agent comms
  TOOL_INVOKED: "nexus.tool.invoked.v1",
  LLM_CALL: "nexus.llm.call.v1",
  MARKET_TICK: "nexus.market.tick.v1",
  ALERT_FIRED: "nexus.alert.fired.v1",
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

// Event payload shapes (one per topic)
export type AgentRunRequestedEvent = {
  runId: string;
  agentId: string;
  ownerId: string;
  input: string;
  maxSteps: number;
  requestedAt: string;
};

export type AgentRunStartedEvent = {
  runId: string;
  agentId: string;
  startedAt: string;
};

export type AgentStepEvent = {
  runId: string;
  agentId: string;
  step: number;
  kind: "thought" | "action" | "observation" | "final";
  content: string;
  tool?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  latencyMs?: number;
  model?: string;
};

export type AgentRunFinishedEvent = {
  runId: string;
  agentId: string;
  status: "succeeded" | "failed" | "cancelled";
  result?: string;
  errorMessage?: string;
  totalTokens: number;
  totalCostUsd: number;
  finishedAt: string;
};

export type AgentMessageEvent = {
  fromAgentId: string;
  toAgentId: string;
  runId: string;
  content: string;
  role: "planner" | "executor" | "critic" | "researcher";
  sentAt: string;
};

export type ToolInvokedEvent = {
  runId: string;
  agentId: string;
  tool: string;
  input: unknown;
  output: unknown;
  success: boolean;
  durationMs: number;
  riskLevel: "safe" | "moderate" | "dangerous";
};

export type LlmCallEvent = {
  requestId: string;
  agentId?: string;
  userId?: string;
  provider: "anthropic" | "openai" | "gemini";
  model: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
  cacheHit: boolean;
  success: boolean;
  errorCode?: string;
  timestamp: string;
};
