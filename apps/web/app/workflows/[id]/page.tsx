"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ReactFlow, Controls, Background, MiniMap, useNodesState, useEdgesState,
  addEdge, MarkerType, Handle, Position, type Node, type Edge, type Connection,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  ArrowLeft, Play, Save, Zap, Bot, Database, GitFork, Filter, Send, Code2,
  Clock, Settings as Cog, Sparkles, Plus, Wand2, Download, Share2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

type NodeKind = "trigger" | "agent" | "tool" | "branch" | "llm" | "output";

const NODE_TYPES: Array<{ id: NodeKind; label: string; icon: LucideIcon; color: string; desc: string }> = [
  { id: "trigger", label: "Trigger",  icon: Zap,      color: "from-amber-500 to-orange-500",   desc: "Webhook, schedule, or manual start" },
  { id: "agent",   label: "Agent",    icon: Bot,      color: "from-brand to-emerald-600",       desc: "Run an autonomous agent" },
  { id: "tool",    label: "Tool",     icon: Cog,      color: "from-zinc-600 to-zinc-500",       desc: "Invoke a single tool" },
  { id: "llm",     label: "LLM call", icon: Sparkles, color: "from-info to-blue-600",           desc: "One-shot model call" },
  { id: "branch",  label: "Branch",   icon: GitFork,  color: "from-warn to-yellow-600",         desc: "Conditional routing" },
  { id: "output",  label: "Output",   icon: Send,     color: "from-success to-green-600",       desc: "Email, webhook, or store" },
];

const initialNodes: Node[] = [
  { id: "n1", position: { x: 80, y: 80 },  data: { kind: "trigger", label: "Webhook", sub: "POST /api/v1/trigger" }, type: "custom" },
  { id: "n2", position: { x: 360, y: 80 }, data: { kind: "agent", label: "Research Assistant", sub: "Claude Sonnet" }, type: "custom" },
  { id: "n3", position: { x: 640, y: 40 }, data: { kind: "branch", label: "If sentiment", sub: "negative → escalate" }, type: "custom" },
  { id: "n4", position: { x: 920, y: 0 },  data: { kind: "agent", label: "Escalation Agent", sub: "GPT-4o" }, type: "custom" },
  { id: "n5", position: { x: 920, y: 120 }, data: { kind: "tool", label: "Slack notify", sub: "#support" }, type: "custom" },
  { id: "n6", position: { x: 1200, y: 60 }, data: { kind: "output", label: "Send email", sub: "customer@example.com" }, type: "custom" },
];

const initialEdges: Edge[] = [
  { id: "e1", source: "n1", target: "n2", markerEnd: { type: MarkerType.ArrowClosed }, animated: true },
  { id: "e2", source: "n2", target: "n3", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e3", source: "n3", target: "n4", label: "neg", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e4", source: "n3", target: "n5", label: "pos", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e5", source: "n4", target: "n6", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e6", source: "n5", target: "n6", markerEnd: { type: MarkerType.ArrowClosed } },
];

// ─── Custom node component ───────────────────────────────────────
function WorkflowNode({ data }: { data: { kind: NodeKind; label: string; sub?: string } }) {
  const meta = NODE_TYPES.find((t) => t.id === data.kind)!;
  const Icon = meta.icon;
  return (
    <div className="group relative">
      <Handle type="target" position={Position.Left} className="!bg-brand !border-brand !h-2.5 !w-2.5" />
      <div className="min-w-[200px] rounded-lg border border-border bg-bg-elevated shadow-md hover:shadow-lg hover:border-brand transition-all duration-200">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg bg-gradient-to-r ${meta.color} text-white`}>
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider">{meta.label}</span>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-sm font-medium truncate">{data.label}</div>
          {data.sub && <div className="text-2xs text-fg-subtle mt-0.5 font-mono truncate">{data.sub}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-brand !border-brand !h-2.5 !w-2.5" />
    </div>
  );
}

const nodeTypes = { custom: WorkflowNode };

export default function WorkflowBuilder() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges],
  );

  const addNode = (kind: NodeKind) => {
    const meta = NODE_TYPES.find((t) => t.id === kind)!;
    const id = `n${Date.now()}`;
    setNodes((ns) => [
      ...ns,
      { id, position: { x: 200 + Math.random() * 400, y: 200 + Math.random() * 200 }, data: { kind, label: meta.label }, type: "custom" },
    ]);
    toast.success(`Added ${meta.label}`);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -m-8">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-subtle">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/workflows"><ArrowLeft className="h-3.5 w-3.5" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold tracking-tight">Customer feedback pipeline</h1>
              <Badge tone="success" dot pulse size="sm">Active</Badge>
            </div>
            <div className="text-2xs text-fg-subtle mt-0.5">Edited 3 minutes ago</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" leftIcon={<Wand2 className="h-3.5 w-3.5" />}>Auto-layout</Button>
          <Button variant="ghost" size="sm" leftIcon={<Share2 className="h-3.5 w-3.5" />}>Share</Button>
          <Button variant="ghost" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export</Button>
          <Button variant="secondary" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={() => toast.success("Saved")}>Save</Button>
          <Button size="sm" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => toast.success("Test run started")}>Test run</Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: node palette */}
        <aside className="w-64 shrink-0 border-r border-border bg-bg-subtle overflow-y-auto">
          <Tabs defaultValue="nodes">
            <TabsList className="m-3 h-8">
              <TabsTrigger value="nodes" className="text-2xs">Nodes</TabsTrigger>
              <TabsTrigger value="templates" className="text-2xs">Templates</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="px-3">
            <div className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">Blocks</div>
            <div className="space-y-1.5">
              {NODE_TYPES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => addNode(t.id)}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-md border border-border bg-bg-elevated hover:border-brand hover:bg-brand-muted/20 transition-all text-left group"
                    draggable
                  >
                    <div className={`h-8 w-8 rounded-md bg-gradient-to-br ${t.color} flex items-center justify-center shrink-0`}>
                      <Icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{t.label}</div>
                      <div className="text-2xs text-fg-subtle truncate">{t.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">Starter templates</div>
            <div className="space-y-1.5">
              {["RAG pipeline", "Multi-agent debate", "Human handoff", "Scheduled report"].map((t) => (
                <button key={t} className="w-full flex items-center gap-2 p-2 rounded-md text-xs text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors text-left">
                  <Plus className="h-3 w-3 text-fg-subtle" />
                  {t}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Center: canvas */}
        <div className="flex-1 bg-bg-subtle relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: "hsl(var(--border-strong))", strokeWidth: 1.5 },
              type: "smoothstep",
            }}
          >
            <Background color="hsl(var(--border))" gap={24} size={1} />
            <Controls className="!bg-bg-elevated !border !border-border !rounded-md !shadow-md [&>button]:!border-border [&>button]:!bg-bg-elevated [&>button]:!text-fg-muted hover:[&>button]:!bg-bg-hover" />
            <MiniMap
              className="!bg-bg-elevated !border !border-border !rounded-md"
              nodeColor={() => "hsl(var(--brand))"}
              maskColor="hsl(var(--bg) / 0.85)"
              pannable zoomable
            />
          </ReactFlow>
        </div>

        {/* Right: inspector */}
        <aside className="w-72 shrink-0 border-l border-border bg-bg-subtle overflow-y-auto p-4">
          <div className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">Run preview</div>
          <Card className="p-3 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-muted">Estimated cost / run</span>
              <span className="text-xs font-mono font-medium">~$0.008</span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-fg-muted">Estimated latency</span>
              <span className="text-xs font-mono font-medium">~3.4s</span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-fg-muted">Nodes</span>
              <span className="text-xs font-mono font-medium">{nodes.length}</span>
            </div>
          </Card>

          <div className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-2 mt-5">Recent runs</div>
          <div className="space-y-1.5">
            {[
              { status: "success", when: "2 min ago",   duration: "3.1s" },
              { status: "success", when: "17 min ago",  duration: "2.8s" },
              { status: "failed",  when: "1 hr ago",    duration: "4.2s" },
              { status: "success", when: "2 hr ago",    duration: "3.4s" },
            ].map((r, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-md border border-border bg-bg-elevated hover:bg-bg-hover transition-colors text-2xs cursor-pointer">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", r.status === "success" ? "bg-success" : "bg-danger")} />
                  <span className="text-fg-muted">{r.when}</span>
                </div>
                <span className="font-mono text-fg-subtle">{r.duration}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
