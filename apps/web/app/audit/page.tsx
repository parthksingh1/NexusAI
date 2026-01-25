"use client";

import { useMemo, useState } from "react";
import { Shield, Download, Search, Filter, User, Bot, Key, Settings, Trash2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type AuditEvent = {
  id: string;
  actor: { name: string; email: string; initials: string };
  action: string; resource: string; category: "auth" | "agent" | "team" | "billing" | "settings" | "api-key";
  ip: string; userAgent: string; ts: string; success: boolean;
};

const MOCK: AuditEvent[] = [
  { id: "au1", actor: { name: "Demo User",    email: "demo@nexusai.local",  initials: "DU" }, action: "user.signed_in",           resource: "session",                 category: "auth",     ip: "203.0.113.42", userAgent: "Chrome / macOS", ts: new Date(Date.now() - 2 * 60_000).toISOString(), success: true },
  { id: "au2", actor: { name: "Demo User",    email: "demo@nexusai.local",  initials: "DU" }, action: "agent.created",             resource: "Market Research",         category: "agent",    ip: "203.0.113.42", userAgent: "Chrome / macOS", ts: new Date(Date.now() - 15 * 60_000).toISOString(), success: true },
  { id: "au3", actor: { name: "Alex Chen",     email: "alex@nexusai.local",  initials: "AC" }, action: "api_key.created",           resource: "Production",              category: "api-key",  ip: "198.51.100.17", userAgent: "Firefox / Ubuntu",ts: new Date(Date.now() - 2 * 3600_000).toISOString(), success: true },
  { id: "au4", actor: { name: "Alex Chen",     email: "alex@nexusai.local",  initials: "AC" }, action: "team.member.invited",       resource: "sophie@nexusai.local",   category: "team",     ip: "198.51.100.17", userAgent: "Firefox / Ubuntu",ts: new Date(Date.now() - 3 * 3600_000).toISOString(), success: true },
  { id: "au5", actor: { name: "Priya Sharma",  email: "priya@nexusai.local", initials: "PS" }, action: "agent.deleted",             resource: "Legacy Assistant",         category: "agent",    ip: "192.0.2.88",   userAgent: "Safari / iOS",    ts: new Date(Date.now() - 6 * 3600_000).toISOString(), success: true },
  { id: "au6", actor: { name: "Demo User",    email: "demo@nexusai.local",  initials: "DU" }, action: "billing.plan.upgraded",     resource: "PRO",                     category: "billing",  ip: "203.0.113.42", userAgent: "Chrome / macOS", ts: new Date(Date.now() - 12 * 3600_000).toISOString(), success: true },
  { id: "au7", actor: { name: "Marcus Lee",   email: "marcus@nexusai.local", initials: "ML" }, action: "user.sign_in.failed",       resource: "session",                 category: "auth",     ip: "203.0.113.99", userAgent: "Chrome / Windows",ts: new Date(Date.now() - 18 * 3600_000).toISOString(), success: false },
  { id: "au8", actor: { name: "Demo User",    email: "demo@nexusai.local",  initials: "DU" }, action: "settings.2fa.enabled",      resource: "account",                 category: "settings", ip: "203.0.113.42", userAgent: "Chrome / macOS", ts: new Date(Date.now() - 24 * 3600_000).toISOString(), success: true },
  { id: "au9", actor: { name: "Alex Chen",     email: "alex@nexusai.local",  initials: "AC" }, action: "api_key.revoked",           resource: "Staging key",             category: "api-key",  ip: "198.51.100.17", userAgent: "Firefox / Ubuntu",ts: new Date(Date.now() - 48 * 3600_000).toISOString(), success: true },
];

const CATEGORY_META = {
  auth:      { icon: User,     color: "text-info bg-info/10 border-info/20" },
  agent:     { icon: Bot,      color: "text-brand bg-brand-muted border-brand-border" },
  team:      { icon: User,     color: "text-warn bg-warn/10 border-warn/20" },
  billing:   { icon: Key,      color: "text-success bg-success/10 border-success/20" },
  settings:  { icon: Settings, color: "text-fg-muted bg-bg-muted border-border" },
  "api-key": { icon: Key,      color: "text-danger bg-danger/10 border-danger/20" },
} as const;

export default function AuditLogPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");

  const filtered = useMemo(() => {
    return MOCK.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return e.action.toLowerCase().includes(s) || e.resource.toLowerCase().includes(s) || e.actor.name.toLowerCase().includes(s);
    });
  }, [q, cat]);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Tamper-evident record of every sensitive action. Retained 365 days on Team, unlimited on Enterprise."
        actions={<Button variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />}>Export CSV</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Events (30d)"     icon={Shield}    value={MOCK.length + "+"} />
        <Stat label="Unique actors"    icon={User}      value={new Set(MOCK.map((m) => m.actor.email)).size} />
        <Stat label="Failed signins"   icon={Trash2}    value={MOCK.filter((m) => m.action === "user.sign_in.failed").length} />
        <Stat label="Data retention"   icon={Shield}    value="365d" hint="Team tier" />
      </div>

      <Card className="mb-4 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
            <Input placeholder="Search actions, actors, resources…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-44"><Filter className="h-3.5 w-3.5 text-fg-subtle" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="auth">Authentication</SelectItem>
              <SelectItem value="agent">Agents</SelectItem>
              <SelectItem value="team">Team</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="settings">Settings</SelectItem>
              <SelectItem value="api-key">API keys</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border bg-bg-subtle/50">
            <tr>
              <th className="text-left font-medium px-5 py-3">Actor</th>
              <th className="text-left font-medium">Action</th>
              <th className="text-left font-medium">Resource</th>
              <th className="text-left font-medium">IP</th>
              <th className="text-left font-medium">Device</th>
              <th className="text-center font-medium">Status</th>
              <th className="text-right font-medium px-5">When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const meta = CATEGORY_META[e.category];
              const Icon = meta.icon;
              return (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-7 w-7"><AvatarFallback className="text-2xs">{e.actor.initials}</AvatarFallback></Avatar>
                      <div>
                        <div className="font-medium text-xs">{e.actor.name}</div>
                        <div className="text-2xs text-fg-subtle">{e.actor.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${meta.color}`}>
                        <Icon className="h-2.5 w-2.5" />
                      </div>
                      <code className="text-2xs font-mono">{e.action}</code>
                    </div>
                  </td>
                  <td className="text-xs text-fg-muted">{e.resource}</td>
                  <td className="font-mono text-2xs text-fg-muted">{e.ip}</td>
                  <td className="text-2xs text-fg-subtle">{e.userAgent}</td>
                  <td className="text-center">
                    {e.success ? <Badge tone="success" size="sm" dot>OK</Badge> : <Badge tone="danger" size="sm" dot>Failed</Badge>}
                  </td>
                  <td className="text-right px-5">
                    <div className="text-xs font-mono text-fg-muted">{format(new Date(e.ts), "HH:mm:ss")}</div>
                    <div className="text-2xs text-fg-subtle">{formatDistanceToNow(new Date(e.ts), { addSuffix: true })}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
