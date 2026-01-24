"use client";

import { useEffect, useState, useMemo } from "react";
import { formatDistanceToNow, format } from "date-fns";
import {
  Play, CheckCircle2, XCircle, AlertCircle, Plus, Wrench, Clock,
  Search, Download, Filter,
} from "lucide-react";
import { api, type ActivityEvent } from "@/lib/api";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";

const TYPE_LABELS: Record<ActivityEvent["type"], string> = {
  "run.started":       "Run started",
  "run.succeeded":     "Run succeeded",
  "run.failed":        "Run failed",
  "agent.created":     "Agent created",
  "approval.required": "Approval required",
  "tool.invoked":      "Tool invoked",
};

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");

  useEffect(() => { api.activity().then((d) => setEvents(d.events)); }, []);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (type !== "all" && e.type !== type) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return e.message.toLowerCase().includes(s) || (e.agentName ?? "").toLowerCase().includes(s);
    });
  }, [events, q, type]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts;
  }, [events]);

  return (
    <div>
      <PageHeader
        title="Activity log"
        description="Every event across your NexusAI deployment — runs, tools, agents, approvals."
        actions={<Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export JSON</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="Total events"      value={events.length} icon={Clock} />
        <Stat label="Runs succeeded"    value={stats["run.succeeded"] ?? 0} icon={CheckCircle2} />
        <Stat label="Runs failed"       value={stats["run.failed"] ?? 0} icon={XCircle} />
        <Stat label="Approvals needed"  value={stats["approval.required"] ?? 0} icon={AlertCircle} />
        <Stat label="Tool invocations"  value={stats["tool.invoked"] ?? 0} icon={Wrench} />
      </div>

      <Card className="mb-4">
        <div className="p-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
            <Input placeholder="Search events, agents…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-48">
              <Filter className="h-3.5 w-3.5 text-fg-subtle" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-fg-subtle">No events match your filters.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((e) => (
              <li key={e.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover transition-colors">
                <ActivityIcon type={e.type} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{TYPE_LABELS[e.type]}</span>
                    {e.agentName && <Badge tone="brand" size="sm">{e.agentName}</Badge>}
                  </div>
                  <div className="text-xs text-fg-muted mt-0.5 truncate">{e.message}</div>
                </div>
                <div className="text-2xs text-fg-subtle text-right shrink-0">
                  <div className="font-mono">{format(new Date(e.ts), "HH:mm:ss")}</div>
                  <div className="text-fg-subtle">{formatDistanceToNow(new Date(e.ts), { addSuffix: true })}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 text-2xs text-fg-subtle text-center">
        Events are retained for 90 days on Pro, 365 days on Team, and unlimited on Enterprise.
      </div>
    </div>
  );
}

function ActivityIcon({ type }: { type: ActivityEvent["type"] }) {
  const m = {
    "run.started":       { Icon: Play,         color: "text-info bg-info/10 border-info/20" },
    "run.succeeded":     { Icon: CheckCircle2, color: "text-success bg-success/10 border-success/20" },
    "run.failed":        { Icon: XCircle,      color: "text-danger bg-danger/10 border-danger/20" },
    "agent.created":     { Icon: Plus,         color: "text-brand bg-brand-muted border-brand-border" },
    "approval.required": { Icon: AlertCircle,  color: "text-warn bg-warn/10 border-warn/20" },
    "tool.invoked":      { Icon: Wrench,       color: "text-fg-muted bg-bg-muted border-border" },
  }[type] ?? { Icon: Clock, color: "text-fg-muted bg-bg-muted border-border" };
  return (
    <div className={`h-8 w-8 rounded-md border flex items-center justify-center shrink-0 ${m.color}`}>
      <m.Icon className="h-3.5 w-3.5" />
    </div>
  );
}
