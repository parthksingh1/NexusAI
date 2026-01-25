"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type Agent } from "@/lib/api";
import {
  Bot, Plus, Wrench, Search, LayoutGrid, List, Filter, SortAsc, MoreHorizontal, Play,
  Archive, Copy, Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { NewAgentDialog } from "@/components/new-agent-dialog";
import { PageHeader } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/cn";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<"updated" | "name" | "created">("updated");
  const [view, setView] = useState<"grid" | "list">("grid");

  async function refresh() { const d = await api.listAgents(); setAgents(d.agents); }
  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    if (!agents) return [];
    let out = agents;
    if (status !== "all") out = out.filter((a) => a.status === status);
    if (q) {
      const s = q.toLowerCase();
      out = out.filter((a) => a.name.toLowerCase().includes(s) || a.goal.toLowerCase().includes(s));
    }
    if (sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "created") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    else out = [...out].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    return out;
  }, [agents, q, status, sort]);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Create, configure, and run your autonomous agents."
        actions={<Button onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>New agent</Button>}
      />

      {/* Filters bar */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <Input placeholder="Search agents…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><Filter className="h-3.5 w-3.5 text-fg-subtle" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="IDLE">Idle</SelectItem>
            <SelectItem value="RUNNING">Running</SelectItem>
            <SelectItem value="PAUSED">Paused</SelectItem>
            <SelectItem value="ERROR">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="w-40"><SortAsc className="h-3.5 w-3.5 text-fg-subtle" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="created">Newest first</SelectItem>
            <SelectItem value="name">Name (A→Z)</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto inline-flex items-center rounded-md border border-border bg-bg-elevated p-0.5">
          <button onClick={() => setView("grid")} className={cn("p-1.5 rounded transition-colors", view === "grid" ? "bg-bg-hover text-fg" : "text-fg-subtle hover:text-fg")}>
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setView("list")} className={cn("p-1.5 rounded transition-colors", view === "list" ? "bg-bg-hover text-fg" : "text-fg-subtle hover:text-fg")}>
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {agents === null ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : filtered.length === 0 ? (
        agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            description="Create your first autonomous agent. Pick tools, set a persona, and run it."
            action={<Button onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Create your first agent</Button>}
          />
        ) : (
          <EmptyState icon={Search} title="No matches" description="Try adjusting your filters or search." />
        )
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((a) => <AgentCard key={a.id} agent={a} />)}
        </div>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {filtered.map((a) => <AgentRow key={a.id} agent={a} />)}
          </ul>
        </Card>
      )}

      <NewAgentDialog open={open} onOpenChange={setOpen} onCreated={() => void refresh()} />
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Card interactive className="p-5 h-full flex flex-col group relative">
      <div className="flex items-start justify-between gap-3 mb-3">
        <Link href={`/agents/${agent.id}`} className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="h-9 w-9 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-brand" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold tracking-tight truncate">{agent.name}</div>
            <div className="text-2xs text-fg-subtle mt-0.5">Updated {formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })}</div>
          </div>
        </Link>
        <AgentMenu agent={agent} />
      </div>
      <Link href={`/agents/${agent.id}`} className="flex-1">
        <p className="text-sm text-fg-muted line-clamp-3 leading-relaxed">{agent.goal}</p>
      </Link>
      <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-border">
        <div className="flex items-center gap-1.5 text-2xs text-fg-subtle min-w-0">
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="truncate">{agent.tools.slice(0, 3).join(", ") || "No tools"}</span>
          {agent.tools.length > 3 && <span>+{agent.tools.length - 3}</span>}
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>
    </Card>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  return (
    <li className="px-4 py-3 flex items-center gap-4 hover:bg-bg-hover transition-colors">
      <Link href={`/agents/${agent.id}`} className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-8 w-8 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{agent.name}</span>
            <AgentStatusBadge status={agent.status} />
          </div>
          <div className="text-xs text-fg-muted truncate">{agent.goal}</div>
        </div>
      </Link>
      <div className="hidden md:flex items-center gap-1 text-2xs text-fg-subtle">
        <Wrench className="h-3 w-3" /> {agent.tools.length} tool{agent.tools.length !== 1 && "s"}
      </div>
      <div className="text-2xs text-fg-subtle font-mono w-28 text-right hidden md:block">
        {formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })}
      </div>
      <AgentMenu agent={agent} />
    </li>
  );
}

function AgentMenu({ agent }: { agent: Agent }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem asChild>
          <Link href={`/agents/${agent.id}`}><Play className="h-3.5 w-3.5" />Open & run</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(agent.id); toast.success("Agent ID copied"); }}>
          <Copy className="h-3.5 w-3.5" />Copy agent ID
        </DropdownMenuItem>
        <DropdownMenuItem><Archive className="h-3.5 w-3.5" />Archive</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentStatusBadge({ status }: { status: Agent["status"] }) {
  const m: Record<Agent["status"], { tone: "neutral" | "success" | "warn" | "danger"; pulse: boolean; label: string }> = {
    IDLE:    { tone: "neutral", pulse: false, label: "Idle" },
    RUNNING: { tone: "success", pulse: true,  label: "Running" },
    PAUSED:  { tone: "warn",    pulse: false, label: "Paused" },
    STOPPED: { tone: "neutral", pulse: false, label: "Stopped" },
    ERROR:   { tone: "danger",  pulse: false, label: "Error" },
  };
  const c = m[status];
  return <Badge tone={c.tone} dot pulse={c.pulse} size="sm">{c.label}</Badge>;
}
