"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { api, type Agent, type AgentRun } from "@/lib/api";
import { RunConsole } from "@/components/run-console";
import {
  ArrowLeft, Play, Bot, Wrench, Clock, Coins, Pencil, Copy, Archive,
  BrainCircuit, Cpu, Activity, AlertCircle, CheckCircle2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea, Input, Label } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Stat } from "@/components/ui/stat";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<(Agent & { runs: AgentRun[] }) | null>(null);
  const [input, setInput] = useState("Summarize today's top AI news with sources and a short outlook.");
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function load() { setAgent(await api.getAgent(id)); }
  useEffect(() => { void load(); }, [id]);

  async function startRun() {
    if (!agent) return;
    setStarting(true);
    try {
      const { runId } = await api.startRun(agent.id, input, 12);
      setRunId(runId);
      toast.success("Run started");
      void load();
    } catch {
      toast.info("Backend offline — showing demo data only");
    } finally {
      setStarting(false);
    }
  }

  if (!agent) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  const runs = agent.runs ?? [];
  const succeeded = runs.filter((r) => r.status === "SUCCEEDED").length;
  const totalTokens = runs.reduce((a, b) => a + (b.totalTokens || 0), 0);
  const totalCost = runs.reduce((a, b) => a + Number(b.totalCostUsd || 0), 0);
  const successRate = runs.length ? (succeeded / runs.length) * 100 : 0;

  return (
    <div>
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg mb-6 transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back to agents
      </Link>

      <PageHeader
        title={agent.name}
        description={agent.goal}
        actions={
          <div className="flex items-center gap-2">
            <AgentStatus status={agent.status} />
            <Button variant="secondary" size="sm" leftIcon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
            <Button variant="ghost" size="icon-sm"><Copy className="h-3.5 w-3.5" /></Button>
          </div>
        }
      />

      <Tabs defaultValue="run">
        <TabsList>
          <TabsTrigger value="run"><Play className="h-3.5 w-3.5 mr-1.5" />Run</TabsTrigger>
          <TabsTrigger value="history"><Clock className="h-3.5 w-3.5 mr-1.5" />History</TabsTrigger>
          <TabsTrigger value="config"><BrainCircuit className="h-3.5 w-3.5 mr-1.5" />Configuration</TabsTrigger>
          <TabsTrigger value="memory"><Cpu className="h-3.5 w-3.5 mr-1.5" />Memory</TabsTrigger>
          <TabsTrigger value="metrics"><Activity className="h-3.5 w-3.5 mr-1.5" />Metrics</TabsTrigger>
        </TabsList>

        {/* ─── Run tab ──────────────────────────────────────── */}
        <TabsContent value="run">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            <Card className="p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-2xs text-fg-subtle uppercase tracking-wider font-semibold mb-2">
                <Bot className="h-3 w-3" /> Persona
              </div>
              <p className="text-sm font-medium">{agent.persona.name}</p>
              <p className="text-xs text-fg-muted mt-1">{agent.persona.description || "No description set."}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-2xs text-fg-subtle uppercase tracking-wider font-semibold mb-2">
                <Wrench className="h-3 w-3" /> Tools
              </div>
              <div className="flex flex-wrap gap-1">
                {agent.tools.length === 0 && <span className="text-xs text-fg-subtle">No tools assigned</span>}
                {agent.tools.map((t) => (<Badge key={t} size="sm">{t}</Badge>))}
              </div>
            </Card>
          </div>

          <Card className="p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold tracking-tight">Start a new run</h2>
                <p className="text-xs text-fg-muted mt-0.5">Reason, act, observe — streamed live below.</p>
              </div>
            </div>
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder="What should the agent do?" />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-2xs text-fg-subtle">
                Press <kbd className="font-mono text-2xs px-1 py-0.5 rounded bg-bg-muted border border-border">⌘</kbd>
                <kbd className="font-mono ml-0.5 text-2xs px-1 py-0.5 rounded bg-bg-muted border border-border">Enter</kbd> to run
              </div>
              <Button onClick={startRun} loading={starting} disabled={!input.trim()} leftIcon={<Play className="h-3.5 w-3.5" />}>Run agent</Button>
            </div>
          </Card>

          {runId && <RunConsole runId={runId} />}
        </TabsContent>

        {/* ─── History tab ──────────────────────────────────── */}
        <TabsContent value="history">
          <Card>
            {runs.length === 0 ? (
              <div className="py-16 text-center text-sm text-fg-subtle">No runs yet. Head to the Run tab to start one.</div>
            ) : (
              <ul className="divide-y divide-border">
                {runs.map((r) => (
                  <li key={r.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover transition-colors">
                    <RunIcon status={r.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{r.input}</div>
                      <div className="flex items-center gap-4 text-2xs text-fg-subtle mt-0.5 flex-wrap">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(r.startedAt), { addSuffix: true })}</span>
                        <span>{r.totalTokens.toLocaleString()} tokens</span>
                        <span className="inline-flex items-center gap-1"><Coins className="h-3 w-3" />${Number(r.totalCostUsd).toFixed(4)}</span>
                      </div>
                    </div>
                    <RunStatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        {/* ─── Config tab ───────────────────────────────────── */}
        <TabsContent value="config">
          <Card className="p-6">
            <h3 className="font-semibold tracking-tight mb-1">Persona & system prompt</h3>
            <p className="text-xs text-fg-muted mb-5">Defines how this agent behaves.</p>
            <div className="space-y-4">
              <div>
                <Label>Display name</Label>
                <Input defaultValue={agent.name} />
              </div>
              <div>
                <Label>Goal</Label>
                <Textarea rows={2} defaultValue={agent.goal} />
              </div>
              <div>
                <Label>System prompt</Label>
                <Textarea rows={6} defaultValue={agent.persona.systemPrompt || "You are a helpful autonomous agent. Always cite your sources."} className="font-mono text-xs" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost">Discard</Button>
              <Button onClick={() => toast.success("Configuration saved")}>Save changes</Button>
            </div>
          </Card>

          <Card className="p-6 mt-4 border-danger/30">
            <h3 className="font-semibold tracking-tight mb-1 text-danger">Danger zone</h3>
            <p className="text-xs text-fg-muted mb-4">Irreversible operations for this agent.</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-md border border-border">
                <div>
                  <div className="text-sm font-medium">Archive agent</div>
                  <div className="text-xs text-fg-muted">Stop runs, keep history. Can be restored.</div>
                </div>
                <Button variant="secondary" size="sm" leftIcon={<Archive className="h-3.5 w-3.5" />}>Archive</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-md border border-danger/30 bg-danger/5">
                <div>
                  <div className="text-sm font-medium text-danger">Delete agent</div>
                  <div className="text-xs text-fg-muted">Permanently delete this agent and all its run history.</div>
                </div>
                <Button variant="danger" size="sm">Delete</Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ─── Memory tab ───────────────────────────────────── */}
        <TabsContent value="memory">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <MemoryStat label="Episodic"   count={24} desc="Run outcomes" />
            <MemoryStat label="Semantic"   count={87} desc="Facts learned" />
            <MemoryStat label="Procedural" count={5}  desc="Reusable skills" />
            <MemoryStat label="Reflection" count={12} desc="Self-critique" />
          </div>
          <Card className="p-6 bg-bg-subtle">
            <div className="text-sm text-fg-muted leading-relaxed max-w-2xl">
              Memory is dual-written to <span className="font-mono text-xs bg-bg-muted px-1 py-0.5 rounded">AgentMemory</span> in Postgres
              (with pgvector embeddings) and to Neo4j as <span className="font-mono text-xs bg-bg-muted px-1 py-0.5 rounded">Memory</span>
              nodes. The reflection loop promotes high-importance wins to procedural skills for future runs.
            </div>
          </Card>
        </TabsContent>

        {/* ─── Metrics tab ──────────────────────────────────── */}
        <TabsContent value="metrics">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Total runs"   icon={Activity}   value={runs.length} />
            <Stat label="Success rate" icon={CheckCircle2} value={`${successRate.toFixed(0)}%`} delta={{ value: "+4%", positive: true }} />
            <Stat label="Tokens used"  icon={Cpu}        value={totalTokens.toLocaleString()} />
            <Stat label="Spend total"  icon={Coins}      value={`$${totalCost.toFixed(4)}`} />
          </div>
          <Card className="p-6 bg-bg-subtle">
            <div className="text-sm text-fg-muted">
              Per-agent cost, latency percentiles, and tool breakdowns come from ClickHouse. See the global <Link href="/metrics" className="text-brand hover:underline">Metrics page</Link> for a cross-agent view.
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AgentStatus({ status }: { status: Agent["status"] }) {
  const m = {
    IDLE:    { tone: "neutral" as const, label: "Idle",    pulse: false },
    RUNNING: { tone: "success" as const, label: "Running", pulse: true },
    PAUSED:  { tone: "warn" as const,    label: "Paused",  pulse: false },
    STOPPED: { tone: "neutral" as const, label: "Stopped", pulse: false },
    ERROR:   { tone: "danger" as const,  label: "Error",   pulse: false },
  }[status];
  return <Badge tone={m.tone} dot pulse={m.pulse}>{m.label}</Badge>;
}

function RunStatusPill({ status }: { status: AgentRun["status"] }) {
  const m: Record<AgentRun["status"], { tone: "neutral" | "success" | "warn" | "danger"; label: string; pulse: boolean }> = {
    QUEUED:    { tone: "neutral", label: "Queued",    pulse: false },
    RUNNING:   { tone: "success", label: "Running",   pulse: true },
    SUCCEEDED: { tone: "success", label: "Succeeded", pulse: false },
    FAILED:    { tone: "danger",  label: "Failed",    pulse: false },
    CANCELLED: { tone: "warn",    label: "Cancelled", pulse: false },
  };
  const c = m[status];
  return <Badge tone={c.tone} dot pulse={c.pulse} size="sm">{c.label}</Badge>;
}

function RunIcon({ status }: { status: AgentRun["status"] }) {
  const m = {
    SUCCEEDED: { Icon: CheckCircle2, color: "text-success bg-success/10 border-success/20" },
    FAILED:    { Icon: XCircle,      color: "text-danger bg-danger/10 border-danger/20" },
    RUNNING:   { Icon: Play,         color: "text-info bg-info/10 border-info/20" },
    QUEUED:    { Icon: Clock,        color: "text-fg-muted bg-bg-muted border-border" },
    CANCELLED: { Icon: AlertCircle,  color: "text-warn bg-warn/10 border-warn/20" },
  }[status] ?? { Icon: Clock, color: "text-fg-muted bg-bg-muted border-border" };
  return (
    <div className={`h-8 w-8 rounded-md border flex items-center justify-center shrink-0 ${m.color}`}>
      <m.Icon className="h-3.5 w-3.5" />
    </div>
  );
}

function MemoryStat({ label, count, desc }: { label: string; count: number; desc: string }) {
  return (
    <Card className="p-4">
      <div className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tighter">{count}</div>
      <div className="text-2xs text-fg-subtle mt-0.5">{desc}</div>
    </Card>
  );
}
