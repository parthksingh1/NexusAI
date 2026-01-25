"use client";

import Link from "next/link";
import {
  BookOpen, Zap, Shield, Network, Code2, Bot, Database, BarChart3,
  ArrowRight, Search, FileText, Layers, Brain, Activity,
} from "lucide-react";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const CATEGORIES = [
  {
    title: "Getting started",
    icon: Zap,
    articles: [
      { title: "Quickstart — run your first agent in 5 minutes", time: "5 min", href: "#" },
      { title: "Install the SDK (TypeScript / Python)",           time: "3 min", href: "#" },
      { title: "Connect your LLM provider keys",                  time: "2 min", href: "#" },
      { title: "Create and run your first agent",                 time: "4 min", href: "#" },
    ],
  },
  {
    title: "Agents",
    icon: Bot,
    articles: [
      { title: "Agent lifecycle: idle / running / paused",        time: "3 min", href: "#" },
      { title: "Writing effective system prompts",                time: "6 min", href: "#" },
      { title: "Tool registry and custom tools",                  time: "5 min", href: "#" },
      { title: "Multi-agent collaboration (planner/executor/critic)", time: "8 min", href: "#" },
      { title: "Persistence and memory",                          time: "6 min", href: "#" },
    ],
  },
  {
    title: "RAG & knowledge",
    icon: Network,
    articles: [
      { title: "Hybrid search — dense + sparse fusion",            time: "5 min", href: "#" },
      { title: "HyDE and query decomposition",                     time: "4 min", href: "#" },
      { title: "Connectors: Notion, GitHub, Slack, URLs",          time: "6 min", href: "#" },
      { title: "Choosing a chunking strategy",                     time: "5 min", href: "#" },
      { title: "Cross-encoder reranking",                          time: "4 min", href: "#" },
    ],
  },
  {
    title: "Safety",
    icon: Shield,
    articles: [
      { title: "Tool risk scoring",                                 time: "3 min", href: "#" },
      { title: "Human-in-the-loop approvals",                      time: "4 min", href: "#" },
      { title: "Guardrails: content, PII, jailbreak",              time: "6 min", href: "#" },
      { title: "Sandbox isolation (gVisor)",                       time: "4 min", href: "#" },
    ],
  },
  {
    title: "Observability",
    icon: BarChart3,
    articles: [
      { title: "Traces and spans",                                  time: "4 min", href: "#" },
      { title: "Cost attribution by agent and model",              time: "3 min", href: "#" },
      { title: "Prometheus metrics",                                time: "3 min", href: "#" },
      { title: "OpenTelemetry integration",                         time: "5 min", href: "#" },
    ],
  },
  {
    title: "Platform",
    icon: Layers,
    articles: [
      { title: "Workflows: chaining agents into pipelines",         time: "8 min", href: "/workflows" },
      { title: "Scheduled runs (cron)",                             time: "3 min", href: "/schedules" },
      { title: "Webhooks: HMAC signatures and delivery",            time: "5 min", href: "/webhooks" },
      { title: "Evaluations and golden datasets",                   time: "7 min", href: "/evaluations" },
    ],
  },
];

const FEATURED = [
  { title: "The ReAct loop explained",          desc: "How agents reason and act — step by step.",        icon: Brain },
  { title: "Self-improving agents",              desc: "Reflection, skill memory, prompt optimization.",    icon: Activity },
  { title: "Scaling to 10k+ concurrent agents",  desc: "Production architecture for high load.",           icon: Database },
];

export default function DocsPage() {
  return (
    <div>
      <PageHeader
        title="Documentation"
        description="Learn how to build, deploy, and scale autonomous agents with NexusAI."
      />

      {/* Search + featured */}
      <Card className="p-8 mb-8 bg-bg-subtle relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 rounded-lg bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tightest">What do you want to build today?</h2>
              <p className="text-sm text-fg-muted mt-0.5">Search 120+ guides and API references.</p>
            </div>
          </div>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
            <Input placeholder="Ask anything… e.g. 'how do I add a custom tool?'" className="pl-9 h-11 text-sm" />
          </div>
        </div>
      </Card>

      {/* Featured long reads */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold tracking-tight uppercase text-fg-subtle mb-3">Featured</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FEATURED.map((f) => (
            <Card key={f.title} interactive className="p-5 group">
              <div className="h-9 w-9 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center mb-3">
                <f.icon className="h-4 w-4 text-brand" />
              </div>
              <h3 className="font-semibold tracking-tight">{f.title}</h3>
              <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">{f.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-xs text-brand">
                Read article <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {CATEGORIES.map((c) => (
          <Card key={c.title} className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-bg-muted border border-border flex items-center justify-center">
                <c.icon className="h-4 w-4 text-fg-muted" />
              </div>
              <h3 className="font-semibold tracking-tight">{c.title}</h3>
              <Badge size="sm" className="ml-auto">{c.articles.length}</Badge>
            </div>
            <ul className="space-y-0.5">
              {c.articles.map((a) => (
                <li key={a.title}>
                  <Link href={a.href} className="flex items-center gap-3 px-2 py-1.5 rounded-md text-sm hover:bg-bg-hover transition-colors group">
                    <FileText className="h-3 w-3 text-fg-subtle shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{a.title}</span>
                    <span className="text-2xs text-fg-subtle font-mono">{a.time}</span>
                    <ArrowRight className="h-3 w-3 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="mt-8 p-6 bg-bg-subtle">
        <div className="flex items-start gap-4">
          <Code2 className="h-6 w-6 text-brand shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold tracking-tight">Prefer the REST API?</h3>
            <p className="text-sm text-fg-muted mt-1">
              Every endpoint is documented in the interactive <Link href="/api-explorer" className="text-brand underline">API explorer</Link>. SDKs auto-update from the same OpenAPI spec.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
