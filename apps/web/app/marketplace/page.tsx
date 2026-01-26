"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Store, Star, GitFork, Bot, Search, TrendingUp, Flame, Sparkles, Award,
  Users, ArrowRight, Download, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";

type MarketAgent = {
  id: string; name: string; description: string; author: string; authorInitials: string;
  stars: number; installs: number; category: string; tools: string[]; featured?: boolean;
  updated: string;
};

const MOCK: MarketAgent[] = [
  { id: "m1", name: "Stock Research Analyst",      description: "Research public markets, summarize earnings calls, produce cited briefings.",  author: "Alex Chen",     authorInitials: "AC", stars: 842, installs: 2140, category: "Finance",      tools: ["web_search", "knowledge_search", "calculator"], featured: true, updated: "2d ago" },
  { id: "m2", name: "Customer Support L1",         description: "Answer tier-1 customer questions with KB grounding and smart escalation.",      author: "Sofia Park",   authorInitials: "SP", stars: 612, installs: 1832, category: "Support",       tools: ["knowledge_search", "web_search"], featured: true, updated: "5d ago" },
  { id: "m3", name: "Weekly SEO Writer",           description: "Generate SEO-optimized blog drafts from a topic brief. Includes outlines.",     author: "Liam Foster",  authorInitials: "LF", stars: 478, installs: 1420, category: "Content",       tools: ["web_search", "knowledge_search"], updated: "1w ago" },
  { id: "m4", name: "DevOps Incident Triage",       description: "Parse incident logs, surface likely root causes, draft postmortems.",          author: "Priya Rao",    authorInitials: "PR", stars: 389, installs: 1120, category: "DevOps",        tools: ["code_exec", "github_read_file"], featured: true, updated: "3d ago" },
  { id: "m5", name: "GitHub Issue Triager",         description: "Label issues, suggest assignees, identify duplicates across repos.",           author: "Marcus Lee",   authorInitials: "ML", stars: 324, installs: 890,  category: "DevOps",        tools: ["github_read_file", "knowledge_search"], updated: "1w ago" },
  { id: "m6", name: "Legal Contract Reviewer",      description: "Review contracts for unusual clauses. Compare against standard templates.",    author: "Emma Wilson",  authorInitials: "EW", stars: 267, installs: 620,  category: "Legal",         tools: ["knowledge_search"], updated: "4d ago" },
  { id: "m7", name: "Sales Lead Researcher",        description: "Research prospects, find contact details, draft personalized outreach.",       author: "David Kim",    authorInitials: "DK", stars: 451, installs: 1340, category: "Sales",         tools: ["web_search", "knowledge_search"], updated: "6h ago" },
  { id: "m8", name: "Recipe Generator",             description: "Personalized meal plans from dietary constraints. With grocery list.",         author: "Yuki Tanaka",  authorInitials: "YT", stars: 198, installs: 540,  category: "Lifestyle",     tools: ["web_search"], updated: "2w ago" },
  { id: "m9", name: "Data Analyst Copilot",         description: "Query datasets, generate dashboards, surface metric anomalies.",               author: "Raj Patel",    authorInitials: "RP", stars: 523, installs: 1680, category: "Analytics",     tools: ["code_exec", "calculator", "knowledge_search"], updated: "3d ago" },
];

const CATEGORIES = ["All", "Finance", "Support", "Content", "DevOps", "Legal", "Sales", "Lifestyle", "Analytics"];

export default function MarketplacePage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<"popular" | "recent" | "installs">("popular");
  const [agents, setAgents] = useState<MarketAgent[]>(MOCK);

  useEffect(() => {
    fetch("/api/orch/marketplace/agents")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.agents?.length) setAgents(d.agents); })
      .catch(() => { /* use mock */ });
  }, []);

  const filtered = useMemo(() => {
    let out = agents;
    if (cat !== "All") out = out.filter((a) => a.category === cat);
    if (q) {
      const s = q.toLowerCase();
      out = out.filter((a) => a.name.toLowerCase().includes(s) || a.description.toLowerCase().includes(s));
    }
    if (sort === "recent")   out = [...out].sort((a, b) => a.updated.localeCompare(b.updated));
    else if (sort === "installs") out = [...out].sort((a, b) => b.installs - a.installs);
    else out = [...out].sort((a, b) => b.stars - a.stars);
    return out;
  }, [agents, q, cat, sort]);

  const featured = agents.filter((a) => a.featured).slice(0, 3);

  async function fork(id: string, name: string) {
    try {
      const r = await fetch(`/api/orch/marketplace/agents/${id}/fork`, { method: "POST" });
      if (r.ok) { toast.success(`Forked "${name}"`); window.location.href = "/agents"; return; }
    } catch { /* fall through */ }
    toast.success(`Forked "${name}" (demo mode)`);
  }

  return (
    <div>
      <PageHeader
        title="Marketplace"
        description="Discover, fork, and share agents built by the community."
        actions={<Button variant="secondary" leftIcon={<Sparkles className="h-3.5 w-3.5" />}>Publish my agent</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Total agents"   icon={Bot}         value={agents.length} />
        <Stat label="Installs (30d)" icon={Download}    value="12.4k" />
        <Stat label="Contributors"   icon={Users}       value="847" />
        <Stat label="Trending"       icon={TrendingUp}  value="+23%" hint="Week over week" />
      </div>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-warn" />
              <h2 className="font-semibold tracking-tight">Featured</h2>
            </div>
            <Badge tone="warn" size="sm" dot>Editor's picks</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {featured.map((a) => (
              <Card key={a.id} interactive className="p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 h-24 w-24 bg-brand/5 blur-3xl pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-10 w-10 rounded-md bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center shrink-0">
                      <Bot className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold tracking-tight truncate">{a.name}</div>
                      <div className="text-2xs text-fg-subtle">by {a.author}</div>
                    </div>
                  </div>
                  <p className="text-sm text-fg-muted line-clamp-2 leading-relaxed">{a.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-2xs text-fg-subtle">
                      <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{a.stars}</span>
                      <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" />{a.installs}</span>
                    </div>
                    <Button size="sm" leftIcon={<GitFork className="h-3 w-3" />} onClick={() => fork(a.id, a.name)}>Fork</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <Input placeholder="Search agents…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="w-40"><TrendingUp className="h-3.5 w-3.5 text-fg-subtle" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Most starred</SelectItem>
            <SelectItem value="installs">Most installed</SelectItem>
            <SelectItem value="recent">Recently updated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={cat} onValueChange={setCat}>
        <TabsList className="flex-wrap h-auto">
          {CATEGORIES.map((c) => <TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={cat}>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-fg-subtle">
              No agents match your search.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((a) => (
                <Card key={a.id} interactive className="p-5 flex flex-col">
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-9 w-9 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-brand" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold tracking-tight truncate">{a.name}</div>
                        <div className="text-2xs text-fg-subtle">by {a.author}</div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1 text-2xs text-fg-muted font-mono shrink-0">
                      <Star className="h-3 w-3" />{a.stars}
                    </div>
                  </div>
                  <p className="text-sm text-fg-muted line-clamp-3 leading-relaxed flex-1">{a.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {a.tools.slice(0, 3).map((t) => <Badge key={t} size="sm">{t}</Badge>)}
                    {a.tools.length > 3 && <span className="text-2xs text-fg-subtle self-center">+{a.tools.length - 3}</span>}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-border">
                    <div className="flex items-center gap-3 text-2xs text-fg-subtle">
                      <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" />{a.installs}</span>
                      <span>{a.updated}</span>
                    </div>
                    <Button size="sm" variant="secondary" leftIcon={<GitFork className="h-3 w-3" />} onClick={() => fork(a.id, a.name)}>Fork</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
