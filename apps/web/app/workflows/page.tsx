"use client";

import Link from "next/link";
import { useState } from "react";
import { Workflow, Plus, Play, Copy, Clock, Zap, GitBranch, MoreHorizontal, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown";

type Flow = {
  id: string; name: string; description: string; nodes: number; edges: number;
  status: "draft" | "active" | "paused"; lastRun?: string; runsTotal: number; author: string;
};

const MOCK: Flow[] = [
  { id: "wf_1", name: "Customer feedback pipeline",  description: "Classify → route → respond with KB citation.", nodes: 8, edges: 9,  status: "active", lastRun: new Date(Date.now() - 15 * 60_000).toISOString(), runsTotal: 184, author: "Alex Chen" },
  { id: "wf_2", name: "Morning market briefing",      description: "Fetch news → analyze → summarize → email to subs.",   nodes: 6, edges: 5,  status: "active", lastRun: new Date(Date.now() - 3 * 3600_000).toISOString(), runsTotal: 62,  author: "Demo User" },
  { id: "wf_3", name: "GitHub issue triage",          description: "Label → assign → detect duplicates.",                  nodes: 5, edges: 4,  status: "paused", lastRun: new Date(Date.now() - 24 * 3600_000).toISOString(), runsTotal: 412, author: "Priya Rao" },
  { id: "wf_4", name: "Onboarding email generator",   description: "Persona → draft → review → send.",                     nodes: 4, edges: 3,  status: "draft",  runsTotal: 0, author: "Demo User" },
  { id: "wf_5", name: "Competitive intel sweep",      description: "Research competitor launches, summarize weekly.",     nodes: 11, edges: 12, status: "active", lastRun: new Date(Date.now() - 7 * 3600_000).toISOString(), runsTotal: 21,  author: "Marcus Lee" },
];

export default function WorkflowsPage() {
  const [q, setQ] = useState("");
  const flows = MOCK.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()));

  const active = MOCK.filter((f) => f.status === "active").length;
  const totalRuns = MOCK.reduce((a, b) => a + b.runsTotal, 0);

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Chain agents into multi-step pipelines with branches, loops, and conditions."
        actions={
          <Button leftIcon={<Plus className="h-3.5 w-3.5" />} asChild>
            <Link href="/workflows/new">New workflow</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Workflows"   icon={Workflow}   value={MOCK.length} />
        <Stat label="Active"       icon={Zap}        value={active} />
        <Stat label="Runs (30d)"   icon={Play}       value={totalRuns.toLocaleString()} />
        <Stat label="Avg steps"    icon={GitBranch}  value={(MOCK.reduce((a, b) => a + b.nodes, 0) / MOCK.length).toFixed(1)} />
      </div>

      <div className="mb-4">
        <Input placeholder="Search workflows…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
      </div>

      {flows.length === 0 ? (
        <EmptyState icon={Workflow} title="No workflows" description="Create your first multi-agent pipeline." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {flows.map((f) => (
            <Card key={f.id} interactive className="p-5 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <Link href={`/workflows/${f.id}`} className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="h-9 w-9 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
                    <Workflow className="h-4 w-4 text-brand" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold tracking-tight truncate">{f.name}</div>
                    <div className="text-2xs text-fg-subtle">by {f.author}</div>
                  </div>
                </Link>
                <StatusBadge status={f.status} />
              </div>
              <Link href={`/workflows/${f.id}`} className="flex-1">
                <p className="text-sm text-fg-muted line-clamp-2 leading-relaxed">{f.description}</p>
              </Link>
              <div className="mt-4 flex items-center justify-between pt-3 border-t border-border gap-2">
                <div className="flex items-center gap-3 text-2xs text-fg-subtle">
                  <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{f.nodes} nodes</span>
                  <span>{f.runsTotal.toLocaleString()} runs</span>
                  {f.lastRun && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDistanceToNow(new Date(f.lastRun), { addSuffix: true })}</span>}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => toast.success("Triggered")}><Play className="h-3.5 w-3.5" />Run now</DropdownMenuItem>
                    <DropdownMenuItem><Copy className="h-3.5 w-3.5" />Duplicate</DropdownMenuItem>
                    <DropdownMenuItem className="text-danger"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Flow["status"] }) {
  const m = {
    active: { tone: "success" as const, label: "Active", pulse: true },
    paused: { tone: "warn" as const,    label: "Paused", pulse: false },
    draft:  { tone: "neutral" as const, label: "Draft",  pulse: false },
  }[status];
  return <Badge tone={m.tone} dot pulse={m.pulse} size="sm">{m.label}</Badge>;
}
