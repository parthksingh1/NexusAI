"use client";

import { useEffect, useRef, useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as ReTooltip } from "recharts";
import { AlertTriangle, TrendingUp, TrendingDown, Zap, Activity, Radio, CircleDot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Tick = { type: "tick"; symbol: string; source: string; price: number; ts: string };
type Alert = { type: "alert"; symbol: string; kind: string; severity: string; message: string; ts: string };

const MAX_POINTS = 120;

// ─── Deterministic mock data generator for demo when realtime is offline ──
function genMockTicks(symbols: string[]): Record<string, { ts: number; price: number }[]> {
  const out: Record<string, { ts: number; price: number }[]> = {};
  const now = Date.now();
  const bases: Record<string, number> = { BTCUSDT: 67000, ETHUSDT: 3300, SOLUSDT: 160, BNBUSDT: 580, AVAXUSDT: 35 };
  for (const s of symbols) {
    const base = bases[s] ?? 100;
    let price = base;
    const arr: { ts: number; price: number }[] = [];
    for (let i = MAX_POINTS - 1; i >= 0; i--) {
      price += (Math.random() - 0.5) * base * 0.004;
      arr.push({ ts: now - i * 4000, price });
    }
    out[s] = arr;
  }
  return out;
}

const DEMO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export default function StreamsPage() {
  const [series, setSeries] = useState<Record<string, { ts: number; price: number }[]>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [mode, setMode] = useState<"live" | "demo">("demo");
  const wsRef = useRef<WebSocket | null>(null);

  // Seed with demo data
  useEffect(() => {
    setSeries(genMockTicks(DEMO_SYMBOLS));
    setAlerts([
      { type: "alert", symbol: "BTCUSDT", kind: "anomaly",  severity: "warn",     message: "z-score 3.4 · unusual volatility", ts: new Date(Date.now() - 2 * 60_000).toISOString() },
      { type: "alert", symbol: "AI news", kind: "sentiment", severity: "critical", message: "Negative sentiment: -0.82",         ts: new Date(Date.now() - 18 * 60_000).toISOString() },
    ]);
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_REALTIME_WS ?? "ws://localhost:4200";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${url}/ws/ticks`);
      wsRef.current = ws;
      ws.onopen = () => setMode("live");
      ws.onmessage = (m) => {
        const data = JSON.parse(m.data as string);
        if (data.type === "tick") {
          const t = data as Tick;
          if (t.source !== "crypto") return;
          setSeries((prev) => {
            const arr = prev[t.symbol] ?? [];
            const next = [...arr, { ts: Date.parse(t.ts.replace(" ", "T") + "Z"), price: t.price }];
            return { ...prev, [t.symbol]: next.slice(-MAX_POINTS) };
          });
        } else if (data.type === "alert") {
          setAlerts((prev) => [data as Alert, ...prev].slice(0, 50));
        }
      };
      ws.onerror = () => setMode("demo");
      ws.onclose = () => setMode("demo");
    } catch { setMode("demo"); }
    return () => wsRef.current?.close();
  }, []);

  // In demo mode, animate the charts with micro-ticks
  useEffect(() => {
    if (mode !== "demo") return;
    const t = setInterval(() => {
      setSeries((prev) => {
        const next: typeof prev = {};
        for (const [sym, arr] of Object.entries(prev)) {
          const last = arr[arr.length - 1]?.price ?? 100;
          const n = [...arr, { ts: Date.now(), price: last + (Math.random() - 0.5) * last * 0.003 }];
          next[sym] = n.slice(-MAX_POINTS);
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, [mode]);

  const symbols = Object.keys(series).sort();

  return (
    <div>
      <PageHeader
        title="Live streams"
        description="Real-time crypto ticks, news sentiment, and rolling z-score anomaly detection."
        actions={
          mode === "live" ? (
            <Badge tone="success" dot pulse>Live · {symbols.length} symbol{symbols.length !== 1 ? "s" : ""}</Badge>
          ) : (
            <Badge tone="warn" size="sm" dot>Demo mode · realtime service offline</Badge>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Symbols tracked" icon={Radio}         value={symbols.length} />
        <Stat label="Ticks / min"     icon={Activity}      value="~480" hint="All sources combined" />
        <Stat label="Alerts (24h)"    icon={AlertTriangle} value={alerts.length} />
        <Stat label="Connections"     icon={CircleDot}     value={mode === "live" ? 1 : 0} hint={mode === "live" ? "WebSocket connected" : "Offline"} />
      </div>

      <Tabs defaultValue="markets">
        <TabsList>
          <TabsTrigger value="markets">Markets</TabsTrigger>
          <TabsTrigger value="alerts">Alerts {alerts.length > 0 && <Badge size="sm" className="ml-2">{alerts.length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="markets">
          {symbols.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="Waiting for ticks"
              description="Start the realtime service (port 4200) to see live crypto, news, and weather data flow in."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {symbols.map((s) => {
                const data = series[s] ?? [];
                const last = data[data.length - 1]?.price;
                const first = data[0]?.price;
                const change = last && first ? ((last - first) / first) * 100 : 0;
                const positive = change >= 0;
                return (
                  <Card key={s} className="p-5 shine">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-fg-muted font-mono">{s}</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
                        </div>
                        <div className="mt-1 text-2xl font-semibold tracking-tighter font-mono">
                          ${last?.toFixed(2) ?? "—"}
                        </div>
                      </div>
                      <div className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${positive ? "text-success bg-success/10" : "text-danger bg-danger/10"}`}>
                        {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {positive ? "+" : ""}{change.toFixed(2)}%
                      </div>
                    </div>
                    <div className="mt-3 h-24 -mx-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                          <XAxis dataKey="ts" hide />
                          <YAxis domain={["dataMin", "dataMax"]} hide />
                          <ReTooltip
                            contentStyle={tooltipStyle}
                            labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString()}
                            formatter={(v: number) => [`$${v.toFixed(2)}`, "price"]}
                          />
                          <Line type="monotone" dataKey="price" stroke={positive ? "hsl(var(--success))" : "hsl(var(--danger))"} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 text-2xs text-fg-subtle flex items-center justify-between">
                      <span>Last update {formatDistanceToNow(new Date(data[data.length - 1]?.ts ?? Date.now()), { addSuffix: true })}</span>
                      <span className="font-mono">{MAX_POINTS} pts</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            {alerts.length === 0 ? (
              <div className="py-16 text-center text-sm text-fg-subtle">No alerts yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {alerts.map((a, i) => {
                  const tone = a.severity === "critical" ? "danger" : a.severity === "warn" ? "warn" : "info";
                  return (
                    <li key={i} className="px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover transition-colors">
                      <div className={`h-8 w-8 rounded-md border flex items-center justify-center shrink-0 bg-${tone}/10 border-${tone}/20`}>
                        <AlertTriangle className={`h-3.5 w-3.5 text-${tone}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={tone} size="sm">{a.kind}</Badge>
                          <span className="font-medium font-mono text-xs">{a.symbol}</span>
                        </div>
                        <div className="text-xs text-fg-muted mt-0.5">{a.message}</div>
                      </div>
                      <div className="text-2xs text-fg-subtle text-right font-mono shrink-0">
                        {formatDistanceToNow(parseTs(a.ts), { addSuffix: true })}
                      </div>
                    </li>
                  );
                })}
              </ul>
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

/**
 * Parse timestamps coming from either source:
 *   - ClickHouse-style: "YYYY-MM-DD HH:mm:ss.SSS"  (from the realtime backend)
 *   - ISO: "YYYY-MM-DDTHH:mm:ss.SSSZ"              (from mock data)
 * Returns a valid Date; falls back to now() if parsing fails.
 */
function parseTs(ts: string | number | Date): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  // Already ISO with T and/or Z?
  const hasT = ts.includes("T");
  const hasZ = ts.endsWith("Z");
  const normalized = hasT ? (hasZ ? ts : ts + "Z") : ts.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? new Date() : d;
}
