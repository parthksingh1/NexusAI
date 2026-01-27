"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as ReTooltip,
  AreaChart, Area, CartesianGrid, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { DollarSign, Activity, Zap, Clock, TrendingUp, Download } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const LATENCY_DATA = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  p50: 420 + Math.random() * 180,
  p95: 900 + Math.random() * 400,
  p99: 1400 + Math.random() * 600,
}));

const TOOL_USAGE = [
  { tool: "web_search",       calls: 1842, color: "hsl(var(--brand))" },
  { tool: "knowledge_search", calls: 1290, color: "hsl(var(--info))" },
  { tool: "calculator",       calls: 684,  color: "hsl(var(--warn))" },
  { tool: "code_exec",        calls: 412,  color: "hsl(var(--success))" },
  { tool: "github_read_file", calls: 158,  color: "hsl(var(--danger))" },
];

export default function MetricsPage() {
  const [byDay, setByDay] = useState<{ day: string; cost: number; tokens: number; calls: number }[] | null>(null);
  const [byModel, setByModel] = useState<{ model: string; cost: number; calls: number; p95_ms: number }[] | null>(null);
  const [range, setRange] = useState("14");

  useEffect(() => {
    void Promise.all([
      api.costByDay(Number(range)).then((d) => setByDay(d.series)),
      api.costByModel(7).then((d) => setByModel(d.models)),
    ]);
  }, [range]);

  const totalCost = (byDay ?? []).reduce((a, r) => a + Number(r.cost), 0);
  const totalTokens = (byDay ?? []).reduce((a, r) => a + Number(r.tokens), 0);
  const totalCalls = (byDay ?? []).reduce((a, r) => a + Number(r.calls), 0);
  const avgCost = byDay?.length ? totalCost / byDay.length : 0;

  return (
    <div>
      <PageHeader
        title="Metrics"
        description="LLM cost, latency, and tool usage — backed by ClickHouse time-series."
        actions={
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export</Button>
          </div>
        }
      />

      {/* Top-line stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Spend"      icon={DollarSign} value={`$${totalCost.toFixed(2)}`} delta={{ value: "+12%", positive: true }} />
        <Stat label="Tokens"     icon={Zap}        value={`${(totalTokens / 1_000_000).toFixed(2)}M`} delta={{ value: "+8%",  positive: true }} />
        <Stat label="LLM calls"  icon={Activity}   value={totalCalls.toLocaleString()} delta={{ value: "+15%", positive: true }} />
        <Stat label="Avg / day"  icon={Clock}      value={`$${avgCost.toFixed(3)}`} hint="Trailing avg" />
      </div>

      <Tabs defaultValue="cost">
        <TabsList>
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="latency">Latency</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
        </TabsList>

        {/* Cost */}
        <TabsContent value="cost">
          <Card className="mb-4">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold tracking-tight">Daily cost</h3>
                <p className="text-xs text-fg-muted mt-0.5">USD spent per day</p>
              </div>
              <div className="inline-flex items-center gap-1 text-xs text-success"><TrendingUp className="h-3 w-3" />+12%</div>
            </div>
            <div className="p-5 h-72">
              {byDay === null ? <Skeleton className="h-full w-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={byDay} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="hsl(var(--brand))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `$${v.toFixed(2)}`} />
                    <ReTooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(4)}`, "cost"]} />
                    <Area type="monotone" dataKey="cost" stroke="hsl(var(--brand))" strokeWidth={2} fill="url(#costGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-semibold tracking-tight">Token volume</h3>
              <p className="text-xs text-fg-muted mt-0.5">Prompt + completion tokens per day</p>
            </div>
            <div className="p-5 h-56">
              {byDay === null ? <Skeleton className="h-full w-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byDay} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <ReTooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString(), "tokens"]} />
                    <Bar dataKey="tokens" fill="hsl(var(--info))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Latency */}
        <TabsContent value="latency">
          <Card>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-semibold tracking-tight">Response latency</h3>
              <p className="text-xs text-fg-muted mt-0.5">p50, p95, p99 by hour of day (ms)</p>
            </div>
            <div className="p-5 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={LATENCY_DATA} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `${v}ms`} />
                  <ReTooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="p50" stroke="hsl(var(--brand))"  strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="p95" stroke="hsl(var(--warn))"   strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="p99" stroke="hsl(var(--danger))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-6 mt-3 text-xs">
                <LegendItem color="var(--brand)"  label="p50" />
                <LegendItem color="var(--warn)"   label="p95" />
                <LegendItem color="var(--danger)" label="p99" />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Tools */}
        <TabsContent value="tools">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="px-5 py-4 border-b border-border">
                <h3 className="font-semibold tracking-tight">Tool invocations</h3>
                <p className="text-xs text-fg-muted mt-0.5">Last 7 days</p>
              </div>
              <div className="p-5 h-64 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={TOOL_USAGE} dataKey="calls" nameKey="tool" cx="50%" cy="50%" innerRadius={50} outerRadius={90} stroke="hsl(var(--bg-elevated))">
                      {TOOL_USAGE.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <ReTooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <div className="px-5 py-4 border-b border-border">
                <h3 className="font-semibold tracking-tight">Breakdown</h3>
              </div>
              <ul className="divide-y divide-border">
                {TOOL_USAGE.map((t) => (
                  <li key={t.tool} className="px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                      <span className="font-mono text-xs">{t.tool}</span>
                    </div>
                    <span className="text-sm font-medium">{t.calls.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </TabsContent>

        {/* Models */}
        <TabsContent value="models">
          <Card>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-semibold tracking-tight">Cost by model</h3>
              <p className="text-xs text-fg-muted mt-0.5">Last 7 days · sorted by cost</p>
            </div>
            <div className="p-5 h-56">
              {byModel === null ? <Skeleton className="h-full w-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byModel} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="model" tickLine={false} axisLine={false} fontSize={10} stroke="hsl(var(--fg-subtle))" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `$${v.toFixed(1)}`} />
                    <ReTooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(4)}`, "cost"]} />
                    <Bar dataKey="cost" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            {byModel && byModel.length > 0 && (
              <div className="px-5 pb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border">
                    <tr>
                      <th className="text-left py-2 font-medium">Model</th>
                      <th className="text-right font-medium">Calls</th>
                      <th className="text-right font-medium">Cost</th>
                      <th className="text-right font-medium">P95 latency</th>
                      <th className="text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byModel.map((m) => {
                      const share = (Number(m.cost) / byModel.reduce((a, b) => a + Number(b.cost), 0)) * 100;
                      return (
                        <tr key={m.model} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                          <td className="py-2.5 font-mono text-xs">{m.model}</td>
                          <td className="text-right">{m.calls.toLocaleString()}</td>
                          <td className="text-right font-medium">${Number(m.cost).toFixed(4)}</td>
                          <td className="text-right font-mono text-xs">{Math.round(Number(m.p95_ms))}ms</td>
                          <td className="text-right text-xs text-fg-muted">{share.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
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

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-fg-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: `hsl(${color})` }} />
      <span className="font-mono">{label}</span>
    </div>
  );
}
