"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Bot, ArrowRight, Plus, Zap, Activity, DollarSign, TrendingUp,
  CheckCircle2, XCircle, AlertCircle, Play, Clock, Wrench, ShieldAlert,
  Code2, Database, Network, Cpu, LineChart as LineIcon,
  type LucideIcon,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from "recharts";
import { api, type Agent, type ActivityEvent } from "@/lib/api";
import { Stat } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/section";

export default function OverviewPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [cost, setCost] = useState<{ day: string; cost: number }[]>([]);

  useEffect(() => {
    void Promise.all([
      api.listAgents().then((d) => setAgents(d.agents)),
      api.activity().then((d) => setActivity(d.events)),
      api.costByDay(14).then((d) => setCost(d.series.map((r) => ({ day: r.day.slice(5), cost: Number(r.cost) })))),
    ]);
  }, []);

  const active = agents.filter((a) => a.status === "RUNNING").length;
  const totalCost = cost.reduce((a, b) => a + b.cost, 0);
  const avgCost = cost.length ? totalCost / cost.length : 0;

  return (
    <div className="space-y-8">
      {/* Hero — cleaner, no big gradient blob */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-bg-subtle">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="relative p-7 md:p-9">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="max-w-2xl">
              <Badge tone="success" dot size="sm" className="mb-3">
                <span>Everything operational</span>
              </Badge>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tightest">
                Welcome back to <span className="text-gradient-brand">NexusAI</span>.
              </h1>
              <p className="mt-3 text-[15px] text-fg-muted max-w-xl leading-relaxed">
                {active > 0
                  ? `${active} agent${active > 1 ? "s are" : " is"} currently running. Spend this period is on track.`
                  : "No agents running right now. Start one to pick up where you left off."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                  <Link href="/agents">View agents</Link>
                </Button>
                <Button variant="secondary" asChild leftIcon={<Plus className="h-3.5 w-3.5" />}>
                  <Link href="/agents?new=1">New agent</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/playground">Open playground →</Link>
                </Button>
              </div>
            </div>

            {/* Mini chart */}
            <div className="w-full lg:w-[360px] rounded-lg border border-border bg-bg-elevated p-4">
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wider font-semibold text-fg-muted">Spend · 14 days</span>
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <TrendingUp className="h-3 w-3" /> +12%
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tracking-tighter">${totalCost.toFixed(4)}</div>
              <div className="h-16 -mx-2 mt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cost}>
                    <defs>
                      <linearGradient id="heroArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="hsl(var(--brand))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" hide />
                    <YAxis hide />
                    <ReTooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(4)}`, "cost"]} />
                    <Area dataKey="cost" stroke="hsl(var(--brand))" strokeWidth={1.8} fill="url(#heroArea)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="text-2xs text-fg-subtle">Avg ${avgCost.toFixed(4)}/day · under monthly cap</div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Active agents" icon={Bot}       value={`${active} / ${agents.length}`} hint={`${agents.length} total`} />
          <Stat label="Runs today"    icon={Activity}  value="47" delta={{ value: "+18%", positive: true }} />
          <Stat label="Tokens (24h)"  icon={Zap}       value="284k" delta={{ value: "+6%",  positive: true }} />
          <Stat label="Spend (24h)"   icon={DollarSign} value="$0.82" hint="3% of monthly cap" />
        </div>
      </section>

      {/* Main grid: agent state + recent activity */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: recent agents */}
        <div className="lg:col-span-2">
          <SectionHeader
            title="Your agents"
            description="Recently updated"
            actions={<Button variant="ghost" size="sm" asChild><Link href="/agents">View all →</Link></Button>}
          />
          <Card>
            <ul className="divide-y divide-border">
              {agents.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link href={`/agents/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
                    <div className="h-8 w-8 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-brand" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{a.name}</span>
                        <AgentStatusBadge status={a.status} />
                      </div>
                      <div className="flex items-center gap-1.5 text-2xs text-fg-subtle mt-0.5">
                        <Wrench className="h-3 w-3" />
                        <span className="truncate">{a.tools.slice(0, 3).join(", ")}</span>
                      </div>
                    </div>
                    <div className="text-2xs text-fg-subtle text-right shrink-0">
                      <div>Updated</div>
                      <div className="font-mono">{formatDistanceToNow(new Date(a.updatedAt), { addSuffix: true })}</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-fg-subtle group-hover:text-fg group-hover:translate-x-0.5 transition-all" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Right: activity feed */}
        <div>
          <SectionHeader title="Recent activity" />
          <Card>
            <ul className="divide-y divide-border">
              {activity.slice(0, 8).map((e) => (
                <li key={e.id} className="px-4 py-3 flex items-start gap-3">
                  <ActivityIcon type={e.type} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs">
                      {e.agentName && <span className="font-medium">{e.agentName}</span>}{" "}
                      <span className="text-fg-muted">{e.message}</span>
                    </div>
                    <div className="text-2xs text-fg-subtle mt-0.5">{formatDistanceToNow(new Date(e.ts), { addSuffix: true })}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* System health */}
      <section>
        <SectionHeader title="System health" description="Live status across NexusAI services." />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <HealthCard label="Orchestrator" latency="18 ms" healthy icon={Cpu} />
          <HealthCard label="RAG service"  latency="42 ms" healthy icon={Network} />
          <HealthCard label="Sandbox"      latency="11 ms" healthy icon={Code2} />
          <HealthCard label="ClickHouse"   latency="64 ms" healthy icon={Database} />
        </div>
      </section>

      {/* Budget */}
      <section>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold tracking-tight">Monthly budget</h3>
              <p className="text-xs text-fg-muted mt-0.5">Usage across all agents</p>
            </div>
            <Link href="/billing" className="text-xs text-brand hover:underline">Manage plan →</Link>
          </div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tighter">$12.47</span>
              <span className="text-sm text-fg-muted">of $50 cap</span>
            </div>
            <span className="text-xs text-fg-muted">25%</span>
          </div>
          <Progress value={25} />
          <div className="flex items-center justify-between mt-3 text-2xs text-fg-subtle">
            <span>Resets in 18 days</span>
            <span>Estimated end-of-month: ~$32</span>
          </div>
        </Card>
      </section>

      {/* Capabilities grid */}
      <section>
        <SectionHeader title="Capabilities" description="Everything NexusAI ships with." />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Cap icon={Bot}        title="Autonomous agents"   desc="Multi-step ReAct loops with tool use, collaboration, and persistent memory." />
          <Cap icon={Network}    title="Hybrid RAG"          desc="Dense + sparse retrieval, HyDE, cross-encoder rerank, citation-grounded answers." />
          <Cap icon={Code2}      title="Sandbox execution"   desc="Run Python, Node, Bash in isolated Docker containers with gVisor support." />
          <Cap icon={Activity}   title="Real-time streams"   desc="Ingest crypto, news, weather. Detect anomalies. Fire alerts in ms." />
          <Cap icon={ShieldAlert} title="Safety by default"  desc="Tool risk scoring, blocked-pattern filters, human-in-the-loop approvals." />
          <Cap icon={LineIcon}   title="Full observability"  desc="Prometheus, OpenTelemetry, ClickHouse — every call, step, and dollar tracked." />
        </div>
      </section>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "hsl(var(--bg-elevated))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--fg))",
};

function AgentStatusBadge({ status }: { status: Agent["status"] }) {
  const m: Record<Agent["status"], { tone: "neutral" | "success" | "warn" | "danger"; label: string; pulse: boolean }> = {
    IDLE:    { tone: "neutral", label: "Idle",     pulse: false },
    RUNNING: { tone: "success", label: "Running",  pulse: true },
    PAUSED:  { tone: "warn",    label: "Paused",   pulse: false },
    STOPPED: { tone: "neutral", label: "Stopped",  pulse: false },
    ERROR:   { tone: "danger",  label: "Error",    pulse: false },
  };
  const c = m[status];
  return <Badge tone={c.tone} dot pulse={c.pulse} size="sm">{c.label}</Badge>;
}

function ActivityIcon({ type }: { type: ActivityEvent["type"] }) {
  const m = {
    "run.started":       { Icon: Play,          color: "text-info bg-info/10 border-info/20" },
    "run.succeeded":     { Icon: CheckCircle2,  color: "text-success bg-success/10 border-success/20" },
    "run.failed":        { Icon: XCircle,       color: "text-danger bg-danger/10 border-danger/20" },
    "agent.created":     { Icon: Plus,          color: "text-brand bg-brand-muted border-brand-border" },
    "approval.required": { Icon: AlertCircle,   color: "text-warn bg-warn/10 border-warn/20" },
    "tool.invoked":      { Icon: Wrench,        color: "text-fg-muted bg-bg-muted border-border" },
  }[type] ?? { Icon: Clock, color: "text-fg-muted bg-bg-muted border-border" };
  return (
    <div className={`h-6 w-6 rounded-md border flex items-center justify-center shrink-0 ${m.color}`}>
      <m.Icon className="h-3 w-3" />
    </div>
  );
}

function HealthCard({
  label, latency, healthy, icon: Icon,
}: { label: string; latency: string; healthy: boolean; icon: LucideIcon }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-bg-muted border border-border flex items-center justify-center">
            <Icon className="h-3.5 w-3.5 text-fg-muted" />
          </div>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Badge tone={healthy ? "success" : "danger"} size="sm" dot pulse={healthy}>
          {healthy ? "Healthy" : "Down"}
        </Badge>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tracking-tighter font-mono">{latency}</span>
        <span className="text-2xs text-fg-subtle">p50 latency</span>
      </div>
    </Card>
  );
}

function Cap({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <Card className="p-5 shine">
      <div className="h-9 w-9 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center mb-3">
        <Icon className="h-4 w-4 text-brand" strokeWidth={2.25} />
      </div>
      <h3 className="font-semibold tracking-tight text-sm">{title}</h3>
      <p className="mt-1 text-sm text-fg-muted leading-relaxed">{desc}</p>
    </Card>
  );
}
