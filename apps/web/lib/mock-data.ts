/**
 * Demo data so the UI looks alive when the backend is offline or a user is
 * just exploring. Real API calls override this.
 */

import type { Agent, AgentRun, Tool, ActivityEvent } from "./api";

const now = Date.now();
const minutes = (n: number) => new Date(now - n * 60_000).toISOString();
const hours   = (n: number) => new Date(now - n * 3_600_000).toISOString();
const days    = (n: number) => new Date(now - n * 86_400_000).toISOString();

export const mockAgents: Agent[] = [
  {
    id: "demo-research-001",
    name: "Market Research",
    goal: "Research public markets, summarize earnings calls, track competitor news, and produce cited briefings.",
    persona: { name: "Market Research", description: "Equity research analyst", systemPrompt: "" },
    tools: ["web_search", "knowledge_search", "calculator"],
    status: "IDLE",
    createdAt: days(12),
    updatedAt: minutes(14),
  },
  {
    id: "demo-support-001",
    name: "Customer Support",
    goal: "Answer customer questions using our docs. Escalate issues beyond L1 with a structured hand-off.",
    persona: { name: "Customer Support", description: "L1 support specialist", systemPrompt: "" },
    tools: ["knowledge_search", "web_search"],
    status: "RUNNING",
    createdAt: days(8),
    updatedAt: minutes(2),
  },
  {
    id: "demo-devops-001",
    name: "DevOps Sentinel",
    goal: "Monitor CI/CD pipelines, summarize deployment outcomes, file incident reports on anomalies.",
    persona: { name: "DevOps Sentinel", description: "Platform reliability", systemPrompt: "" },
    tools: ["web_search", "github_read_file", "code_exec"],
    status: "IDLE",
    createdAt: days(20),
    updatedAt: hours(3),
  },
  {
    id: "demo-writer-001",
    name: "Content Writer",
    goal: "Draft blog posts, tweet threads, and long-form articles from a brief with SEO-aware outlines.",
    persona: { name: "Content Writer", description: "Long-form writer", systemPrompt: "" },
    tools: ["web_search", "knowledge_search"],
    status: "IDLE",
    createdAt: days(5),
    updatedAt: hours(19),
  },
  {
    id: "demo-data-001",
    name: "Data Analyst",
    goal: "Query internal datasets, generate dashboards, surface anomalies in business metrics.",
    persona: { name: "Data Analyst", description: "SQL + viz specialist", systemPrompt: "" },
    tools: ["code_exec", "calculator", "knowledge_search"],
    status: "PAUSED",
    createdAt: days(30),
    updatedAt: hours(48),
  },
  {
    id: "demo-legal-001",
    name: "Legal Reviewer",
    goal: "Review contracts, flag unusual clauses, compare against our standard templates.",
    persona: { name: "Legal Reviewer", description: "Contract reviewer", systemPrompt: "" },
    tools: ["knowledge_search"],
    status: "ERROR",
    createdAt: days(45),
    updatedAt: days(1),
  },
];

export const mockRuns: AgentRun[] = [
  { id: "r_01", agentId: "demo-research-001", input: "Summarize NVDA Q3 earnings — strengths, risks, guidance revisions.",
    status: "SUCCEEDED", startedAt: minutes(14), finishedAt: minutes(12), totalTokens: 8420, totalCostUsd: "0.0214" },
  { id: "r_02", agentId: "demo-research-001", input: "Track competitor product launches in the analytics space this week.",
    status: "SUCCEEDED", startedAt: hours(3), finishedAt: hours(3), totalTokens: 5120, totalCostUsd: "0.0128" },
  { id: "r_03", agentId: "demo-research-001", input: "What's the market sentiment around AI infrastructure spend in 2026?",
    status: "FAILED", errorMessage: "Rate limit from web_search", startedAt: hours(18), finishedAt: hours(18), totalTokens: 1240, totalCostUsd: "0.0034" },
  { id: "r_04", agentId: "demo-research-001", input: "Profile recent funding rounds in cybersecurity >$50M.",
    status: "SUCCEEDED", startedAt: days(1), finishedAt: days(1), totalTokens: 9870, totalCostUsd: "0.0251" },
];

export const mockTools: Tool[] = [
  { name: "web_search",       description: "Search the public web", risk: "safe" },
  { name: "calculator",       description: "Evaluate arithmetic",   risk: "safe" },
  { name: "knowledge_search", description: "Hybrid RAG over your KB", risk: "safe" },
  { name: "code_exec",        description: "Run Python/Node/Bash in sandbox", risk: "moderate" },
  { name: "github_read_file", description: "Read a file from a repo", risk: "safe" },
  { name: "github_create_pr", description: "Open a pull request",   risk: "dangerous" },
];

export function mockRecentRuns(agents: Agent[]) {
  return [
    { ...mockRuns[0], agentName: agents.find((a) => a.id === "demo-research-001")?.name ?? "Market Research" },
    { ...mockRuns[1], agentName: "Market Research" },
    { ...mockRuns[3], agentName: "Market Research" },
  ];
}

export function mockCostByDay(days: number) {
  const out: { day: string; cost: number; tokens: number; calls: number }[] = [];
  const base = Date.now();
  let running = 0.2;
  for (let i = days - 1; i >= 0; i--) {
    running = Math.max(0.05, running + (Math.random() - 0.45) * 0.18);
    const d = new Date(base - i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const cost = Math.max(0.02, running * (0.8 + Math.random() * 0.6));
    const calls = Math.floor(30 + Math.random() * 180);
    const tokens = calls * (1500 + Math.floor(Math.random() * 2500));
    out.push({ day, cost: Number(cost.toFixed(4)), tokens, calls });
  }
  return out;
}

export function mockCostByModel() {
  return [
    { model: "claude-sonnet-4-6",         cost: 1.42, calls: 312, p95_ms: 1180 },
    { model: "gpt-4o-mini",               cost: 0.58, calls: 864, p95_ms: 720 },
    { model: "gemini-1.5-flash",          cost: 0.21, calls: 1204, p95_ms: 480 },
    { model: "claude-opus-4-6",           cost: 3.08, calls: 71,  p95_ms: 2340 },
    { model: "gpt-4o",                    cost: 1.12, calls: 186, p95_ms: 980 },
    { model: "gemini-1.5-pro",            cost: 0.74, calls: 148, p95_ms: 1140 },
  ];
}

export function mockActivity(): ActivityEvent[] {
  return [
    { id: "a1", type: "run.succeeded",   agentId: "demo-research-001", agentName: "Market Research",  message: "Completed run in 8 steps · $0.0214",  ts: minutes(14) },
    { id: "a2", type: "approval.required", agentId: "demo-devops-001",  agentName: "DevOps Sentinel",  message: "github_create_pr requires human approval", ts: minutes(38) },
    { id: "a3", type: "run.started",     agentId: "demo-support-001", agentName: "Customer Support", message: "Started a new run", ts: minutes(46) },
    { id: "a4", type: "tool.invoked",    agentId: "demo-data-001",    agentName: "Data Analyst",     message: "Executed code_exec (python, 1.3s)",    ts: hours(2) },
    { id: "a5", type: "run.failed",      agentId: "demo-research-001", agentName: "Market Research", message: "Run failed: web_search rate limited",   ts: hours(18) },
    { id: "a6", type: "agent.created",                               agentName: "Content Writer",   message: "Created a new agent",                   ts: days(5) },
  ];
}
