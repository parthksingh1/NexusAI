"use client";

import { Activity, CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type ServiceStatus = "operational" | "degraded" | "partial" | "outage";

type Service = {
  name: string; description: string; status: ServiceStatus; uptime: number; // last 90 days
  p50: number; p95: number;
  history: ServiceStatus[]; // 90 values
};

const rand90 = (): ServiceStatus[] => {
  const arr: ServiceStatus[] = [];
  for (let i = 0; i < 90; i++) {
    const r = Math.random();
    if (r > 0.985) arr.push("partial");
    else if (r > 0.995) arr.push("outage");
    else if (r > 0.97)  arr.push("degraded");
    else arr.push("operational");
  }
  return arr;
};

const SERVICES: Service[] = [
  { name: "Orchestrator API",      description: "Agent runs, tools, auth", status: "operational", uptime: 99.98, p50: 18, p95: 72,  history: rand90() },
  { name: "Web dashboard",          description: "app.nexusai.com",          status: "operational", uptime: 99.99, p50: 120, p95: 380, history: rand90() },
  { name: "RAG service",            description: "Hybrid search + ingest",  status: "operational", uptime: 99.95, p50: 42, p95: 168, history: rand90() },
  { name: "Sandbox",                description: "Code execution",           status: "operational", uptime: 99.97, p50: 11, p95: 340, history: rand90() },
  { name: "Realtime streams",       description: "Crypto, news, weather",    status: "degraded",    uptime: 99.45, p50: 14, p95: 820, history: rand90() },
  { name: "Postgres",               description: "Primary + pgvector",       status: "operational", uptime: 99.99, p50: 3,  p95: 12,  history: rand90() },
  { name: "ClickHouse",             description: "LLMOps analytics",         status: "operational", uptime: 99.94, p50: 64, p95: 220, history: rand90() },
  { name: "Neo4j memory graph",     description: "Agent memory store",       status: "operational", uptime: 99.92, p50: 24, p95: 98,  history: rand90() },
];

const INCIDENTS = [
  { id: "in1", title: "Elevated latency on realtime streams",         status: "investigating", severity: "minor", started: new Date(Date.now() - 2 * 3600_000).toISOString(),  updates: ["Identified upstream provider slowness", "Failing over to secondary region"] },
  { id: "in2", title: "Scheduled maintenance — ClickHouse 24.9 upgrade", status: "scheduled",     severity: "info",  started: new Date(Date.now() + 2 * 86400_000).toISOString() },
  { id: "in3", title: "Brief orchestrator restart window",              status: "resolved",      severity: "minor", started: new Date(Date.now() - 3 * 86400_000).toISOString(), duration: "8 minutes" },
  { id: "in4", title: "Kafka broker partition rebalance",                status: "resolved",      severity: "minor", started: new Date(Date.now() - 10 * 86400_000).toISOString(), duration: "22 minutes" },
];

const overallStatus: ServiceStatus = SERVICES.some((s) => s.status === "outage") ? "outage"
  : SERVICES.some((s) => s.status === "partial") ? "partial"
  : SERVICES.some((s) => s.status === "degraded") ? "degraded"
  : "operational";

export default function StatusPage() {
  const avgUptime = SERVICES.reduce((a, b) => a + b.uptime, 0) / SERVICES.length;

  return (
    <div>
      <PageHeader
        title="System status"
        description="Real-time health of every NexusAI service. Subscribe to updates via RSS or webhook."
      />

      {/* Overall banner */}
      <Card className={cn(
        "p-6 mb-6",
        overallStatus === "operational" && "border-success/30 bg-success/5",
        overallStatus === "degraded"    && "border-warn/30 bg-warn/5",
        overallStatus === "partial"     && "border-danger/30 bg-danger/5",
        overallStatus === "outage"      && "border-danger/40 bg-danger/10",
      )}>
        <div className="flex items-center gap-3">
          <OverallIcon status={overallStatus} />
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{overallLabel(overallStatus)}</h2>
            <p className="text-sm text-fg-muted mt-0.5">
              {overallStatus === "operational"
                ? "All systems normal. Last checked a few seconds ago."
                : "Some services are experiencing issues. See details below."}
            </p>
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">Uptime · 90d</div>
            <div className="text-2xl font-semibold tracking-tighter font-mono">{avgUptime.toFixed(2)}%</div>
          </div>
        </div>
      </Card>

      {/* Services */}
      <Card className="mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold tracking-tight">Services</h3>
        </div>
        <ul className="divide-y divide-border">
          {SERVICES.map((s) => (
            <li key={s.name} className="p-5">
              <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <StatusDot status={s.status} />
                  </div>
                  <p className="text-xs text-fg-muted mt-0.5">{s.description}</p>
                </div>
                <div className="flex items-center gap-6 text-2xs font-mono shrink-0">
                  <div className="text-right">
                    <div className="text-fg-subtle uppercase tracking-wider">p50</div>
                    <div className="font-medium">{s.p50}ms</div>
                  </div>
                  <div className="text-right">
                    <div className="text-fg-subtle uppercase tracking-wider">p95</div>
                    <div className="font-medium">{s.p95}ms</div>
                  </div>
                  <div className="text-right">
                    <div className="text-fg-subtle uppercase tracking-wider">Uptime</div>
                    <div className="font-medium">{s.uptime.toFixed(2)}%</div>
                  </div>
                </div>
              </div>
              {/* 90-day history bars */}
              <div className="flex items-center gap-[2px]">
                {s.history.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-7 flex-1 rounded-sm transition-transform hover:scale-y-125",
                      h === "operational" && "bg-success/70",
                      h === "degraded"    && "bg-warn/70",
                      h === "partial"     && "bg-warn",
                      h === "outage"      && "bg-danger",
                    )}
                    title={`${90 - i} days ago — ${h}`}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-2xs text-fg-subtle">
                <span>90 days ago</span>
                <span>Today</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Incidents */}
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold tracking-tight">Active & recent incidents</h3>
        </div>
        <ul className="divide-y divide-border">
          {INCIDENTS.map((i) => (
            <li key={i.id} className="p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <IncidentIcon status={i.status} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{i.title}</span>
                      <Badge tone={incidentTone(i.status)} size="sm" dot pulse={i.status === "investigating"}>
                        {i.status}
                      </Badge>
                    </div>
                    <div className="text-2xs text-fg-subtle mt-1">
                      {i.status === "scheduled" ? "Scheduled for " : "Started "}
                      {format(new Date(i.started), "MMM d, HH:mm")} · {formatDistanceToNow(new Date(i.started), { addSuffix: true })}
                      {i.duration && ` · lasted ${i.duration}`}
                    </div>
                    {i.updates && (
                      <ul className="mt-3 space-y-1.5 text-xs">
                        {i.updates.map((u, k) => (
                          <li key={k} className="flex items-start gap-2">
                            <span className="h-1 w-1 rounded-full bg-fg-subtle mt-1.5 shrink-0" />
                            <span className="text-fg-muted">{u}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function overallLabel(s: ServiceStatus): string {
  return { operational: "All systems operational", degraded: "Degraded performance", partial: "Partial outage", outage: "Major outage" }[s];
}

function StatusDot({ status }: { status: ServiceStatus }) {
  const tone = { operational: "success", degraded: "warn", partial: "warn", outage: "danger" }[status] as "success" | "warn" | "danger";
  return <Badge tone={tone} size="sm" dot pulse={status === "operational"}>{status}</Badge>;
}

function OverallIcon({ status }: { status: ServiceStatus }) {
  const Icon = status === "operational" ? CheckCircle2 : status === "outage" ? XCircle : AlertCircle;
  const color = status === "operational" ? "text-success" : status === "outage" ? "text-danger" : "text-warn";
  return (
    <div className={cn("h-12 w-12 rounded-md border flex items-center justify-center shrink-0",
      status === "operational" && "bg-success/10 border-success/30",
      status !== "operational" && "bg-warn/10 border-warn/30",
      status === "outage" && "bg-danger/10 border-danger/30",
    )}>
      <Icon className={cn("h-6 w-6", color)} />
    </div>
  );
}

function IncidentIcon({ status }: { status: string }) {
  const Icon = status === "resolved" ? CheckCircle2 : status === "scheduled" ? Clock : Activity;
  const color = status === "resolved" ? "text-success bg-success/10 border-success/20"
    : status === "scheduled" ? "text-info bg-info/10 border-info/20"
    : "text-warn bg-warn/10 border-warn/20";
  return (
    <div className={`h-8 w-8 rounded-md border flex items-center justify-center shrink-0 ${color}`}>
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

function incidentTone(status: string): "success" | "warn" | "info" {
  if (status === "resolved") return "success";
  if (status === "scheduled") return "info";
  return "warn";
}
