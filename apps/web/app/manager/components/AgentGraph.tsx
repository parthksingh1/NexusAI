"use client";

import { useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { Bot, Code2, FileSearch, Globe, Layers, Youtube } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NodeState, Plan, TaskType } from "@/lib/manager-api";

const TYPE_ICON: Record<TaskType, typeof Bot> = {
  research: FileSearch,
  scrape: Globe,
  video: Youtube,
  code: Code2,
  synthesize: Layers,
};

const STATE_STYLE: Record<NodeState, string> = {
  pending: "border-border bg-bg-subtle text-fg-muted",
  running: "border-sky-500/60 bg-sky-500/10 text-sky-300 animate-pulse shadow-[0_0_0_3px_rgba(56,189,248,0.12)]",
  done: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
  error: "border-rose-500/60 bg-rose-500/10 text-rose-300",
  skipped: "border-border bg-bg-subtle text-fg-muted opacity-50",
};

const STATE_LABEL: Record<NodeState, string> = {
  pending: "Waiting",
  running: "Running",
  done: "Complete",
  error: "Failed",
  skipped: "Skipped",
};

export interface TaskNodeData {
  label: string;
  type: TaskType;
  state: NodeState;
  detail?: string;
}

function TaskNode({ data }: NodeProps<TaskNodeData>) {
  const Icon = TYPE_ICON[data.type] ?? Bot;
  return (
    <div
      className={cn(
        "w-[230px] rounded-lg border px-3 py-2.5 transition-colors duration-300",
        STATE_STYLE[data.state],
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !border-none !h-1.5 !w-1.5" />
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={2} className="shrink-0" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{data.type}</span>
        <span className="ml-auto text-[10px] opacity-70">{STATE_LABEL[data.state]}</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-fg line-clamp-3">{data.label}</p>
      {data.detail && <p className="mt-1 text-[11px] leading-snug opacity-70 line-clamp-2">{data.detail}</p>}
      <Handle type="source" position={Position.Bottom} className="!bg-border !border-none !h-1.5 !w-1.5" />
    </div>
  );
}

const nodeTypes = { task: TaskNode };

const COLUMN_WIDTH = 270;
const ROW_HEIGHT = 150;

/**
 * Lay tasks out by parallel_group: one row per group, siblings spread across it. That makes
 * the concurrency the planner chose visible at a glance — a wide row is work happening at
 * the same time.
 */
function layout(plan: Plan, states: Record<string, NodeState>, details: Record<string, string>) {
  const groups = new Map<number, typeof plan.tasks>();
  for (const task of plan.tasks) {
    const row = groups.get(task.parallel_group) ?? [];
    row.push(task);
    groups.set(task.parallel_group, row);
  }
  const orderedGroups = [...groups.keys()].sort((a, b) => a - b);
  const widest = Math.max(...[...groups.values()].map((row) => row.length), 1);

  const nodes: Node<TaskNodeData>[] = [];
  orderedGroups.forEach((group, rowIndex) => {
    const row = groups.get(group)!;
    const offset = ((widest - row.length) * COLUMN_WIDTH) / 2;
    row.forEach((task, columnIndex) => {
      nodes.push({
        id: task.id,
        type: "task",
        position: { x: offset + columnIndex * COLUMN_WIDTH, y: rowIndex * ROW_HEIGHT },
        data: {
          label: task.goal,
          type: task.type,
          state: states[task.id] ?? "pending",
          detail: details[task.id],
        },
      });
    });
  });

  const edges: Edge[] = plan.tasks.flatMap((task) =>
    task.depends_on.map((dependency) => ({
      id: `${dependency}->${task.id}`,
      source: dependency,
      target: task.id,
      animated: states[task.id] === "running",
      style: { stroke: "rgb(100 116 139 / 0.5)", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "rgb(100 116 139 / 0.5)" },
    })),
  );

  return { nodes, edges };
}

export function AgentGraph({
  plan,
  states,
  details,
}: {
  plan: Plan;
  states: Record<string, NodeState>;
  details: Record<string, string>;
}) {
  const computed = useMemo(() => layout(plan, states, details), [plan, states, details]);
  const [nodes, setNodes, onNodesChange] = useNodesState(computed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computed.edges);

  // Re-render node state in place so the user's pan and zoom survive every update.
  useEffect(() => {
    setNodes((current) =>
      current.length === computed.nodes.length
        ? current.map((node) => {
            const next = computed.nodes.find((n) => n.id === node.id);
            return next ? { ...node, data: next.data } : node;
          })
        : computed.nodes,
    );
    setEdges(computed.edges);
  }, [computed, setNodes, setEdges]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.6}
      >
        <Background gap={20} size={1} color="rgb(100 116 139 / 0.18)" />
        <Controls showInteractive={false} className="!bg-bg-subtle !border-border" />
      </ReactFlow>
    </div>
  );
}
