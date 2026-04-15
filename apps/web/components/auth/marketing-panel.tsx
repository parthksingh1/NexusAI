"use client";

import { CheckCircle2, Sparkles, Zap, Brain, Shield, Activity } from "lucide-react";

const FEATURES = [
  "Multi-model routing across Claude, GPT, and Gemini",
  "Sandboxed code execution with gVisor isolation",
  "Hybrid RAG with citation-grounded answers",
  "Human-in-the-loop approvals for risky actions",
  "Full observability — every call, step, dollar tracked",
];

const STATS = [
  { value: "10k+", label: "Concurrent agents" },
  { value: "<200ms", label: "p95 latency" },
  { value: "99.98%", label: "Uptime" },
];

export function AuthMarketingPanel() {
  return (
    <div className="hidden lg:flex bg-bg-subtle border-border p-12 relative overflow-hidden h-full">
      {/* Backdrop layers */}
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-info/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-md self-center w-full mx-auto space-y-10">
        {/* Hero */}
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-muted/50 px-2.5 py-1 text-2xs font-medium text-brand mb-5">
            <Sparkles className="h-3 w-3" />
            v1.4 — Workflows + Memory graph
          </div>
          <h2 className="text-3xl xl:text-4xl font-semibold tracking-tightest leading-[1.1]">
            Build agents that{" "}
            <span className="text-gradient-brand">reason, act, and improve</span>.
          </h2>
          <p className="mt-4 text-sm text-fg-muted leading-relaxed">
            NexusAI is the production-ready operating system for autonomous AI agents.
            Deploy in minutes. Observe every call. Stay in control.
          </p>
        </div>

        {/* Features */}
        <ul className="space-y-2.5">
          {FEATURES.map((text) => (
            <li key={text} className="flex items-start gap-2.5">
              <div className="h-5 w-5 rounded-md bg-success/10 border border-success/20 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="h-3 w-3 text-success" />
              </div>
              <span className="text-sm text-fg-muted leading-relaxed">{text}</span>
            </li>
          ))}
        </ul>

        {/* Capability quick-stats */}
        <div className="grid grid-cols-3 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-bg-elevated p-3 text-center">
              <div className="text-lg font-semibold tracking-tighter font-mono">{s.value}</div>
              <div className="text-2xs text-fg-subtle mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Floating "live activity" card */}
        <div className="rounded-lg border border-border bg-bg-elevated p-4 shadow-md ring-inset-subtle">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-success" />
              <span className="text-2xs uppercase tracking-wider font-semibold text-fg-subtle">
                Live activity
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-2xs text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
              Streaming
            </span>
          </div>
          <ul className="space-y-1.5 text-xs">
            <ActivityRow icon={Brain} text="Market Research · thought" tone="info" />
            <ActivityRow icon={Zap}   text="web_search · 312 ms" tone="warn" />
            <ActivityRow icon={Shield} text="Approved github_create_pr" tone="success" />
            <ActivityRow icon={Sparkles} text="Reflection saved · imp 0.92" tone="brand" />
          </ul>
        </div>

        {/* Trust badges */}
        <div>
          <div className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold mb-2">
            Trusted by engineers at
          </div>
          <div className="flex items-center gap-4 text-sm font-semibold text-fg-muted opacity-70">
            <span>Vercel</span><span>·</span>
            <span>Linear</span><span>·</span>
            <span>Stripe</span><span>·</span>
            <span>Ramp</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({
  icon: Icon, text, tone,
}: { icon: React.ComponentType<{ className?: string }>; text: string; tone: "info" | "warn" | "success" | "brand" }) {
  const colors = {
    info:    "text-info bg-info/10 border-info/20",
    warn:    "text-warn bg-warn/10 border-warn/20",
    success: "text-success bg-success/10 border-success/20",
    brand:   "text-brand bg-brand-muted border-brand-border",
  }[tone];
  return (
    <li className="flex items-center gap-2">
      <div className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 ${colors}`}>
        <Icon className="h-2.5 w-2.5" />
      </div>
      <span className="text-fg-muted truncate">{text}</span>
    </li>
  );
}
