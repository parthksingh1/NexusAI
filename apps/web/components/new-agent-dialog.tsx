"use client";

import { useEffect, useState } from "react";
import { api, type Tool } from "@/lib/api";
import { toast } from "sonner";
import { Bot, Search, Wrench, ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

const TEMPLATES = [
  {
    id: "research",
    name: "Research Assistant",
    goal: "Help the user research topics, synthesize findings, and produce cited summaries.",
    prompt: "You are a careful research assistant. Use tools to gather evidence. Cite the URLs your claims are grounded in.",
    tools: ["web_search", "knowledge_search", "calculator"],
  },
  {
    id: "support",
    name: "Customer Support",
    goal: "Answer customer questions using our knowledge base. Escalate when needed.",
    prompt: "You are a polite L1 support specialist. Prefer answers grounded in our KB. Escalate cases you cannot resolve.",
    tools: ["knowledge_search"],
  },
  {
    id: "coder",
    name: "Code Helper",
    goal: "Write, debug, and explain code snippets. Use the sandbox to verify outputs.",
    prompt: "You are a senior software engineer. Write concise, correct code. Always run it in the sandbox before claiming it works.",
    tools: ["code_exec", "calculator", "github_read_file"],
  },
  {
    id: "blank",
    name: "Start from scratch",
    goal: "",
    prompt: "You are a helpful autonomous agent.",
    tools: [],
  },
];

export function NewAgentDialog({ open, onOpenChange, onCreated }: Props) {
  const [step, setStep] = useState<"template" | "form">("template");
  const [templateId, setTemplateId] = useState("research");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [provider, setProvider] = useState("auto");
  const [tools, setTools] = useState<Tool[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.listTools().then((d) => setTools(d.tools)).catch(() => setTools([]));
    setStep("template");
  }, [open]);

  function pickTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setTemplateId(id);
    setName(t.name);
    setGoal(t.goal);
    setSystemPrompt(t.prompt);
    setSelected(new Set(t.tools));
    setStep("form");
  }

  async function save() {
    try {
      setSaving(true);
      await api.createAgent({
        name, goal,
        persona: { name, description: goal.slice(0, 200), systemPrompt, temperature: 0.3 },
        tools: Array.from(selected),
      });
      toast.success("Agent created");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create agent");
    } finally { setSaving(false); }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={step === "template" ? "Pick a starting point" : "Configure your agent"}
      description={step === "template" ? "We'll pre-fill a sensible config. You can change anything later." : undefined}
      size={step === "template" ? "lg" : "md"}
      footer={step === "form" ? (
        <>
          <Button variant="ghost" onClick={() => setStep("template")}>Back</Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!name.trim() || !goal.trim()}>Create agent</Button>
        </>
      ) : undefined}
    >
      {step === "template" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTemplate(t.id)}
              className="text-left p-4 rounded-lg border border-border bg-bg-elevated hover:border-brand hover:bg-brand-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className="h-8 w-8 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Bot className="h-4 w-4 text-brand" />
                </div>
                <span className="font-semibold tracking-tight text-sm">{t.name}</span>
              </div>
              <p className="text-xs text-fg-muted line-clamp-2 leading-relaxed">
                {t.goal || "Start with a blank slate."}
              </p>
              {t.tools.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {t.tools.slice(0, 3).map((x) => <Badge key={x} size="sm">{x}</Badge>)}
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research Assistant" />
          </div>
          <div>
            <Label>Goal</Label>
            <Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should this agent accomplish?" />
          </div>
          <div>
            <Label>System prompt</Label>
            <Textarea rows={4} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} className="font-mono text-xs" />
          </div>
          <div>
            <Label>Preferred model provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (smart routing)</SelectItem>
                <SelectItem value="anthropic">Anthropic Claude</SelectItem>
                <SelectItem value="openai">OpenAI GPT</SelectItem>
                <SelectItem value="gemini">Google Gemini</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tools</Label>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((t) => {
                const on = selected.has(t.name);
                const riskColor = t.risk === "dangerous" ? "text-danger" : t.risk === "moderate" ? "text-warn" : "text-fg-subtle";
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      const next = new Set(selected);
                      if (on) next.delete(t.name); else next.add(t.name);
                      setSelected(next);
                    }}
                    title={t.description}
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-all",
                      on
                        ? "bg-brand text-brand-fg border-brand shadow-sm"
                        : "bg-bg-elevated text-fg-muted border-border hover:border-border-strong hover:text-fg",
                    )}
                  >
                    <Wrench className={cn("h-3 w-3", on ? "text-brand-fg" : riskColor)} />
                    {t.name}
                    {t.risk === "dangerous" && !on && <ShieldAlert className="h-3 w-3 text-danger" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
