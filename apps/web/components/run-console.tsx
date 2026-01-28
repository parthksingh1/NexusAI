"use client";

import { useEffect, useRef, useState } from "react";
import { openRunSocket } from "@/lib/api";
import { Brain, Wrench, Eye, CheckCircle2, AlertCircle, Terminal, Copy } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StepEvent = {
  runId: string; agentId: string; step: number;
  kind: "thought" | "action" | "observation" | "final";
  content: string; tool?: string; toolInput?: unknown; toolOutput?: unknown; model?: string;
};

type FinishedEvent = {
  type: "finished"; status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  result?: string; errorMessage?: string;
};

export function RunConsole({ runId }: { runId: string }) {
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [status, setStatus] = useState<"running" | "succeeded" | "failed" | "cancelled">("running");
  const [finalText, setFinalText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]); setFinalText(null); setErrorText(null); setStatus("running");

    let ws: WebSocket | null = null;
    try {
      ws = openRunSocket(runId);
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string);
          if (data.type === "connected") return;
          if (data.type === "finished") {
            const f = data as FinishedEvent;
            setStatus(f.status.toLowerCase() as typeof status);
            if (f.result) setFinalText(f.result);
            if (f.errorMessage) setErrorText(f.errorMessage);
            return;
          }
          setEvents((prev) => [...prev, data as StepEvent]);
        } catch { /* ignore malformed */ }
      };
      ws.onerror = () => {
        setErrorText("Could not connect to orchestrator WebSocket. Start apps/orchestrator on port 4000.");
        setStatus("failed");
      };
    } catch {
      setErrorText("WebSocket not available in this browser.");
      setStatus("failed");
    }
    return () => ws?.close();
  }, [runId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length, finalText]);

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-bg-subtle">
        <div className="flex items-center gap-2 text-sm">
          <Terminal className="h-3.5 w-3.5 text-fg-muted" />
          <span className="font-medium">Live run</span>
          <span className="text-fg-subtle font-mono text-xs">{runId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          {finalText && (
            <Button variant="ghost" size="icon-sm" onClick={() => { navigator.clipboard.writeText(finalText); toast.success("Copied"); }}>
              <Copy className="h-3 w-3" />
            </Button>
          )}
        </div>
      </header>

      <div className="p-5 space-y-2.5 max-h-[560px] overflow-y-auto">
        {events.length === 0 && status === "running" && (
          <div className="text-sm text-fg-subtle py-10 text-center flex flex-col items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
            </div>
            <span>Thinking…</span>
          </div>
        )}

        {events.map((e, i) => <StepCard key={i} event={e} />)}

        {finalText && (
          <div className="mt-4 rounded-lg border border-success/25 bg-success/5 p-4">
            <div className="flex items-center gap-1.5 text-success text-2xs font-semibold uppercase tracking-wider mb-2">
              <CheckCircle2 className="h-3.5 w-3.5" /> Final answer
            </div>
            <div className="text-sm whitespace-pre-wrap prose-nexus">{finalText}</div>
          </div>
        )}

        {errorText && (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-4">
            <div className="flex items-center gap-1.5 text-danger text-2xs font-semibold uppercase tracking-wider mb-2">
              <AlertCircle className="h-3.5 w-3.5" /> Error
            </div>
            <div className="text-sm">{errorText}</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </Card>
  );
}

function StepCard({ event }: { event: StepEvent }) {
  const config = {
    thought:     { icon: Brain,         color: "text-info",    ring: "ring-info/20",    bg: "bg-info/5",    label: "Thought" },
    action:      { icon: Wrench,        color: "text-warn",    ring: "ring-warn/20",    bg: "bg-warn/5",    label: "Action" },
    observation: { icon: Eye,           color: "text-brand",   ring: "ring-brand/20",   bg: "bg-brand/5",   label: "Observation" },
    final:       { icon: CheckCircle2,  color: "text-success", ring: "ring-success/20", bg: "bg-success/5", label: "Final" },
  }[event.kind];

  const Icon = config.icon;
  return (
    <div className="group flex gap-3">
      <div className={`shrink-0 h-7 w-7 rounded-md ${config.bg} border border-border ring-1 ${config.ring} flex items-center justify-center`}>
        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-2xs font-semibold uppercase tracking-wider ${config.color}`}>{config.label}</span>
          {event.tool && <span className="text-2xs text-fg-muted font-mono">{event.tool}</span>}
          {event.model && <span className="ml-auto text-2xs text-fg-subtle font-mono">{event.model}</span>}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words text-fg leading-relaxed">{event.content}</div>
        {(event.toolInput != null || event.toolOutput != null) && (
          <details className="mt-2">
            <summary className="text-2xs text-fg-subtle cursor-pointer hover:text-fg-muted transition-colors select-none">inspect I/O</summary>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5">
              {event.toolInput != null && (
                <pre className="text-2xs bg-bg-muted border border-border p-2 rounded-md overflow-x-auto font-mono">
{JSON.stringify(event.toolInput, null, 2)}
                </pre>
              )}
              {event.toolOutput != null && (
                <pre className="text-2xs bg-bg-muted border border-border p-2 rounded-md overflow-x-auto font-mono">
{JSON.stringify(event.toolOutput, null, 2)}
                </pre>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cfg: Record<string, { tone: "success" | "danger" | "warn"; label: string; pulse: boolean }> = {
    running:   { tone: "success", label: "Running",   pulse: true },
    succeeded: { tone: "success", label: "Succeeded", pulse: false },
    failed:    { tone: "danger",  label: "Failed",    pulse: false },
    cancelled: { tone: "warn",    label: "Cancelled", pulse: false },
  };
  const c = cfg[status] ?? { tone: "success" as const, label: status, pulse: false };
  return <Badge tone={c.tone} dot pulse={c.pulse} size="sm">{c.label}</Badge>;
}
