"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search, Filter, ChevronRight, Brain, Wrench, Eye, CheckCircle2,
  Network, Cpu, Database, Zap, ArrowRight, Clock, AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/cn";

type Span = {
  id: string; name: string; kind: "llm" | "tool" | "retrieve" | "rerank" | "agent";
  startMs: number; durMs: number; status: "ok" | "error"; parent?: string; meta?: string;
};

const TRACES = [
  { id: "tr_01", agent: "Market Research", input: "Summarize NVDA Q3 earnings",       spans: 12, totalMs: 3420, status: "ok" as const,    ts: new Date(Date.now() - 8 * 60_000).toISOString(), cost: 0.0214 },
  { id: "tr_02", agent: "Customer Support", input: "Reset password steps",              spans: 4,  totalMs: 820,  status: "ok" as const,    ts: new Date(Date.now() - 24 * 60_000).toISOString(), cost: 0.0038 },
  { id: "tr_03", agent: "DevOps Sentinel",  input: "Triage CI failure in main pipe",    spans: 9,  totalMs: 4280, status: "error" as const, ts: new Date(Date.now() - 3 * 3600_000).toISOString(), cost: 0.0192 },
  { id: "tr_04", agent: "Market Research",  input: "Competitor launches this week",     spans: 14, totalMs: 5120, status: "ok" as const,    ts: new Date(Date.now() - 6 * 3600_000).toISOString(), cost: 0.0342 },
  { id: "tr_05", agent: "Code Helper",      input: "Optimize this SQL query",            spans: 6,  totalMs: 2140, status: "ok" as const,    ts: new Date(Date.now() - 24 * 3600_000).toISOString(), cost: 0.0088 },
];

const SAMPLE_SPANS: Span[] = [
  { id: "s1",  name: "agent.react_loop",   kind: "agent",    startMs: 0,    durMs: 3420, status: "ok" },
  { id: "s2",  name: "llm.plan",           kind: "llm",      startMs: 40,   durMs: 780,  status: "ok", parent: "s1", meta: "claude-sonnet-4-6 · 1,284 tok" },
  { id: "s3",  name: "tool.knowledge_search", kind: "tool",  startMs: 840,  durMs: 420,  status: "ok", parent: "s1", meta: "query: 'NVDA Q3 earnings'" },
  { id: "s4",  name: "rag.dense_search",   kind: "retrieve", startMs: 860,  durMs: 180,  status: "ok", parent: "s3", meta: "pgvector · 40 hits" },
  { id: "s5",  name: "rag.sparse_search",  kind: "retrieve", startMs: 880,  durMs: 110,  status: "ok", parent: "s3", meta: "tsvector · 22 hits" },
  { id: "s6",  name: "rag.rerank",         kind: "rerank",   startMs: 1050, durMs: 210,  status: "ok", parent: "s3", meta: "cohere · top 8" },
  { id: "s7",  name: "llm.reason",         kind: "llm",      startMs: 1280, durMs: 960,  status: "ok", parent: "s1", meta: "claude-sonnet-4-6 · 2,140 tok" },
  { id: "s8",  name: "tool.web_search",    kind: "tool",     startMs: 2260, durMs: 540,  status: "ok", parent: "s1", meta: "query: 'nvda guidance 2026'" },
  { id: "s9",  name: "llm.synthesize",     kind: "llm",      startMs: 2820, durMs: 600,  status: "ok", parent: "s1", meta: "claude-sonnet-4-6 · 1,840 tok" },
];

const KIND_META: Record<Span["kind"], { icon: LucideIcon; color: string }> = {
  llm:      { icon: Brain,   color: "bg-info/80" },
  tool:     { icon: Wrench,  color: "bg-warn/80" },
  retrieve: { icon: Database, color: "bg-brand/80" },
  rerank:   { icon: Zap,     color: "bg-success/80" },
  agent:    { icon: Cpu,     color: "bg-fg-muted" },
};

export default function TracesPage() {
  const [selected, setSelected] = useState<string>("tr_01");
  const [q, setQ] = useState("");

  const current = TRACES.find((t) => t.id === selected) ?? TRACES[0]!;
  const filtered = TRACES.filter((t) => !q || t.input.toLowerCase().includes(q.toLowerCase()));
  const maxMs = Math.max(...SAMPLE_SPANS.map((s) => s.startMs + s.durMs));

  return (
    <div>
      <PageHeader
        title="Traces"
        description="Deep-dive every agent run — LLM calls, tool invocations, retrieval spans, and timing."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Traces (24h)"   value="1,247" icon={Network} delta={{ value: "+8%", positive: true }} />
        <Stat label="Error rate"     value="2.4%"  icon={AlertCircle} delta={{ value: "-0.6%", positive: true }} />
        <Stat label="Avg duration"   value="2.8s"  icon={Clock} />
        <Stat label="P95 duration"   value="6.1s"  icon={Clock} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Trace list */}
        <div className="lg:col-span-5">
          <Card>
            <div className="p-3 border-b border-border flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
                <Input placeholder="Search traces…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
              </div>
              <Select defaultValue="all">
                <SelectTrigger className="w-28 h-9 text-xs"><Filter className="h-3 w-3 text-fg-subtle" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="errors">Errors only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ul className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {filtered.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelected(t.id)}
                    className={cn(
                      "w-full px-4 py-3 flex items-start gap-3 hover:bg-bg-hover transition-colors text-left",
                      selected === t.id && "bg-bg-hover border-l-2 border-brand",
                    )}
                  >
                    <div className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", t.status === "ok" ? "bg-success" : "bg-danger")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{t.input}</span>
                      </div>
                      <div className="flex items-center gap-3 text-2xs text-fg-subtle mt-0.5">
                        <span>{t.agent}</span>
                        <span className="font-mono">{t.totalMs}ms</span>
                        <span className="font-mono">{t.spans} spans</span>
                      </div>
                    </div>
                    <div className="text-2xs text-fg-subtle shrink-0 text-right">
                      <div>{formatDistanceToNow(new Date(t.ts), { addSuffix: true })}</div>
                      <div className="font-mono">${t.cost.toFixed(4)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Waterfall */}
        <div className="lg:col-span-7">
          <Card>
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold tracking-tight truncate">{current.input}</h3>
                  <div className="flex items-center gap-3 text-2xs text-fg-subtle mt-0.5 font-mono">
                    <span>{current.id}</span>
                    <span>{current.totalMs}ms total</span>
                    <span>${current.cost.toFixed(4)}</span>
                  </div>
                </div>
                <Badge tone={current.status === "ok" ? "success" : "danger"} dot>{current.status}</Badge>
              </div>
            </div>

            <div className="p-5">
              <div className="space-y-1">
                {SAMPLE_SPANS.map((s) => {
                  const depth = s.parent ? (s.parent === "s3" ? 2 : 1) : 0;
                  const leftPct = (s.startMs / maxMs) * 100;
                  const widthPct = Math.max(0.5, (s.durMs / maxMs) * 100);
                  const meta = KIND_META[s.kind];
                  const Icon = meta.icon;
                  return (
                    <div key={s.id} className="group grid grid-cols-[280px_1fr] gap-3 items-center py-1 hover:bg-bg-hover rounded-md px-2 transition-colors">
                      <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
                        {depth > 0 && <ChevronRight className="h-3 w-3 text-fg-subtle shrink-0" />}
                        <Icon className="h-3 w-3 text-fg-muted shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-mono truncate">{s.name}</div>
                          {s.meta && <div className="text-2xs text-fg-subtle truncate">{s.meta}</div>}
                        </div>
                      </div>
                      <div className="relative h-6 bg-bg-muted rounded">
                        <div
                          className={`absolute top-0 bottom-0 rounded ${meta.color} flex items-center justify-end px-1.5 text-2xs font-mono text-white shadow-sm transition-all hover:brightness-110`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        >
                          {s.durMs > 300 && `${s.durMs}ms`}
                        </div>
                        {s.durMs <= 300 && (
                          <span className="absolute text-2xs text-fg-subtle font-mono" style={{ left: `calc(${leftPct + widthPct}% + 4px)`, top: 4 }}>
                            {s.durMs}ms
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-border grid grid-cols-5 gap-3 text-2xs text-fg-subtle">
                {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                  <div key={p} className="text-right font-mono">{Math.round(maxMs * p)}ms</div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-4 flex items-center flex-wrap gap-3 text-2xs">
                {(Object.entries(KIND_META) as [Span["kind"], typeof KIND_META[Span["kind"]]][]).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className={cn("h-2.5 w-2.5 rounded-sm", v.color)} />
                    <span className="text-fg-muted">{k}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
