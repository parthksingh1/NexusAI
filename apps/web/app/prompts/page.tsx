"use client";

import { useState } from "react";
import {
  FileText, Plus, GitBranch, Copy, Play, Beaker, Clock, CheckCircle2, Star,
  Tag, MoreHorizontal, Edit,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown";

type Prompt = {
  id: string; name: string; description: string; tag: string; versions: number;
  currentVersion: string; stars: number; updatedAt: string; author: string; body: string;
};

const PROMPTS: Prompt[] = [
  { id: "p1", name: "Research assistant system", description: "Base system prompt for research agents", tag: "system", versions: 7, currentVersion: "v7", stars: 12, updatedAt: new Date(Date.now() - 3 * 86400_000).toISOString(), author: "Alex Chen", body: "You are a careful research assistant. Always cite the URLs your claims are grounded in. Prefer primary sources over secondary ones. When information is uncertain, say so explicitly." },
  { id: "p2", name: "SQL generation",             description: "NL → SQL with schema awareness",         tag: "tool",   versions: 4, currentVersion: "v4", stars: 8, updatedAt: new Date(Date.now() - 10 * 86400_000).toISOString(), author: "Raj Patel", body: "Given the following schema, generate a Postgres query that answers the user's question. Prefer CTEs for readability. Never use SELECT *. Return only the SQL, no commentary." },
  { id: "p3", name: "Sentiment classifier",       description: "Negative/neutral/positive with confidence", tag: "classifier", versions: 3, currentVersion: "v3", stars: 5, updatedAt: new Date(Date.now() - 20 * 86400_000).toISOString(), author: "Priya Rao", body: "Classify the following text as negative, neutral, or positive. Reply strictly as JSON: {\"label\": \"negative|neutral|positive\", \"confidence\": 0-1}" },
  { id: "p4", name: "Email draft generator",      description: "Personalized outreach email drafts",      tag: "email",  versions: 6, currentVersion: "v6", stars: 18, updatedAt: new Date(Date.now() - 1 * 86400_000).toISOString(), author: "David Kim", body: "Draft a warm, concise outreach email to the prospect described below. Avoid formulaic openers. Keep it under 120 words. Include a clear call-to-action." },
  { id: "p5", name: "Incident postmortem",        description: "Structured postmortem from a timeline",    tag: "ops",    versions: 2, currentVersion: "v2", stars: 6, updatedAt: new Date(Date.now() - 7 * 86400_000).toISOString(), author: "Marcus Lee", body: "Generate an incident postmortem with sections: Summary, Timeline, Root cause, Impact, Action items. Use the bullet-point format." },
];

export default function PromptsPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Prompt | null>(null);
  const filtered = PROMPTS.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Prompt library"
        description="Versioned prompts with diffs, A/B tests, and usage tracking."
        actions={<Button leftIcon={<Plus className="h-3.5 w-3.5" />}>New prompt</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Prompts"       icon={FileText}   value={PROMPTS.length} />
        <Stat label="Versions"       icon={GitBranch}  value={PROMPTS.reduce((a, b) => a + b.versions, 0)} />
        <Stat label="Used in agents" icon={Play}       value="28" />
        <Stat label="Active tests"   icon={Beaker}     value={3} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5">
          <Card className="mb-3 p-3">
            <Input placeholder="Search prompts…" value={q} onChange={(e) => setQ(e.target.value)} />
          </Card>
          <Card>
            <ul className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelected(p)}
                    className={`w-full p-4 flex items-start gap-3 text-left hover:bg-bg-hover transition-colors ${selected?.id === p.id ? "bg-bg-hover border-l-2 border-brand" : ""}`}
                  >
                    <div className="h-8 w-8 rounded-md bg-bg-muted border border-border flex items-center justify-center shrink-0">
                      <FileText className="h-3.5 w-3.5 text-fg-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{p.name}</span>
                        <Badge size="sm">{p.currentVersion}</Badge>
                      </div>
                      <div className="text-xs text-fg-muted truncate mt-0.5">{p.description}</div>
                      <div className="flex items-center gap-3 text-2xs text-fg-subtle mt-1">
                        <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{p.tag}</span>
                        <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{p.stars}</span>
                        <span>{formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="lg:col-span-7">
          {selected ? (
            <Card>
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold tracking-tight text-[15px]">{selected.name}</h2>
                    <p className="text-xs text-fg-muted mt-0.5">{selected.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" leftIcon={<Edit className="h-3 w-3" />}>Edit</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><Copy className="h-3.5 w-3.5" />Duplicate</DropdownMenuItem>
                        <DropdownMenuItem><Beaker className="h-3.5 w-3.5" />Start A/B test</DropdownMenuItem>
                        <DropdownMenuItem><Play className="h-3.5 w-3.5" />Try in playground</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
              <Tabs defaultValue="content">
                <TabsList className="mx-5 mt-4">
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="versions">Versions ({selected.versions})</TabsTrigger>
                  <TabsTrigger value="usage">Used in</TabsTrigger>
                  <TabsTrigger value="tests">A/B tests</TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="px-5 pb-5">
                  <pre className="mt-2 p-4 rounded-lg border border-border bg-bg-subtle text-xs font-mono leading-relaxed whitespace-pre-wrap">
{selected.body}
                  </pre>
                </TabsContent>

                <TabsContent value="versions" className="px-5 pb-5">
                  <ul className="divide-y divide-border border border-border rounded-lg bg-bg-elevated">
                    {Array.from({ length: selected.versions }, (_, i) => selected.versions - i).map((v) => (
                      <li key={v} className="flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors">
                        <Badge size="sm" tone={v === selected.versions ? "brand" : "neutral"}>v{v}</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-fg truncate">
                            {v === selected.versions ? "Current · " : ""}
                            Improved citation format
                          </div>
                          <div className="text-2xs text-fg-subtle">
                            {selected.author} · {Math.floor(Math.random() * 30 + 1)}d ago
                          </div>
                        </div>
                        {v === selected.versions ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Button variant="ghost" size="sm">Diff</Button>}
                      </li>
                    ))}
                  </ul>
                </TabsContent>

                <TabsContent value="usage" className="px-5 pb-5">
                  <div className="space-y-2">
                    {["Market Research", "Research Assistant", "Content Writer"].map((a) => (
                      <div key={a} className="flex items-center justify-between p-3 rounded-md border border-border">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-md bg-brand-muted border border-brand-border" />
                          <span className="text-sm font-medium">{a}</span>
                        </div>
                        <Badge size="sm" dot tone="success">Active</Badge>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="tests" className="px-5 pb-5">
                  <Card className="p-4 bg-bg-subtle">
                    <div className="flex items-center gap-2 mb-2">
                      <Beaker className="h-4 w-4 text-brand" />
                      <span className="font-medium text-sm">v6 vs v7 · 248 samples</span>
                      <Badge tone="success" size="sm" dot>Running</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div className="p-3 rounded-md border border-border bg-bg-elevated">
                        <div className="text-2xs text-fg-subtle uppercase tracking-wider font-semibold">v6 baseline</div>
                        <div className="mt-1 text-xl font-semibold tracking-tighter">82.4%</div>
                        <div className="text-2xs text-fg-subtle">Accuracy · 120 samples</div>
                      </div>
                      <div className="p-3 rounded-md border border-brand bg-brand-muted/20">
                        <div className="text-2xs text-brand uppercase tracking-wider font-semibold flex items-center gap-1">v7 challenger <Star className="h-3 w-3 text-warn" /></div>
                        <div className="mt-1 text-xl font-semibold tracking-tighter">87.1%</div>
                        <div className="text-2xs text-success font-medium">+4.7pp · 128 samples</div>
                      </div>
                    </div>
                    <Button size="sm" className="mt-3">Promote v7</Button>
                  </Card>
                </TabsContent>
              </Tabs>
            </Card>
          ) : (
            <Card className="p-10 flex items-center justify-center text-sm text-fg-subtle h-full">
              Select a prompt to view details, versions, and A/B tests.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
