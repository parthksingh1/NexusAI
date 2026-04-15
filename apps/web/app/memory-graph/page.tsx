"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType,
  useNodesState, useEdgesState, type Node, type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Bot, Brain, Cpu, Zap, Wrench, Sparkles, Search, Filter, Network,
  RefreshCw, Download, Layers,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/cn";

type MemoryKind = "agent" | "episodic" | "semantic" | "procedural" | "reflection" | "tool" | "concept";

const KINDS: Record<MemoryKind, { label: string; color: string; icon: LucideIcon }> = {
  agent:      { label: "Agent",      color: "from-brand to-emerald-600",      icon: Bot },
  episodic:   { label: "Episodic",   color: "from-info to-blue-600",          icon: Brain },
  semantic:   { label: "Semantic",   color: "from-warn to-amber-600",         icon: Layers },
  procedural: { label: "Procedural", color: "from-success to-green-600",      icon: Sparkles },
  reflection: { label: "Reflection", color: "from-danger to-rose-600",        icon: Cpu },
  tool:       { label: "Tool",       color: "from-zinc-600 to-zinc-500",      icon: Wrench },
  concept:    { label: "Concept",    color: "from-fuchsia-500 to-pink-600",   icon: Network },
};

// Deterministic positions arranged in a few loose clusters
const INITIAL_NODES: Node[] = [
  { id: "a1", position: { x: 520, y: 280 }, data: { kind: "agent",      label: "Market Research", sub: "demo-research-001" }, type: "custom" },

  { id: "e1", position: { x: 220, y: 120 }, data: { kind: "episodic",   label: "Q3 2026 earnings call", sub: "imp 0.72" }, type: "custom" },
  { id: "e2", position: { x: 150, y: 260 }, data: { kind: "episodic",   label: "Competitor launch watch", sub: "imp 0.54" }, type: "custom" },
  { id: "e3", position: { x: 220, y: 420 }, data: { kind: "episodic",   label: "User preferences", sub: "imp 0.61" }, type: "custom" },

  { id: "s1", position: { x: 860, y: 120 }, data: { kind: "semantic",   label: "NVDA ROIC definition", sub: "source: 10-K" }, type: "custom" },
  { id: "s2", position: { x: 900, y: 260 }, data: { kind: "semantic",   label: "Tariff schedule 2026", sub: "source: Fed.gov" }, type: "custom" },
  { id: "s3", position: { x: 860, y: 420 }, data: { kind: "semantic",   label: "AI infra capex trend", sub: "source: blogs/twitter" }, type: "custom" },

  { id: "p1", position: { x: 520, y: 40 },  data: { kind: "procedural", label: "Cite every URL", sub: "imp 0.96" }, type: "custom" },
  { id: "p2", position: { x: 520, y: 540 }, data: { kind: "procedural", label: "Split long queries", sub: "imp 0.88" }, type: "custom" },

  { id: "r1", position: { x: 200, y: 540 }, data: { kind: "reflection", label: "Slow on multi-hop", sub: "from run r_02" }, type: "custom" },
  { id: "r2", position: { x: 880, y: 540 }, data: { kind: "reflection", label: "Good at summarization", sub: "from run r_04" }, type: "custom" },

  { id: "t1", position: { x: 60,  y: 60 },  data: { kind: "tool",       label: "web_search",        sub: "84% success" }, type: "custom" },
  { id: "t2", position: { x: 60,  y: 180 }, data: { kind: "tool",       label: "knowledge_search",  sub: "91% success" }, type: "custom" },
  { id: "t3", position: { x: 60,  y: 300 }, data: { kind: "tool",       label: "calculator",        sub: "100% success" }, type: "custom" },

  { id: "c1", position: { x: 1080, y: 60 },  data: { kind: "concept",   label: "Semiconductors" }, type: "custom" },
  { id: "c2", position: { x: 1080, y: 200 }, data: { kind: "concept",   label: "AI infrastructure" }, type: "custom" },
  { id: "c3", position: { x: 1080, y: 340 }, data: { kind: "concept",   label: "Earnings season" }, type: "custom" },
];

const INITIAL_EDGES: Edge[] = [
  { id: "x1",  source: "a1", target: "e1", label: "HAS_MEMORY" },
  { id: "x2",  source: "a1", target: "e2", label: "HAS_MEMORY" },
  { id: "x3",  source: "a1", target: "e3", label: "HAS_MEMORY" },
  { id: "x4",  source: "a1", target: "s1", label: "HAS_MEMORY" },
  { id: "x5",  source: "a1", target: "s2", label: "HAS_MEMORY" },
  { id: "x6",  source: "a1", target: "s3", label: "HAS_MEMORY" },
  { id: "x7",  source: "a1", target: "p1", label: "HAS_MEMORY" },
  { id: "x8",  source: "a1", target: "p2", label: "HAS_MEMORY" },
  { id: "x9",  source: "a1", target: "r1", label: "HAS_MEMORY" },
  { id: "x10", source: "a1", target: "r2", label: "HAS_MEMORY" },
  { id: "x11", source: "a1", target: "t1", label: "USED_TOOL" },
  { id: "x12", source: "a1", target: "t2", label: "USED_TOOL" },
  { id: "x13", source: "a1", target: "t3", label: "USED_TOOL" },
  { id: "x14", source: "e1", target: "s1", label: "RELATED_TO" },
  { id: "x15", source: "e2", target: "c1", label: "ABOUT" },
  { id: "x16", source: "s3", target: "c2", label: "ABOUT" },
  { id: "x17", source: "e1", target: "c3", label: "ABOUT" },
  { id: "x18", source: "r2", target: "p1", label: "INSPIRED" },
].map((e) => ({
  ...e,
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border-strong))" },
  style: { stroke: "hsl(var(--border-strong))", strokeWidth: 1.2 },
  labelStyle: { fill: "hsl(var(--fg-subtle))", fontSize: 10, fontFamily: "var(--font-mono)" },
  labelBgStyle: { fill: "hsl(var(--bg-elevated))" },
}));

function MemoryNode({ data }: { data: { kind: MemoryKind; label: string; sub?: string } }) {
  const meta = KINDS[data.kind];
  const Icon = meta.icon;
  return (
    <div className="group">
      <Handle type="target" position={Position.Left} className="!bg-border-strong !border-border !h-2 !w-2" />
      <div className="min-w-[170px] rounded-lg border border-border bg-bg-elevated shadow-sm hover:shadow-md hover:border-brand transition-all">
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg bg-gradient-to-r ${meta.color} text-white`}>
          <Icon className="h-3 w-3 shrink-0" />
          <span className="text-2xs font-semibold uppercase tracking-wider">{meta.label}</span>
        </div>
        <div className="px-2.5 py-2">
          <div className="text-xs font-medium truncate">{data.label}</div>
          {data.sub && <div className="text-2xs text-fg-subtle mt-0.5 font-mono truncate">{data.sub}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border-strong !border-border !h-2 !w-2" />
    </div>
  );
}

const nodeTypes = { custom: MemoryNode };

export default function MemoryGraphPage() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, , onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");

  const visibleNodes = useMemo(() => {
    return nodes.map((n) => {
      const matchesKind = kind === "all" || n.data.kind === kind;
      const matchesQ = !q || (n.data.label as string).toLowerCase().includes(q.toLowerCase());
      return { ...n, hidden: !(matchesKind && matchesQ) };
    });
  }, [nodes, q, kind]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) c[n.data.kind] = (c[n.data.kind] ?? 0) + 1;
    return c;
  }, [nodes]);

  return (
    <div>
      <PageHeader
        title="Memory graph"
        description="Visualize what agents have learned — episodic, semantic, procedural, and reflective memories, with typed relationships."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>Refresh</Button>
            <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export GraphML</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <Stat label="Nodes"       icon={Network} value={nodes.length} />
        <Stat label="Edges"       icon={Zap}     value={edges.length} />
        <Stat label="Episodic"    icon={Brain}   value={counts.episodic ?? 0} />
        <Stat label="Semantic"    icon={Layers}  value={counts.semantic ?? 0} />
        <Stat label="Procedural"  icon={Sparkles} value={counts.procedural ?? 0} />
        <Stat label="Reflections" icon={Cpu}     value={counts.reflection ?? 0} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <Input placeholder="Search nodes…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-40"><Filter className="h-3.5 w-3.5 text-fg-subtle" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1.5 text-2xs text-fg-subtle">
          <span>Backed by</span>
          <Badge size="sm">Neo4j 5</Badge>
        </div>
      </div>

      {/* Canvas */}
      <Card className="overflow-hidden">
        <div className="h-[560px] bg-bg-subtle">
          <ReactFlow
            nodes={visibleNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "smoothstep" }}
          >
            <Background color="hsl(var(--border))" gap={24} size={1} />
            <Controls className="!bg-bg-elevated !border !border-border !rounded-md !shadow-md [&>button]:!border-border [&>button]:!bg-bg-elevated [&>button]:!text-fg-muted hover:[&>button]:!bg-bg-hover" />
            <MiniMap
              className="!bg-bg-elevated !border !border-border !rounded-md"
              nodeColor={(n) => {
                const k = n.data?.kind as MemoryKind | undefined;
                return k === "agent" ? "hsl(var(--brand))" :
                       k === "episodic" ? "hsl(var(--info))" :
                       k === "semantic" ? "hsl(var(--warn))" :
                       k === "procedural" ? "hsl(var(--success))" :
                       k === "reflection" ? "hsl(var(--danger))" :
                       "hsl(var(--fg-subtle))";
              }}
              maskColor="hsl(var(--bg) / 0.85)"
              pannable zoomable
            />
          </ReactFlow>
        </div>
      </Card>

      {/* Legend */}
      <Card className="mt-4 p-4">
        <div className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">Node types</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {(Object.entries(KINDS) as [MemoryKind, typeof KINDS[MemoryKind]][]).map(([k, v]) => {
            const Icon = v.icon;
            return (
              <div key={k} className="flex items-center gap-2">
                <div className={`h-6 w-6 rounded-md bg-gradient-to-br ${v.color} flex items-center justify-center shrink-0`}>
                  <Icon className="h-3 w-3 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium">{v.label}</div>
                  <div className="text-2xs text-fg-subtle">{counts[k] ?? 0} nodes</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
