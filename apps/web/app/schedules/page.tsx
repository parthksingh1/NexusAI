"use client";

import { useState } from "react";
import { Calendar, Plus, Play, Pause, Clock, CheckCircle2, XCircle, MoreHorizontal, Trash2, Edit } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { Switch } from "@/components/ui/switch";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown";
import { useLocalCollection } from "@/lib/store";

type Schedule = {
  id: string; name: string; agent: string; cron: string; cronLabel: string;
  enabled: boolean; lastRun?: { ts: string; ok: boolean }; nextRun: string; runs: number;
};

const PRESETS = [
  { label: "Every 5 minutes",    cron: "*/5 * * * *" },
  { label: "Every hour",          cron: "0 * * * *" },
  { label: "Every day at 09:00",  cron: "0 9 * * *" },
  { label: "Weekdays at 08:00",   cron: "0 8 * * 1-5" },
  { label: "Every Monday 09:00",  cron: "0 9 * * 1" },
  { label: "First of the month",  cron: "0 9 1 * *" },
];

const INITIAL: Schedule[] = [
  { id: "sc1", name: "Morning market briefing", agent: "Market Research", cron: "0 8 * * 1-5",  cronLabel: "Weekdays at 08:00",  enabled: true,  lastRun: { ts: new Date(Date.now() - 3 * 3600_000).toISOString(), ok: true },  nextRun: new Date(Date.now() + 18 * 3600_000).toISOString(), runs: 42 },
  { id: "sc2", name: "Hourly support digest",    agent: "Customer Support", cron: "0 * * * *",   cronLabel: "Every hour",         enabled: true,  lastRun: { ts: new Date(Date.now() - 40 * 60_000).toISOString(), ok: true },  nextRun: new Date(Date.now() + 20 * 60_000).toISOString(), runs: 284 },
  { id: "sc3", name: "Weekly competitor sweep",  agent: "Market Research", cron: "0 9 * * 1",   cronLabel: "Every Monday 09:00", enabled: false, lastRun: { ts: new Date(Date.now() - 7 * 86400_000).toISOString(), ok: true }, nextRun: new Date(Date.now() + 3 * 86400_000).toISOString(), runs: 8 },
  { id: "sc4", name: "Deployment health check",  agent: "DevOps Sentinel", cron: "*/15 * * * *", cronLabel: "Every 15 min",       enabled: true,  lastRun: { ts: new Date(Date.now() - 12 * 60_000).toISOString(), ok: false }, nextRun: new Date(Date.now() + 3 * 60_000).toISOString(), runs: 1428 },
];

export default function SchedulesPage() {
  const { items: schedules, add, update, remove: removeItem } = useLocalCollection<Schedule>("nexus_schedules", INITIAL);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", agent: "Market Research", cron: "0 9 * * 1-5", input: "" });

  function toggle(id: string) {
    const s = schedules.find((x) => x.id === id);
    if (!s) return;
    update(id, { enabled: !s.enabled });
    toast.success(`${s.name} ${s.enabled ? "paused" : "enabled"}`);
  }
  function remove(id: string) {
    const s = schedules.find((x) => x.id === id);
    if (s && !confirm(`Delete schedule "${s.name}"?`)) return;
    removeItem(id);
    toast.success("Schedule removed");
  }
  function runNow(id: string) {
    const s = schedules.find((x) => x.id === id);
    if (s) {
      update(id, { lastRun: { ts: new Date().toISOString(), ok: true }, runs: s.runs + 1 });
      toast.success(`Running "${s.name}"`);
    }
  }
  function createSchedule() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const preset = PRESETS.find((p) => p.cron === form.cron);
    add({
      id: `sc_${Date.now().toString(36)}`,
      name: form.name,
      agent: form.agent,
      cron: form.cron,
      cronLabel: preset?.label ?? form.cron,
      enabled: true,
      nextRun: new Date(Date.now() + 3600_000).toISOString(),
      runs: 0,
    });
    toast.success(`Schedule "${form.name}" created`);
    setForm({ name: "", agent: "Market Research", cron: "0 9 * * 1-5", input: "" });
    setOpen(false);
  }

  const active = schedules.filter((s) => s.enabled).length;
  const totalRuns = schedules.reduce((a, b) => a + b.runs, 0);

  return (
    <div>
      <PageHeader
        title="Schedules"
        description="Cron-based autonomous runs. Agents execute on a schedule — no manual trigger needed."
        actions={<Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>New schedule</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Schedules"     icon={Calendar} value={schedules.length} />
        <Stat label="Active"        icon={Play}     value={active} />
        <Stat label="Runs total"    icon={Clock}    value={totalRuns.toLocaleString()} />
        <Stat label="Next up"       icon={Clock}    value={formatDistanceToNow(new Date(Math.min(...schedules.filter((s) => s.enabled).map((s) => +new Date(s.nextRun))) || Date.now()), { addSuffix: true })} />
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border bg-bg-subtle/50">
            <tr>
              <th className="text-left font-medium px-5 py-3">Name</th>
              <th className="text-left font-medium">Agent</th>
              <th className="text-left font-medium">Schedule</th>
              <th className="text-left font-medium">Last run</th>
              <th className="text-left font-medium">Next run</th>
              <th className="text-right font-medium">Runs</th>
              <th className="text-center font-medium">Enabled</th>
              <th className="px-5" />
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                <td className="px-5 py-3 font-medium">{s.name}</td>
                <td><Badge tone="brand" size="sm">{s.agent}</Badge></td>
                <td>
                  <div className="flex items-center gap-2">
                    <code className="text-2xs font-mono bg-bg-muted border border-border px-1.5 py-0.5 rounded">{s.cron}</code>
                    <span className="text-2xs text-fg-muted">{s.cronLabel}</span>
                  </div>
                </td>
                <td>
                  {s.lastRun ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      {s.lastRun.ok ? <CheckCircle2 className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-danger" />}
                      <span className="text-fg-muted">{formatDistanceToNow(new Date(s.lastRun.ts), { addSuffix: true })}</span>
                    </div>
                  ) : <span className="text-2xs text-fg-subtle">—</span>}
                </td>
                <td className="text-xs text-fg-muted">{s.enabled ? formatDistanceToNow(new Date(s.nextRun), { addSuffix: true }) : <span className="text-fg-subtle">—</span>}</td>
                <td className="text-right font-mono text-xs">{s.runs.toLocaleString()}</td>
                <td className="text-center">
                  <Switch checked={s.enabled} onCheckedChange={() => toggle(s.id)} />
                </td>
                <td className="px-5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => runNow(s.id)}><Play className="h-3.5 w-3.5" />Run now</DropdownMenuItem>
                      <DropdownMenuItem><Edit className="h-3.5 w-3.5" />Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => remove(s.id)} className="text-danger"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Cron cheatsheet */}
      <Card className="mt-4 p-5 bg-bg-subtle">
        <h3 className="font-semibold tracking-tight mb-3 text-sm">Cron cheatsheet</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <div key={p.cron} className="flex items-center gap-2 text-xs">
              <code className="font-mono bg-bg-elevated border border-border px-1.5 py-0.5 rounded">{p.cron}</code>
              <span className="text-fg-muted">{p.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New schedule"
        description="Run an agent on a recurring cron-based schedule."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createSchedule} disabled={!form.name.trim()}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input placeholder="Morning brief" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Agent</Label>
            <Select value={form.agent} onValueChange={(v) => setForm({ ...form, agent: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Market Research">Market Research</SelectItem>
                <SelectItem value="Customer Support">Customer Support</SelectItem>
                <SelectItem value="DevOps Sentinel">DevOps Sentinel</SelectItem>
                <SelectItem value="Code Helper">Code Helper</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cron expression</Label>
            <Input placeholder="0 9 * * 1-5" value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })} className="font-mono" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.slice(0, 4).map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => setForm({ ...form, cron: p.cron })}
                  className="text-2xs px-2 py-1 rounded-md bg-bg-muted border border-border hover:border-brand transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Input</Label>
            <Textarea rows={3} placeholder="What should the agent do on each tick?"
              value={form.input}
              onChange={(e) => setForm({ ...form, input: e.target.value })} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
