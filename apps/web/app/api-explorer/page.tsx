"use client";

import { useState } from "react";
import { Terminal, Send, Copy, BookOpen, Code2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

type Endpoint = {
  id: string; method: "GET" | "POST" | "DELETE" | "PATCH"; path: string; summary: string;
  group: string; body?: string; sampleResponse: string;
};

const ENDPOINTS: Endpoint[] = [
  { id: "list-agents",    method: "GET",    path: "/agents",                   summary: "List agents",              group: "Agents", sampleResponse: `{"agents": [{"id": "…", "name": "Market Research", "goal": "…", "tools": ["web_search"], "status": "IDLE"}]}` },
  { id: "get-agent",      method: "GET",    path: "/agents/:id",               summary: "Get an agent",             group: "Agents", sampleResponse: `{"id": "…", "name": "Market Research", "runs": [...]}` },
  { id: "create-agent",   method: "POST",   path: "/agents",                   summary: "Create an agent",          group: "Agents", body: JSON.stringify({ name: "My Agent", goal: "Research topics", persona: { name: "My Agent", systemPrompt: "You are helpful." }, tools: ["web_search"] }, null, 2), sampleResponse: `{"id": "…", "name": "My Agent", "status": "IDLE"}` },
  { id: "start-run",      method: "POST",   path: "/agents/:id/runs",          summary: "Start a run",              group: "Runs",   body: JSON.stringify({ input: "Summarize today's AI news", maxSteps: 12 }, null, 2), sampleResponse: `{"runId": "r_01"}` },
  { id: "get-run",        method: "GET",    path: "/runs/:id",                 summary: "Get run details",          group: "Runs",   sampleResponse: `{"id": "r_01", "status": "SUCCEEDED", "steps": [...]}` },
  { id: "cancel-run",     method: "POST",   path: "/runs/:id/cancel",          summary: "Cancel a run",             group: "Runs",   sampleResponse: `{}` },
  { id: "search-rag",     method: "POST",   path: "/rag/search",               summary: "Hybrid RAG search",        group: "RAG",    body: JSON.stringify({ query: "what is nexusai", topK: 8, useRerank: true }, null, 2), sampleResponse: `{"hits": [{"chunkId": "…", "title": "…", "snippet": "…", "score": 0.92}]}` },
  { id: "ingest-rag",     method: "POST",   path: "/rag/ingest",               summary: "Ingest a document",        group: "RAG",    body: JSON.stringify({ source: "url", sourceId: "https://…", title: "Doc", text: "…" }, null, 2), sampleResponse: `{"documentId": "…", "chunks": 24}` },
  { id: "list-approvals", method: "GET",    path: "/approvals",                summary: "List pending approvals",   group: "Safety", sampleResponse: `{"approvals": [...]}` },
  { id: "decide-approval",method: "POST",   path: "/approvals/:id/decide",     summary: "Approve or reject",        group: "Safety", body: JSON.stringify({ decision: "approved" }, null, 2), sampleResponse: `{"id": "…", "status": "APPROVED"}` },
  { id: "cost-by-day",    method: "GET",    path: "/metrics/cost-by-day",      summary: "Daily cost series",        group: "Metrics", sampleResponse: `{"series": [{"day": "2026-04-13", "cost": 0.12, "tokens": 28400, "calls": 47}]}` },
  { id: "cost-by-model",  method: "GET",    path: "/metrics/cost-by-model",    summary: "Cost by model",            group: "Metrics", sampleResponse: `{"models": [...]}` },
];

const METHOD_COLORS: Record<Endpoint["method"], string> = {
  GET:    "text-info bg-info/10 border-info/20",
  POST:   "text-success bg-success/10 border-success/20",
  DELETE: "text-danger bg-danger/10 border-danger/20",
  PATCH:  "text-warn bg-warn/10 border-warn/20",
};

export default function ApiExplorerPage() {
  const [selected, setSelected] = useState<Endpoint>(ENDPOINTS[0]!);
  const [body, setBody] = useState(selected.body ?? "");
  const [auth, setAuth] = useState("Bearer ");
  const [response, setResponse] = useState<string>("");
  const [status, setStatus] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  function pick(e: Endpoint) {
    setSelected(e);
    setBody(e.body ?? "");
    setResponse("");
    setStatus(null);
    setDuration(null);
  }

  async function send() {
    setRunning(true);
    const start = Date.now();
    // Simulate — in prod would fetch the real path via /api/orch rewrite
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    setResponse(selected.sampleResponse);
    setStatus(200);
    setDuration(Date.now() - start);
    setRunning(false);
    toast.success("Request sent");
  }

  const groups = Array.from(new Set(ENDPOINTS.map((e) => e.group)));

  const curl = `curl -X ${selected.method} "https://api.nexusai.com/v1${selected.path}" \\
  -H "Authorization: ${auth || 'Bearer YOUR_KEY'}" \\
  -H "Content-Type: application/json"${selected.body ? ` \\
  -d '${body}'` : ""}`;

  return (
    <div>
      <PageHeader
        title="API explorer"
        description="Interactive REST + WebSocket reference. Try any endpoint without leaving your browser."
        actions={
          <Button variant="secondary" leftIcon={<BookOpen className="h-3.5 w-3.5" />} asChild>
            <a href="/docs">Read docs</a>
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Endpoint list */}
        <div className="lg:col-span-3">
          <Card>
            <div className="p-3 border-b border-border">
              <Input placeholder="Search endpoints…" />
            </div>
            <div className="p-2">
              {groups.map((g) => (
                <div key={g} className="mb-3">
                  <div className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">{g}</div>
                  {ENDPOINTS.filter((e) => e.group === g).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => pick(e)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
                        selected.id === e.id ? "bg-bg-hover" : "hover:bg-bg-hover/60",
                      )}
                    >
                      <span className={cn("text-2xs font-mono font-semibold px-1.5 py-0.5 rounded border", METHOD_COLORS[e.method])}>
                        {e.method}
                      </span>
                      <span className="text-xs font-mono text-fg-muted truncate">{e.path}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Request/Response panel */}
        <div className="lg:col-span-9 space-y-4">
          <Card>
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Badge size="md" className={cn("font-mono font-semibold", METHOD_COLORS[selected.method])}>{selected.method}</Badge>
                <code className="font-mono text-sm">{selected.path}</code>
              </div>
              <p className="text-sm text-fg-muted">{selected.summary}</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <Label>Authorization</Label>
                <Input value={auth} onChange={(e) => setAuth(e.target.value)} className="font-mono text-xs" placeholder="Bearer nxs_…" />
              </div>
              {selected.body !== undefined && (
                <div>
                  <Label>Request body</Label>
                  <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="text-2xs text-fg-subtle font-mono">
                  https://api.nexusai.com/v1{selected.path}
                </div>
                <Button onClick={send} loading={running} leftIcon={<Send className="h-3.5 w-3.5" />}>Send request</Button>
              </div>
            </div>
          </Card>

          <Tabs defaultValue="response">
            <TabsList>
              <TabsTrigger value="response">Response</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="ts">TypeScript</TabsTrigger>
              <TabsTrigger value="py">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="response">
              <Card>
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-fg-muted" />
                    <span className="text-sm font-medium">Response</span>
                    {status && <Badge tone={status < 300 ? "success" : "danger"} size="sm">{status}</Badge>}
                    {duration && <span className="text-2xs text-fg-subtle font-mono">{duration}ms</span>}
                  </div>
                  {response && (
                    <Button variant="ghost" size="sm" leftIcon={<Copy className="h-3 w-3" />}
                      onClick={() => { navigator.clipboard.writeText(response); toast.success("Copied"); }}>
                      Copy
                    </Button>
                  )}
                </div>
                <pre className="p-5 text-xs font-mono overflow-x-auto bg-[#0a0a0b] min-h-[240px]">
                  <code className="text-emerald-300">{response || "// Click 'Send request' to see the response"}</code>
                </pre>
              </Card>
            </TabsContent>
            <TabsContent value="curl">
              <CodeBlock label="cURL" code={curl} />
            </TabsContent>
            <TabsContent value="ts">
              <CodeBlock label="TypeScript" code={`import { NexusClient } from "@nexusai/sdk";

const nx = new NexusClient({ apiKey: process.env.NEXUSAI_API_KEY });

// ${selected.summary}
const result = await nx.${snippet(selected)};
console.log(result);`} />
            </TabsContent>
            <TabsContent value="py">
              <CodeBlock label="Python" code={`from nexusai import NexusClient

nx = NexusClient(api_key="nxs_…")

# ${selected.summary}
result = nx.${pySnippet(selected)}
print(result)`} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <Card>
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="h-3.5 w-3.5 text-fg-muted" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<Copy className="h-3 w-3" />}
          onClick={() => { navigator.clipboard.writeText(code); toast.success("Copied"); }}>
          Copy
        </Button>
      </div>
      <pre className="p-5 text-xs font-mono overflow-x-auto bg-[#0a0a0b]">
        <code className="text-fg">{code}</code>
      </pre>
    </Card>
  );
}

function snippet(e: Endpoint): string {
  if (e.id === "list-agents") return "agents.list()";
  if (e.id === "get-agent") return `agents.get("AGENT_ID")`;
  if (e.id === "create-agent") return `agents.create({ name: "My Agent", goal: "...", persona: { ... } })`;
  if (e.id === "start-run") return `agents.start("AGENT_ID", "Summarize today's AI news")`;
  if (e.id === "search-rag") return `rag.search("what is nexusai")`;
  return "request('" + e.method + "', '" + e.path + "')";
}
function pySnippet(e: Endpoint): string {
  if (e.id === "list-agents") return "agents.list()";
  if (e.id === "create-agent") return `agents.create(name="My Agent", goal="...", persona={...})`;
  if (e.id === "start-run") return `agents.start("AGENT_ID", "Summarize today's AI news")`;
  if (e.id === "search-rag") return `rag.search("what is nexusai")`;
  return "request('" + e.method + "', '" + e.path + "')";
}
