"use client";

import { Sparkles, Rocket, Wrench, Shield, Zap, Star } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Entry = {
  version: string; date: string; type: "release" | "feature" | "fix" | "security";
  title: string; highlights: { kind: "new" | "improved" | "fixed" | "security"; text: string }[];
  featured?: boolean;
};

const ENTRIES: Entry[] = [
  {
    version: "v1.4.0", date: "2026-04-10", type: "release", featured: true,
    title: "Visual workflow builder, evaluations, and memory graph",
    highlights: [
      { kind: "new",      text: "Drag-and-drop workflow builder with React Flow canvas, 6 node types, auto-layout." },
      { kind: "new",      text: "Evaluations page — datasets, LLM-as-judge scoring, model comparison matrix." },
      { kind: "new",      text: "Memory graph explorer — interactive Neo4j visualization with typed relationships." },
      { kind: "new",      text: "Model comparison playground — run the same prompt across Claude, GPT, Gemini simultaneously." },
      { kind: "improved", text: "Traces viewer now shows span waterfall with nested retrievals and tool calls." },
    ],
  },
  {
    version: "v1.3.2", date: "2026-04-02", type: "security",
    title: "Jailbreak defense + signed webhooks",
    highlights: [
      { kind: "security", text: "Added prompt-injection detection to the guardrails layer." },
      { kind: "new",      text: "HMAC-SHA256 signatures on all outbound webhook deliveries." },
      { kind: "improved", text: "Tool approval timeout now configurable per-tool." },
    ],
  },
  {
    version: "v1.3.0", date: "2026-03-24", type: "release",
    title: "Scheduled runs, audit log, status page",
    highlights: [
      { kind: "new",      text: "Cron-based autonomous schedules, with presets for common cadences." },
      { kind: "new",      text: "Tamper-evident audit log. 365-day retention on Team tier." },
      { kind: "new",      text: "Public status page with 90-day uptime history per service." },
    ],
  },
  {
    version: "v1.2.1", date: "2026-03-10", type: "fix",
    title: "Rerank fixes + performance",
    highlights: [
      { kind: "fixed",    text: "Cohere rerank score normalization when top_n < candidate count." },
      { kind: "fixed",    text: "WebSocket reconnection on long-running runs across orchestrator restarts." },
      { kind: "improved", text: "pgvector HNSW index builds 3.2× faster on large chunk sets." },
    ],
  },
  {
    version: "v1.2.0", date: "2026-02-26", type: "feature",
    title: "Self-improving agents",
    highlights: [
      { kind: "new",      text: "Reflection loop runs after every agent execution and extracts reusable skills." },
      { kind: "new",      text: "Prompt optimizer proposes system prompt improvements from reflection history." },
      { kind: "improved", text: "Procedural memory now recalled into system prompts automatically." },
    ],
  },
  {
    version: "v1.1.0", date: "2026-02-08", type: "release",
    title: "Marketplace, collaboration, and hybrid RAG",
    highlights: [
      { kind: "new",      text: "Agent marketplace with publish, fork, and star." },
      { kind: "new",      text: "Multi-agent collaboration protocol (planner / executor / critic / synthesizer)." },
      { kind: "new",      text: "Hybrid dense + sparse retrieval via pgvector + Postgres tsvector." },
      { kind: "new",      text: "HyDE expansion and query decomposition for multi-hop questions." },
    ],
  },
  {
    version: "v1.0.0", date: "2026-01-15", type: "release",
    title: "NexusAI 1.0 — production-ready",
    highlights: [
      { kind: "new",      text: "Multi-model LLM router with cost/latency/complexity scoring across Claude, GPT, Gemini." },
      { kind: "new",      text: "Sandboxed code execution with gVisor-ready Docker isolation." },
      { kind: "new",      text: "Real-time data streams — crypto, news, weather — with z-score anomaly detection." },
      { kind: "new",      text: "TypeScript + Python SDKs, plus the `nexus` CLI." },
    ],
  },
];

const TYPE_META = {
  release:  { icon: Rocket,   label: "Release",  color: "text-brand bg-brand-muted border-brand-border" },
  feature:  { icon: Sparkles, label: "Feature",  color: "text-info bg-info/10 border-info/20" },
  fix:      { icon: Wrench,   label: "Fix",      color: "text-warn bg-warn/10 border-warn/20" },
  security: { icon: Shield,   label: "Security", color: "text-danger bg-danger/10 border-danger/20" },
};

const KIND_META = {
  new:      { label: "New",      tone: "brand" as const },
  improved: { label: "Improved", tone: "info" as const },
  fixed:    { label: "Fixed",    tone: "warn" as const },
  security: { label: "Security", tone: "danger" as const },
};

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        title="Changelog"
        description="Everything that has shipped. Subscribe via RSS or email in settings."
      />

      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-6 top-2 bottom-2 w-px bg-border hidden md:block" />

        <div className="space-y-6">
          {ENTRIES.map((e) => {
            const meta = TYPE_META[e.type];
            const Icon = meta.icon;
            return (
              <div key={e.version} className="relative flex gap-4">
                <div className={`shrink-0 h-12 w-12 rounded-lg border flex items-center justify-center z-10 ${meta.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <Card className={`flex-1 p-6 ${e.featured ? "border-brand/40 shadow-glow-brand" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge tone={meta.color.includes("brand") ? "brand" : meta.color.includes("info") ? "info" : meta.color.includes("warn") ? "warn" : "danger"} size="sm">
                      {meta.label}
                    </Badge>
                    <span className="font-mono text-sm font-semibold">{e.version}</span>
                    <span className="text-2xs text-fg-subtle">{format(new Date(e.date), "MMMM d, yyyy")}</span>
                    {e.featured && (
                      <Badge tone="warn" size="sm"><Star className="h-3 w-3" />Featured</Badge>
                    )}
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight">{e.title}</h2>
                  <ul className="mt-4 space-y-2">
                    {e.highlights.map((h, i) => {
                      const km = KIND_META[h.kind];
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <Badge tone={km.tone} size="sm" className="mt-0.5 shrink-0">{km.label}</Badge>
                          <span className="text-sm text-fg-muted leading-relaxed">{h.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      <Card className="mt-8 p-5 bg-bg-subtle">
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-brand shrink-0" />
          <div>
            <h3 className="font-semibold tracking-tight">Stay in the loop</h3>
            <p className="text-sm text-fg-muted mt-1">
              Subscribe to release notes via RSS at <code className="text-2xs font-mono bg-bg-muted px-1.5 py-0.5 rounded">/changelog.rss</code>, or enable email updates in <a href="/settings" className="text-brand underline">Settings → Notifications</a>.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
