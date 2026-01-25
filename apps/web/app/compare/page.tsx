"use client";

import { useState } from "react";
import { Sparkles, Play, Copy, DollarSign, Zap, Clock, Target, Crown } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea, Label } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type ModelCol = {
  id: string; name: string; label: string;
  costIn: number; costOut: number;
  sample: string; tokens: number; latency: number; running: boolean;
};

const MODELS = [
  "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
  "gpt-4o", "gpt-4o-mini",
  "gemini-1.5-pro", "gemini-1.5-flash",
];

const MOCK_RESPONSES = [
  "NexusAI is an autonomous AI agent operating system that lets teams build, deploy, and orchestrate agents across Claude, GPT, and Gemini with production-grade safety and observability.\n\nKey capabilities:\n• Multi-step ReAct reasoning\n• Hybrid RAG over your docs\n• Sandboxed code execution\n• Human-in-the-loop approvals",
  "NexusAI is a platform for autonomous AI agents. It provides agent orchestration, retrieval-augmented generation, isolated code execution, real-time data ingestion, and comprehensive observability. Supports Claude, GPT, and Gemini models with smart routing.",
  "NexusAI is an agent OS. Run autonomous agents with tools, memory, and safety guardrails. Multi-model routing, hybrid search, sandbox execution.",
];

const MODEL_COSTS: Record<string, { in: number; out: number; speed: number }> = {
  "claude-opus-4-6":            { in: 15, out: 75, speed: 950 },
  "claude-sonnet-4-6":          { in: 3,  out: 15, speed: 540 },
  "claude-haiku-4-5-20251001":  { in: 0.8, out: 4, speed: 230 },
  "gpt-4o":                     { in: 2.5, out: 10, speed: 610 },
  "gpt-4o-mini":                { in: 0.15, out: 0.6, speed: 320 },
  "gemini-1.5-pro":             { in: 1.25, out: 5, speed: 740 },
  "gemini-1.5-flash":           { in: 0.075, out: 0.3, speed: 280 },
};

export default function ComparePage() {
  const [prompt, setPrompt] = useState("Explain NexusAI in 3-4 bullet points for a technical audience.");
  const [system, setSystem] = useState("You are a concise technical writer. Use plain language.");
  const [temp, setTemp] = useState(0.3);
  const [cols, setCols] = useState<ModelCol[]>([
    { id: "1", name: "claude-sonnet-4-6",       label: "Claude Sonnet", costIn: 3,    costOut: 15, sample: "",   tokens: 0, latency: 0, running: false },
    { id: "2", name: "gpt-4o-mini",             label: "GPT-4o mini",    costIn: 0.15, costOut: 0.6, sample: "",  tokens: 0, latency: 0, running: false },
    { id: "3", name: "gemini-1.5-flash",        label: "Gemini Flash",   costIn: 0.075, costOut: 0.3, sample: "", tokens: 0, latency: 0, running: false },
  ]);

  function setModel(id: string, name: string) {
    setCols((c) => c.map((col) => col.id === id ? { ...col, name, label: prettyLabel(name), costIn: MODEL_COSTS[name]?.in ?? 1, costOut: MODEL_COSTS[name]?.out ?? 1 } : col));
  }

  async function run() {
    setCols((c) => c.map((col) => ({ ...col, running: true, sample: "", tokens: 0, latency: 0 })));
    // Simulate streaming with jittered responses — real backend would POST to /compare
    cols.forEach((col, i) => {
      const speed = MODEL_COSTS[col.name]?.speed ?? 500;
      const latency = Math.round(speed + Math.random() * 200);
      const text = MOCK_RESPONSES[i % MOCK_RESPONSES.length]!;
      const chars = Math.round(text.length / 20);
      let shown = "";
      let idx = 0;
      const interval = setInterval(() => {
        shown += text.slice(idx, idx + chars);
        idx += chars;
        setCols((prev) => prev.map((pc) =>
          pc.id === col.id ? { ...pc, sample: shown, tokens: Math.round(shown.length / 4) } : pc,
        ));
        if (idx >= text.length) {
          clearInterval(interval);
          setCols((prev) => prev.map((pc) =>
            pc.id === col.id ? { ...pc, running: false, latency, tokens: Math.round(text.length / 4) } : pc,
          ));
        }
      }, Math.max(30, speed / 20));
    });
    toast.success("Running comparison");
  }

  return (
    <div>
      <PageHeader
        title="Model comparison"
        description="Run the same prompt across providers — compare output, latency, and cost side-by-side."
      />

      <Card className="mb-5">
        <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Label>Prompt</Label>
            <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <div>
            <Label>System prompt</Label>
            <Textarea rows={3} value={system} onChange={(e) => setSystem(e.target.value)} className="font-mono text-xs" />
          </div>
        </div>
        <div className="px-5 pb-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            <span>Temperature</span>
            <input type="range" min={0} max={2} step={0.1} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="accent-brand" />
            <span className="font-mono font-medium text-fg w-8">{temp.toFixed(1)}</span>
          </div>
          <Button onClick={run} leftIcon={<Play className="h-3.5 w-3.5" />}>Run comparison</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {cols.map((col) => {
          const cost = (col.tokens * (col.costIn + col.costOut)) / 2 / 1_000_000;
          return (
            <Card key={col.id} className="overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-border bg-bg-subtle">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Select value={col.name} onValueChange={(v) => setModel(col.id, v)}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {col.running && <Badge tone="brand" size="sm" dot pulse>Streaming</Badge>}
                </div>
                <div className="flex items-center gap-3 text-2xs text-fg-subtle">
                  <span className="inline-flex items-center gap-1"><DollarSign className="h-3 w-3" />${col.costIn}/${col.costOut}</span>
                  {col.latency > 0 && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{col.latency}ms</span>}
                  {col.tokens > 0 && <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" />{col.tokens} tok</span>}
                  {cost > 0 && <span className="inline-flex items-center gap-1 text-fg">${cost.toFixed(6)}</span>}
                </div>
              </div>
              <div className="flex-1 p-4 text-sm leading-relaxed whitespace-pre-wrap min-h-[320px] relative">
                {!col.sample && !col.running && (
                  <div className="text-fg-subtle text-center py-20">Click "Run comparison" to stream outputs</div>
                )}
                {col.sample}
                {col.running && <span className="inline-block h-3.5 w-0.5 bg-brand ml-0.5 animate-caret" />}
              </div>
              {col.sample && !col.running && (
                <div className="px-4 py-2 border-t border-border flex items-center justify-between text-2xs">
                  <Button variant="ghost" size="sm" leftIcon={<Copy className="h-3 w-3" />} onClick={() => { navigator.clipboard.writeText(col.sample); toast.success("Copied"); }}>
                    Copy
                  </Button>
                  <Badge tone="success" size="sm" dot>Complete</Badge>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Winner callout */}
      {cols.every((c) => c.sample && !c.running) && (
        <Card className="mt-5 p-5 bg-bg-subtle border-warn/30">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-warn/10 border border-warn/20 flex items-center justify-center shrink-0">
              <Crown className="h-4 w-4 text-warn" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold tracking-tight">Routing hint</h3>
              <p className="text-sm text-fg-muted mt-1 leading-relaxed">
                For this prompt type, <span className="font-medium text-fg">{cols.reduce((a, b) => a.latency && (a.latency < b.latency) ? a : b).label}</span> was the fastest,
                and <span className="font-medium text-fg">{cols.reduce((a, b) => (a.costIn + a.costOut) < (b.costIn + b.costOut) ? a : b).label}</span> was the cheapest.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function prettyLabel(id: string): string {
  if (id.includes("opus"))    return "Claude Opus";
  if (id.includes("sonnet"))  return "Claude Sonnet";
  if (id.includes("haiku"))   return "Claude Haiku";
  if (id === "gpt-4o")        return "GPT-4o";
  if (id.includes("mini"))    return "GPT-4o mini";
  if (id.includes("pro"))     return "Gemini Pro";
  if (id.includes("flash"))   return "Gemini Flash";
  return id;
}
