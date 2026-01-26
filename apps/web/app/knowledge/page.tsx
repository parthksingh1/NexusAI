"use client";

import { useState } from "react";
import {
  Database, FileText, Github, Globe, MessageSquare, Upload, Search, Plus,
  File, FileCode, FolderOpen, MoreHorizontal, Trash2, Download,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown";

type Doc = {
  id: string; title: string; source: "notion" | "github" | "slack" | "url" | "upload";
  sourceId: string; url?: string; chunks: number; tokens: number; addedAt: string;
};

const MOCK: Doc[] = [
  { id: "d1", title: "Product roadmap 2026",        source: "notion", sourceId: "notion-123",    url: "https://notion.so/...", chunks: 42, tokens: 18400, addedAt: new Date(Date.now() - 2 * 86400_000).toISOString() },
  { id: "d2", title: "vercel/next.js README",        source: "github", sourceId: "vercel/next.js",url: "https://github.com/vercel/next.js", chunks: 28, tokens: 9600, addedAt: new Date(Date.now() - 7 * 86400_000).toISOString() },
  { id: "d3", title: "#engineering — weekly sync",   source: "slack",  sourceId: "C01E2F3",       chunks: 156, tokens: 62400, addedAt: new Date(Date.now() - 1 * 86400_000).toISOString() },
  { id: "d4", title: "The Rise of AI Agents",         source: "url",    sourceId: "https://blog.example.com/ai-agents", url: "https://blog.example.com/ai-agents", chunks: 14, tokens: 5800, addedAt: new Date(Date.now() - 14 * 86400_000).toISOString() },
  { id: "d5", title: "Internal Wiki — Onboarding",    source: "upload", sourceId: "onboarding.pdf", chunks: 34, tokens: 14200, addedAt: new Date(Date.now() - 30 * 86400_000).toISOString() },
  { id: "d6", title: "API Documentation v2",          source: "upload", sourceId: "api-docs.md",    chunks: 89, tokens: 38200, addedAt: new Date(Date.now() - 5 * 86400_000).toISOString() },
];

const CONNECTORS = [
  { id: "notion", name: "Notion",    icon: FileText,       endpoint: "/connectors/notion",       desc: "Pull pages + databases via Notion API", color: "text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900" },
  { id: "github", name: "GitHub",    icon: Github,         endpoint: "/connectors/github/repo",  desc: "Ingest READMEs, issues, and wikis",      color: "text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900" },
  { id: "slack",  name: "Slack",     icon: MessageSquare,  endpoint: "/connectors/slack",        desc: "Ingest channel history",                 color: "text-white bg-[#4A154B]" },
  { id: "url",    name: "Web pages", icon: Globe,          endpoint: "/connectors/url",          desc: "Fetch and strip any public URL",         color: "text-white bg-brand" },
];

const SOURCE_ICON: Record<Doc["source"], React.ComponentType<{ className?: string }>> = {
  notion: FileText, github: Github, slack: MessageSquare, url: Globe, upload: FileCode,
};

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>(MOCK);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<{ snippet: string; title: string; score: number }[]>([]);

  function addDoc() { toast.info("Ingest dialog opened"); setAddOpen(true); }
  function removeDoc(id: string) { setDocs(docs.filter((d) => d.id !== id)); toast.success("Document removed"); }

  async function doSearch() {
    if (!searchQ.trim()) return;
    try {
      const r = await fetch(`/api/orch/rag/search`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: searchQ, topK: 5, useRerank: true }),
      });
      if (r.ok) { const d = await r.json(); setSearchResults(d.hits ?? []); return; }
    } catch { /* fall through */ }
    // mock results
    setSearchResults([
      { title: "Product roadmap 2026", score: 0.92, snippet: "…focus on agent-native workflows in Q2, with a marketplace launch targeted at Q3…" },
      { title: "The Rise of AI Agents", score: 0.81, snippet: "…autonomous agents now handle an increasing share of routine knowledge work across the enterprise…" },
      { title: "Internal Wiki — Onboarding", score: 0.64, snippet: "…new engineers should read the architecture doc before touching the runtime layer…" },
    ]);
  }

  const totalChunks = docs.reduce((a, b) => a + b.chunks, 0);
  const totalTokens = docs.reduce((a, b) => a + b.tokens, 0);
  const filtered = docs.filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Knowledge base"
        description="Connect sources so agents can retrieve grounded, cited answers."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" leftIcon={<Search className="h-3.5 w-3.5" />} onClick={() => setSearchOpen(true)}>Test search</Button>
            <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addDoc}>Add document</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Documents"  icon={FolderOpen} value={docs.length} />
        <Stat label="Chunks"     icon={File}       value={totalChunks.toLocaleString()} />
        <Stat label="Tokens"     icon={Database}   value={`${(totalTokens / 1000).toFixed(1)}k`} />
        <Stat label="Embeddings" icon={Database}   value="768-dim" hint="Gemini text-embedding-004" />
      </div>

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="connectors">Connectors</TabsTrigger>
          <TabsTrigger value="settings">Ingestion settings</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <Card className="mb-4 p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
              <Input placeholder="Filter documents…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
            </div>
          </Card>

          <Card>
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border bg-bg-subtle/50">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Document</th>
                  <th className="text-left font-medium">Source</th>
                  <th className="text-right font-medium">Chunks</th>
                  <th className="text-right font-medium">Tokens</th>
                  <th className="text-left font-medium">Added</th>
                  <th className="px-5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const Icon = SOURCE_ICON[d.source];
                  return (
                    <tr key={d.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 rounded-md bg-bg-muted border border-border flex items-center justify-center shrink-0">
                            <Icon className="h-3.5 w-3.5 text-fg-muted" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{d.title}</div>
                            {d.url && <div className="text-2xs text-fg-subtle truncate max-w-md">{d.url}</div>}
                          </div>
                        </div>
                      </td>
                      <td><Badge size="sm">{d.source}</Badge></td>
                      <td className="text-right font-mono text-xs">{d.chunks}</td>
                      <td className="text-right font-mono text-xs">{d.tokens.toLocaleString()}</td>
                      <td className="text-xs text-fg-subtle">{formatDistanceToNow(new Date(d.addedAt), { addSuffix: true })}</td>
                      <td className="px-5 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem><Download className="h-3.5 w-3.5" />Export</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => removeDoc(d.id)} className="text-danger">
                              <Trash2 className="h-3.5 w-3.5" />Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="connectors">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CONNECTORS.map((c) => (
              <Card key={c.id} className="p-5 group" interactive>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-md flex items-center justify-center ${c.color}`}>
                      <c.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold tracking-tight">{c.name}</h3>
                      <p className="text-xs text-fg-muted mt-0.5">{c.desc}</p>
                    </div>
                  </div>
                  <Badge tone="success" size="sm" dot>Ready</Badge>
                </div>
                <code className="block text-2xs text-fg-subtle font-mono bg-bg-muted border border-border rounded px-2 py-1.5 mt-3 truncate">
                  POST {c.endpoint}
                </code>
                <Button variant="secondary" size="sm" className="mt-3 w-full">Connect</Button>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="p-6 max-w-2xl">
            <h3 className="font-semibold tracking-tight mb-1">Ingestion settings</h3>
            <p className="text-xs text-fg-muted mb-5">Defaults for new documents.</p>
            <div className="space-y-4">
              <div>
                <Label>Chunking strategy</Label>
                <Select defaultValue="recursive">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed (512 tokens)</SelectItem>
                    <SelectItem value="recursive">Recursive (recommended)</SelectItem>
                    <SelectItem value="semantic">Semantic (experimental)</SelectItem>
                    <SelectItem value="markdown">Markdown-aware</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Embedding model</Label>
                <Select defaultValue="gemini">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini text-embedding-004 (768d)</SelectItem>
                    <SelectItem value="openai">OpenAI text-embedding-3-small (1536d)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rerank provider</Label>
                <Select defaultValue="heuristic">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="heuristic">Heuristic (free)</SelectItem>
                    <SelectItem value="cohere">Cohere rerank-3</SelectItem>
                    <SelectItem value="jina">Jina reranker v2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => toast.success("Settings saved")}>Save</Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Test search */}
      <Dialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Test hybrid search"
        description="Queries your knowledge base with dense + sparse + rerank."
        size="lg"
        footer={<Button onClick={() => setSearchOpen(false)}>Close</Button>}
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Ask a question…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              autoFocus
            />
            <Button onClick={doSearch} leftIcon={<Search className="h-3.5 w-3.5" />}>Search</Button>
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <div key={i} className="p-3 rounded-md border border-border bg-bg-subtle">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{r.title}</span>
                    <Badge tone="brand" size="sm">score {r.score.toFixed(3)}</Badge>
                  </div>
                  <p className="text-xs text-fg-muted leading-relaxed">{r.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>

      {/* Add document */}
      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add a document"
        description="Upload text or paste content directly."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => { setAddOpen(false); toast.success("Document ingested"); }} leftIcon={<Upload className="h-3.5 w-3.5" />}>Ingest</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input placeholder="Company handbook" />
          </div>
          <div>
            <Label>Content</Label>
            <Textarea rows={6} placeholder="Paste your document text…" />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
