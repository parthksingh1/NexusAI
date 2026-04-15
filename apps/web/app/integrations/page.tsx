"use client";

import { useState } from "react";
import {
  Search, Check, ExternalLink, Plug, MessageSquare, Github, FileText, Globe,
  Database, Webhook, Mail, Slack, Bell, LineChart, Zap, Box,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

type Category = "data-source" | "notification" | "observability" | "automation";
type Integration = {
  id: string; name: string; description: string; category: Category;
  icon: LucideIcon;
  connected: boolean; badge?: string; color?: string;
};

const INTEGRATIONS: Integration[] = [
  { id: "notion",     name: "Notion",      description: "Pull pages and databases into the knowledge base.", category: "data-source", icon: FileText,       connected: true,  color: "text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900" },
  { id: "github",     name: "GitHub",      description: "Ingest repo READMEs, open PRs, read issues.",       category: "data-source", icon: Github,         connected: true,  color: "text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900" },
  { id: "slack",      name: "Slack",       description: "Ingest channels + push alerts to Slack.",           category: "notification", icon: Slack,          connected: false, color: "text-white bg-[#4A154B]" },
  { id: "url",        name: "URL fetcher", description: "Ingest any public web page into the KB.",           category: "data-source", icon: Globe,          connected: true, badge: "Built-in", color: "text-white bg-brand" },
  { id: "webhook",    name: "Webhooks",    description: "POST run events to your own HTTP endpoint.",        category: "notification", icon: Webhook,        connected: false, color: "text-fg-muted bg-bg-muted" },
  { id: "email",      name: "Email",       description: "SMTP delivery for alerts and digests.",             category: "notification", icon: Mail,           connected: true,  color: "text-white bg-info" },
  { id: "discord",    name: "Discord",     description: "Post run updates to a Discord channel.",            category: "notification", icon: MessageSquare,  connected: false, color: "text-white bg-[#5865F2]" },
  { id: "pagerduty",  name: "PagerDuty",   description: "Escalate critical alerts to on-call.",              category: "notification", icon: Bell,           connected: false, color: "text-white bg-[#06AC38]" },
  { id: "grafana",    name: "Grafana",     description: "Export metrics to your Grafana dashboards.",         category: "observability", icon: LineChart,      connected: false, color: "text-white bg-[#F46800]" },
  { id: "datadog",    name: "Datadog",     description: "Ship logs + traces to Datadog.",                    category: "observability", icon: Zap,            connected: false, color: "text-white bg-[#632CA6]" },
  { id: "otel",       name: "OpenTelemetry", description: "Native OTLP export — traces, metrics, logs.",      category: "observability", icon: Box,            connected: true,  color: "text-fg bg-bg-muted" },
  { id: "postgres",   name: "Postgres",    description: "Query external databases from within agents.",      category: "data-source", icon: Database,       connected: false, color: "text-white bg-[#336791]" },
  { id: "zapier",     name: "Zapier",      description: "Trigger NexusAI runs from 5,000+ apps.",            category: "automation", icon: Zap,            connected: false, color: "text-white bg-[#FF4A00]" },
];

const CATEGORIES: { id: Category | "all"; label: string }[] = [
  { id: "all",            label: "All" },
  { id: "data-source",    label: "Data sources" },
  { id: "notification",   label: "Notifications" },
  { id: "observability",  label: "Observability" },
  { id: "automation",     label: "Automation" },
];

export default function IntegrationsPage() {
  const [items, setItems] = useState(INTEGRATIONS);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<string>("all");

  function toggle(id: string) {
    setItems(items.map((i) => i.id === id ? { ...i, connected: !i.connected } : i));
    const it = items.find((i) => i.id === id)!;
    toast.success(it.connected ? `${it.name} disconnected` : `${it.name} connected`);
  }

  const filtered = items.filter((i) => {
    if (tab !== "all" && i.category !== tab) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s);
  });

  const connectedCount = items.filter((i) => i.connected).length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect NexusAI to the tools your team already uses."
        actions={<Badge tone="success" dot>{connectedCount} connected</Badge>}
      />

      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <Input placeholder="Search integrations…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {CATEGORIES.map((c) => <TabsTrigger key={c.id} value={c.id}>{c.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={tab}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((i) => (
              <Card key={i.id} className="p-5 group flex flex-col" interactive>
                <div className="flex items-start justify-between mb-3">
                  <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", i.color)}>
                    <i.icon className="h-5 w-5" />
                  </div>
                  <div className="flex gap-1.5">
                    {i.badge && <Badge size="sm">{i.badge}</Badge>}
                    {i.connected ? (
                      <Badge tone="success" size="sm" dot>Connected</Badge>
                    ) : (
                      <Badge tone="neutral" size="sm">Available</Badge>
                    )}
                  </div>
                </div>
                <h3 className="font-semibold tracking-tight">{i.name}</h3>
                <p className="mt-1 text-sm text-fg-muted leading-relaxed flex-1">{i.description}</p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <Button
                    variant={i.connected ? "secondary" : "primary"}
                    size="sm"
                    onClick={() => toggle(i.id)}
                    className="flex-1"
                  >
                    {i.connected ? "Manage" : "Connect"}
                  </Button>
                  <Button variant="ghost" size="icon-sm">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-20 text-center text-sm text-fg-subtle">
          No integrations match your search.
        </div>
      )}

      <Card className="mt-6 p-6 bg-bg-subtle">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
            <Plug className="h-5 w-5 text-brand" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight">Build your own integration</h3>
            <p className="text-sm text-fg-muted mt-1 leading-relaxed max-w-2xl">
              NexusAI exposes a REST API, WebSocket events, and Kafka topics. You can write a custom tool
              in TypeScript or Python, or use webhooks to pipe run events into your own systems.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="secondary" size="sm">Read API docs</Button>
              <Button variant="ghost" size="sm">Browse sample tools →</Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
