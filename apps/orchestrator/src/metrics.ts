import client from "prom-client";

client.collectDefaultMetrics({ prefix: "nexus_orchestrator_" });

export const metrics = {
  registry: client.register,
  agentRunsStarted: new client.Counter({
    name: "nexus_agent_runs_started_total",
    help: "Agent runs started",
    labelNames: ["agent_id"],
  }),
  agentRunsFinished: new client.Counter({
    name: "nexus_agent_runs_finished_total",
    help: "Agent runs finished",
    labelNames: ["status"],
  }),
  agentStepDuration: new client.Histogram({
    name: "nexus_agent_step_duration_ms",
    help: "Per-step duration in ms",
    labelNames: ["kind"],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  }),
  toolInvocations: new client.Counter({
    name: "nexus_tool_invocations_total",
    help: "Tool invocations",
    labelNames: ["tool", "success"],
  }),
  llmCallsCost: new client.Counter({
    name: "nexus_llm_cost_usd_total",
    help: "Cumulative LLM cost in USD",
    labelNames: ["provider", "model"],
  }),
  activeRuns: new client.Gauge({
    name: "nexus_active_runs",
    help: "Currently running agent runs",
  }),
};
