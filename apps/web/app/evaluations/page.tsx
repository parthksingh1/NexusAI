"use client";

import { useState } from "react";
import {
  Target, Plus, Play, CheckCircle2, XCircle, Circle, Upload, BarChart3,
  TrendingUp, TrendingDown, GitCompare, Beaker, FileSpreadsheet, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  RadarChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
} from "recharts";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";

type Dataset = {
  id: string; name: string; description: string; rows: number;
  category: string; updatedAt: string;
};

type EvalRun = {
  id: string; dataset: string; agent: string; model: string;
  accuracy: number; faithfulness: number; latencyMs: number; cost: number;
  status: "running" | "completed" | "failed"; progress: number;
  ranAt: string; samples: number;
};

const DATASETS: Dataset[] = [
  { id: "ds_1", name: "Customer intent classification", description: "500 real support tickets labeled by L2 agents", rows: 500, category: "Classification", updatedAt: new Date(Date.now() - 2 * 86400_000).toISOString() },
  { id: "ds_2", name: "Financial Q&A golden set",        description: "128 questions with cited answers from 10-Ks", rows: 128, category: "RAG",             updatedAt: new Date(Date.now() - 7 * 86400_000).toISOString() },
  { id: "ds_3", name: "SQL generation benchmarks",       description: "250 natural-language → SQL pairs",           rows: 250, category: "Code",            updatedAt: new Date(Date.now() - 14 * 86400_000).toISOString() },
  { id: "ds_4", name: "Summarization quality",           description: "Long-form article summaries with judgments", rows: 80, category: "Summarization",   updatedAt: new Date(Date.now() - 21 * 86400_000).toISOString() },
];

const RUNS: EvalRun[] = [
  { id: "ev_1", dataset: "Customer intent classification", agent: "Support L1",       model: "claude-sonnet-4-6",  accuracy: 0.92, faithfulness: 0.88, latencyMs: 840,  cost: 0.42, status: "completed", progress: 100, ranAt: new Date(Date.now() - 2 * 3600_000).toISOString(), samples: 500 },
  { id: "ev_2", dataset: "Customer intent classification", agent: "Support L1",       model: "gpt-4o-mini",        accuracy: 0.84, faithfulness: 0.82, latencyMs: 620,  cost: 0.18, status: "completed", progress: 100, ranAt: new Date(Date.now() - 2 * 3600_000).toISOString(), samples: 500 },
  { id: "ev_3", dataset: "Customer intent classification", agent: "Support L1",       model: "gemini-1.5-flash",   accuracy: 0.81, faithfulness: 0.79, latencyMs: 390,  cost: 0.08, status: "completed", progress: 100, ranAt: new Date(Date.now() - 2 * 3600_000).toISOString(), samples: 500 },
  { id: "ev_4", dataset: "Financial Q&A golden set",       agent: "Market Analyst",    model: "claude-opus-4-6",    accuracy: 0.95, faithfulness: 0.96, latencyMs: 2200, cost: 1.84, status: "completed", progress: 100, ranAt: new Date(Date.now() - 24 * 3600_000).toISOString(), samples: 128 },
  { id: "ev_5", dataset: "SQL generation benchmarks",      agent: "Code Helper",        model: "claude-sonnet-4-6",  accuracy: 0.74, faithfulness: 0.91, latencyMs: 1100, cost: 0.28, status: "running", progress: 62, ranAt: new Date(Date.now() - 10 * 60_000).toISOString(), samples: 155 },
];

const RADAR_DATA = [
  { metric: "Accuracy",     claude: 92, gpt: 84,  gemini: 81 },
  { metric: "Faithfulness", claude: 88, gpt: 82,  gemini: 79 },
  { metric: "Relevance",    claude: 91, gpt: 85,  gemini: 83 },
  { metric: "Latency",      claude: 72, gpt: 82,  gemini: 95 },
  { metric: "Cost efficiency", claude: 65, gpt: 80, gemini: 92 },
  { metric: "Consistency",  claude: 90, gpt: 79,  gemini: 78 },
];

export default function EvaluationsPage() {
  const [tab, setTab] = useState("runs");
  const [newRun, setNewRun] = useState(false);

  return (
    <div>
      <PageHeader
        title="Evaluations"
        description="Benchmark agents on golden datasets with LLM-as-judge scoring. Compare models side by side."
        actions={
          <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNewRun(true)}>New evaluation</Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Datasets"      icon={FileSpreadsheet} value={DATASETS.length} />
        <Stat label="Runs total"    icon={Beaker}          value={RUNS.length} />
        <Stat label="Avg accuracy"  icon={Target}          value="86.2%" delta={{ value: "+2.4%", positive: true }} />
        <Stat label="Best model"    icon={TrendingUp}      value="Opus 4.6" hint="95% on Financial Q&A" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="compare">Compare models</TabsTrigger>
          <TabsTrigger value="judges">Judges</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <Card>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold tracking-tight">Evaluation runs</h3>
                <p className="text-xs text-fg-muted mt-0.5">Results across datasets and models.</p>
              </div>
              <div className="flex items-center gap-2">
                <Select defaultValue="all">
                  <SelectTrigger className="w-40 h-8 text-xs"><Filter className="h-3 w-3 text-fg-subtle" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All datasets</SelectItem>
                    {DATASETS.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border bg-bg-subtle/50">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Agent</th>
                  <th className="text-left font-medium">Dataset</th>
                  <th className="text-left font-medium">Model</th>
                  <th className="text-right font-medium">Accuracy</th>
                  <th className="text-right font-medium">Faithful</th>
                  <th className="text-right font-medium">P50 ms</th>
                  <th className="text-right font-medium">Cost</th>
                  <th className="text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {RUNS.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                    <td className="px-5 py-3 font-medium">{r.agent}</td>
                    <td className="text-xs text-fg-muted">{r.dataset}</td>
                    <td className="font-mono text-xs">{r.model}</td>
                    <td className="text-right"><ScoreCell score={r.accuracy} /></td>
                    <td className="text-right"><ScoreCell score={r.faithfulness} /></td>
                    <td className="text-right font-mono text-xs">{r.latencyMs}</td>
                    <td className="text-right font-mono text-xs">${r.cost.toFixed(2)}</td>
                    <td className="text-center">
                      {r.status === "running" ? (
                        <div className="flex items-center gap-2 justify-center">
                          <Progress value={r.progress} className="w-16" />
                          <span className="text-2xs text-fg-subtle font-mono">{r.progress}%</span>
                        </div>
                      ) : r.status === "completed" ? (
                        <Badge tone="success" size="sm" dot>Done</Badge>
                      ) : (
                        <Badge tone="danger" size="sm">Failed</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="datasets">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {DATASETS.map((d) => (
              <Card key={d.id} className="p-5 group" interactive>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-md bg-bg-muted border border-border flex items-center justify-center">
                      <FileSpreadsheet className="h-4 w-4 text-fg-muted" />
                    </div>
                    <div>
                      <h3 className="font-semibold tracking-tight">{d.name}</h3>
                      <Badge size="sm">{d.category}</Badge>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-fg-muted line-clamp-2 leading-relaxed mt-2">{d.description}</p>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-2xs text-fg-subtle">
                  <span className="font-mono">{d.rows} rows</span>
                  <span>Updated {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}</span>
                </div>
              </Card>
            ))}
            <Card className="p-5 border-dashed flex flex-col items-center justify-center text-center min-h-[180px] cursor-pointer hover:border-brand hover:bg-brand-muted/20 transition-all" onClick={() => toast.info("Dataset upload")}>
              <div className="h-10 w-10 rounded-md bg-bg-muted border border-border flex items-center justify-center mb-2">
                <Upload className="h-4 w-4 text-fg-muted" />
              </div>
              <div className="text-sm font-medium">Upload dataset</div>
              <div className="text-xs text-fg-muted mt-1">CSV, JSON, or JSONL with golden answers</div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="compare">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="px-5 py-4 border-b border-border">
                <h3 className="font-semibold tracking-tight">Model comparison</h3>
                <p className="text-xs text-fg-muted mt-0.5">Normalized scores across six dimensions</p>
              </div>
              <div className="p-5 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={RADAR_DATA}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "hsl(var(--fg-muted))", fontSize: 10 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "hsl(var(--fg-subtle))", fontSize: 9 }} />
                    <Radar name="Claude Sonnet" dataKey="claude" stroke="hsl(var(--brand))" fill="hsl(var(--brand))" fillOpacity={0.25} strokeWidth={2} />
                    <Radar name="GPT-4o mini"   dataKey="gpt"    stroke="hsl(var(--info))"  fill="hsl(var(--info))"  fillOpacity={0.2}  strokeWidth={2} />
                    <Radar name="Gemini Flash"  dataKey="gemini" stroke="hsl(var(--warn))"  fill="hsl(var(--warn))"  fillOpacity={0.15} strokeWidth={2} />
                    <ReTooltip contentStyle={tooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-4 mt-2 text-xs">
                  <LegendDot color="var(--brand)" label="Claude Sonnet" />
                  <LegendDot color="var(--info)"  label="GPT-4o mini" />
                  <LegendDot color="var(--warn)"  label="Gemini Flash" />
                </div>
              </div>
            </Card>

            <Card>
              <div className="px-5 py-4 border-b border-border">
                <h3 className="font-semibold tracking-tight">Pareto frontier</h3>
                <p className="text-xs text-fg-muted mt-0.5">Cost vs quality — lower-right is best</p>
              </div>
              <div className="p-5 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { model: "Opus 4.6",   quality: 95, cost: 1.84 },
                    { model: "Sonnet 4.6", quality: 92, cost: 0.42 },
                    { model: "GPT-4o",     quality: 88, cost: 0.61 },
                    { model: "GPT-4o mini",quality: 84, cost: 0.18 },
                    { model: "Gemini Pro", quality: 86, cost: 0.31 },
                    { model: "Gemini Flash",quality:81, cost: 0.08 },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="model" tickLine={false} axisLine={false} fontSize={10} stroke="hsl(var(--fg-subtle))" />
                    <YAxis yAxisId="l" tickLine={false} axisLine={false} fontSize={10} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `${v}%`} />
                    <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={10} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `$${v}`} />
                    <ReTooltip contentStyle={tooltipStyle} />
                    <Bar yAxisId="l" dataKey="quality" fill="hsl(var(--brand))"  radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="r" dataKey="cost"    fill="hsl(var(--warn))"  radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="mt-4 p-5 bg-bg-subtle">
            <div className="flex items-start gap-3">
              <GitCompare className="h-5 w-5 text-brand shrink-0" />
              <div>
                <h3 className="font-semibold tracking-tight">Routing recommendation</h3>
                <p className="text-sm text-fg-muted mt-1 leading-relaxed max-w-3xl">
                  Based on 500 evaluations: <span className="font-medium text-fg">Claude Sonnet 4.6</span> is the best default for customer classification
                  (92% accuracy, $0.42 per run). For latency-critical paths,
                  <span className="font-medium text-fg"> Gemini 1.5 Flash</span> delivers 390ms p50 at 1/5 the cost. Route high-stakes
                  financial queries to <span className="font-medium text-fg">Claude Opus 4.6</span>.
                </p>
                <Button size="sm" className="mt-3" onClick={() => toast.success("Router updated")}>Apply recommended policy</Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="judges">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { name: "Accuracy",     desc: "Does the answer match the golden reference?",            model: "gpt-4o", samples: 2340 },
              { name: "Faithfulness", desc: "Is the answer grounded in the provided sources?",         model: "claude-sonnet-4-6", samples: 2340 },
              { name: "Relevance",    desc: "Does the answer address the actual question?",            model: "gemini-1.5-pro", samples: 2340 },
              { name: "Toxicity",     desc: "Does the output contain harmful or unsafe content?",      model: "claude-haiku-4-5", samples: 2340 },
              { name: "Coherence",    desc: "Is the answer well-structured and consistent?",           model: "gpt-4o-mini", samples: 2340 },
              { name: "Conciseness",  desc: "Is the answer appropriately brief without omitting?",     model: "claude-haiku-4-5", samples: 2340 },
            ].map((j) => (
              <Card key={j.name} className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-brand" />
                  <h3 className="font-semibold tracking-tight">{j.name}</h3>
                </div>
                <p className="text-sm text-fg-muted leading-relaxed">{j.desc}</p>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-2xs text-fg-subtle">
                  <span className="font-mono">{j.model}</span>
                  <span>{j.samples.toLocaleString()} judgments</span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={newRun}
        onOpenChange={setNewRun}
        title="New evaluation run"
        description="Score an agent against a golden dataset."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewRun(false)}>Cancel</Button>
            <Button onClick={() => { setNewRun(false); toast.success("Evaluation queued"); }} leftIcon={<Play className="h-3.5 w-3.5" />}>Start run</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-fg-muted">Dataset</label>
            <Select defaultValue="ds_1">
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATASETS.map((d) => <SelectItem key={d.id} value={d.id}>{d.name} ({d.rows} rows)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted">Agent</label>
            <Select defaultValue="research">
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="research">Market Research</SelectItem>
                <SelectItem value="support">Customer Support</SelectItem>
                <SelectItem value="coder">Code Helper</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted">Models to test</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {["claude-opus-4-6", "claude-sonnet-4-6", "gpt-4o", "gpt-4o-mini", "gemini-1.5-pro", "gemini-1.5-flash"].map((m) => (
                <label key={m} className="flex items-center gap-2 p-2 rounded-md border border-border bg-bg-elevated text-xs font-mono cursor-pointer hover:bg-bg-hover transition-colors">
                  <input type="checkbox" defaultChecked={m.includes("sonnet") || m.includes("mini")} className="accent-brand" />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted">Judges to apply</label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {["Accuracy", "Faithfulness", "Relevance", "Toxicity"].map((j) => (
                <Badge key={j} tone="brand" size="sm">{j}</Badge>
              ))}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ScoreCell({ score }: { score: number }) {
  const pct = score * 100;
  const tone = pct >= 90 ? "success" : pct >= 75 ? "brand" : pct >= 60 ? "warn" : "danger";
  const color = { success: "text-success", brand: "text-brand", warn: "text-warn", danger: "text-danger" }[tone];
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={`font-mono text-xs font-medium ${color}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-fg-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: `hsl(${color})` }} />
      <span>{label}</span>
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
