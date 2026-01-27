"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  Play, Square, Loader2, Terminal, FileCode, Plus, X, Save, Share2,
  BookOpen, Shield, Zap, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false, loading: () => <div className="h-full w-full skeleton" /> });

type Language = "python" | "node" | "bash";
type Line = { stream: "stdout" | "stderr"; text: string };
type Tab = { id: string; name: string; language: Language; code: string };

const EXAMPLES: Record<Language, { name: string; code: string }[]> = {
  python: [
    { name: "Hello world",  code: `print('Hello from NexusAI sandbox')\nimport math\nprint(math.pi)` },
    { name: "Fibonacci",    code: `def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nfor i in range(10):\n    print(i, fib(i))` },
    { name: "JSON parse",   code: `import json\ndata = '{"name": "NexusAI", "version": "0.1.0"}'\nparsed = json.loads(data)\nprint(parsed['name'])` },
    { name: "Data analysis",code: `# Simulate a quick data analysis\nimport random, statistics\nxs = [random.gauss(100, 15) for _ in range(1000)]\nprint('mean:',   statistics.mean(xs))\nprint('stdev:',  statistics.stdev(xs))\nprint('p95:',    sorted(xs)[int(len(xs)*0.95)])` },
  ],
  node: [
    { name: "Hello world", code: `console.log('Hello from NexusAI sandbox');\nconsole.log(2 ** 32);` },
    { name: "Async/await", code: `const wait = (ms) => new Promise(r => setTimeout(r, ms));\n(async () => {\n  console.log('starting');\n  await wait(100);\n  console.log('done');\n})();` },
    { name: "Map/reduce",  code: `const xs = Array.from({ length: 20 }, (_, i) => i + 1);\nconst sum = xs.reduce((a, b) => a + b, 0);\nconst avg = sum / xs.length;\nconsole.log({ sum, avg });` },
  ],
  bash: [
    { name: "System info", code: `echo "NexusAI sandbox"; uname -a; date; df -h /tmp` },
    { name: "File ops",    code: `echo 'line 1\\nline 2\\nline 3' > /tmp/out.txt\ncat /tmp/out.txt | wc -l` },
  ],
};

const LANG_LABELS: Record<Language, string> = { python: "Python 3.11", node: "Node.js 20", bash: "Bash (Alpine)" };
const EXT: Record<Language, string> = { python: "py", node: "js", bash: "sh" };

export default function Playground() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "t1", name: "main.py", language: "python", code: EXAMPLES.python[0]!.code },
  ]);
  const [activeId, setActiveId] = useState("t1");
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [exitInfo, setExitInfo] = useState<{ code: number; durationMs: number; timedOut: boolean } | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]!;

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [lines.length]);

  function addTab(lang: Language = "python") {
    const id = `t${Date.now()}`;
    setTabs([...tabs, { id, name: `untitled.${EXT[lang]}`, language: lang, code: "" }]);
    setActiveId(id);
  }

  function closeTab(id: string) {
    if (tabs.length === 1) return;
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) setActiveId(next[next.length - 1]!.id);
  }

  function updateActive(patch: Partial<Tab>) {
    setTabs(tabs.map((t) => (t.id === activeId ? { ...t, ...patch } : t)));
  }

  function loadExample(ex: { name: string; code: string }) {
    updateActive({ code: ex.code, name: ex.name.toLowerCase().replace(/\s+/g, "-") + "." + EXT[active.language] });
    setShowExamples(false);
    toast.success(`Loaded: ${ex.name}`);
  }

  function run() {
    setLines([]);
    setExitInfo(null);
    setStatus("running");

    const sandboxWs = process.env.NEXT_PUBLIC_SANDBOX_WS ?? "ws://localhost:4100";
    try {
      const sock = new WebSocket(`${sandboxWs}/ws/exec`);
      wsRef.current = sock;
      sock.onopen = () => sock.send(JSON.stringify({ language: active.language, code: active.code, timeoutMs: 15000 }));
      sock.onmessage = (m) => {
        const ev = JSON.parse(m.data as string);
        if (ev.type === "stdout" || ev.type === "stderr") {
          setLines((prev) => [...prev, { stream: ev.type, text: ev.data }]);
        } else if (ev.type === "exit") {
          setExitInfo({ code: ev.code, durationMs: ev.durationMs, timedOut: ev.timedOut });
          setStatus(ev.code === 0 ? "done" : "error");
        } else if (ev.type === "error") {
          setLines((prev) => [...prev, { stream: "stderr", text: ev.message }]);
          setStatus("error");
        }
      };
      sock.onerror = () => {
        setLines([{ stream: "stderr", text: "Sandbox offline — start apps/sandbox (port 4100) to execute code." }]);
        setStatus("error");
      };
      sock.onclose = () => { wsRef.current = null; };
    } catch {
      setLines([{ stream: "stderr", text: "Could not reach sandbox service." }]);
      setStatus("error");
    }
  }

  function stop() {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
    toast.info("Execution stopped");
  }

  function clearConsole() { setLines([]); setExitInfo(null); }

  function shareSnippet() {
    const payload = btoa(JSON.stringify({ lang: active.language, code: active.code }));
    navigator.clipboard.writeText(`${window.location.origin}/playground#${payload}`);
    toast.success("Share link copied");
  }

  return (
    <div>
      <PageHeader
        title="Playground"
        description="Execute code in an isolated sandbox — no network, read-only rootfs, hard resource caps."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="success" size="sm" dot><Shield className="h-3 w-3" />Isolated · no network</Badge>
            <Button variant="ghost" size="sm" leftIcon={<Share2 className="h-3.5 w-3.5" />} onClick={shareSnippet}>Share</Button>
          </div>
        }
      />

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-subtle gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Tabs */}
            <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className={cn(
                    "group inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs rounded-md border cursor-pointer transition-colors",
                    activeId === t.id
                      ? "bg-bg-elevated border-border text-fg shadow-sm"
                      : "bg-transparent border-transparent text-fg-muted hover:bg-bg-hover",
                  )}
                >
                  <FileCode className="h-3 w-3 text-fg-subtle shrink-0" />
                  <span className="font-mono truncate max-w-[140px]">{t.name}</span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                      className="opacity-0 group-hover:opacity-100 hover:bg-bg-hover rounded p-0.5 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => addTab(active.language)} className="p-1 text-fg-subtle hover:text-fg rounded hover:bg-bg-hover">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>New tab</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Select value={active.language} onValueChange={(v) => updateActive({ language: v as Language, name: active.name.replace(/\.[^.]+$/, "." + EXT[v as Language]) })}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="python">{LANG_LABELS.python}</SelectItem>
                <SelectItem value="node">{LANG_LABELS.node}</SelectItem>
                <SelectItem value="bash">{LANG_LABELS.bash}</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="secondary" size="sm" leftIcon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => setShowExamples(!showExamples)}>
              Examples
            </Button>

            {status === "running" ? (
              <Button size="sm" variant="secondary" onClick={stop} leftIcon={<Square className="h-3 w-3" />}>Stop</Button>
            ) : (
              <Button size="sm" onClick={run} leftIcon={<Play className="h-3.5 w-3.5" />}>Run</Button>
            )}
          </div>
        </div>

        {/* Examples dropdown */}
        {showExamples && (
          <div className="border-b border-border bg-bg-subtle px-3 py-3 animate-slide-up-fade">
            <div className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold mb-2">Starter snippets · {LANG_LABELS[active.language]}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {EXAMPLES[active.language].map((ex) => (
                <button
                  key={ex.name}
                  onClick={() => loadExample(ex)}
                  className="text-left p-3 rounded-md border border-border bg-bg-elevated hover:border-border-strong hover:bg-bg-hover transition-colors"
                >
                  <div className="text-sm font-medium">{ex.name}</div>
                  <div className="text-2xs text-fg-subtle font-mono mt-1 truncate">{ex.code.split("\n")[0]}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Split: editor + console */}
        <div className="grid grid-cols-1 lg:grid-cols-2 h-[calc(100vh-320px)] min-h-[480px]">
          <div className="border-r border-border">
            <MonacoEditor
              height="100%"
              language={active.language === "node" ? "javascript" : active.language === "bash" ? "shell" : "python"}
              theme="vs-dark"
              value={active.code}
              onChange={(v) => updateActive({ code: v ?? "" })}
              options={{
                fontSize: 13,
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                tabSize: 2,
                renderLineHighlight: "line",
                padding: { top: 12, bottom: 12 },
                lineNumbersMinChars: 3,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Console */}
          <div className="flex flex-col bg-[#0a0a0b]">
            <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-bg-subtle/40">
              <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-fg-subtle font-semibold">
                <Terminal className="h-3 w-3" /> Output
              </div>
              <div className="flex items-center gap-2">
                {exitInfo && (
                  <Badge tone={exitInfo.code === 0 ? "success" : "danger"} size="sm" dot>
                    exit {exitInfo.code} · {exitInfo.durationMs}ms{exitInfo.timedOut && " · timeout"}
                  </Badge>
                )}
                <Button variant="ghost" size="icon-sm" onClick={clearConsole} title="Clear console">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div ref={consoleRef} className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-6">
              {lines.length === 0 && status === "idle" && (
                <div className="text-fg-subtle flex items-center gap-2">
                  <Zap className="h-3 w-3" /> Press <kbd className="font-mono text-2xs px-1 py-0.5 rounded bg-bg-muted border border-border">Run</kbd> to execute.
                </div>
              )}
              {status === "running" && lines.length === 0 && (
                <div className="text-fg-subtle flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Spinning up container…
                </div>
              )}
              {lines.map((l, i) => (
                <pre key={i} className={l.stream === "stderr" ? "text-red-400 whitespace-pre-wrap" : "text-emerald-400 whitespace-pre-wrap"}>
                  {l.text}
                </pre>
              ))}
            </div>
            {/* Sandbox info strip */}
            <div className="px-4 py-2 border-t border-border bg-bg-subtle/40 flex items-center gap-4 text-2xs text-fg-subtle">
              <span className="flex items-center gap-1"><Shield className="h-3 w-3" />No network</span>
              <span>256 MB RAM</span>
              <span>15s timeout</span>
              <span>gVisor ready</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tips */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
        <InfoCard title="Isolation" body="Every run starts a fresh Docker container with no network access and read-only root filesystem." />
        <InfoCard title="Resource caps" body="Each exec is capped at 256 MB RAM, 128 pids, and 15 seconds. Overruns return exit 137." />
        <InfoCard title="Agent tool" body={`Agents invoke this via the code_exec tool — enable it when creating an agent.`} />
      </div>
    </div>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold text-fg">{title}</div>
      <p className="text-xs text-fg-muted mt-1 leading-relaxed">{body}</p>
    </Card>
  );
}
