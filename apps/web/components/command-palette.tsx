"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard, Bot, Code2, Activity, Database, Store, ShieldAlert, BarChart3,
  CreditCard, Settings, Plus, Zap, Users, Plug, FileText, Sun, Moon, Workflow,
  Target, Network, GitCompare, GitBranch, Calendar, Webhook, Shield, ScrollText,
  Radar, Terminal, BookOpen, Rocket, Keyboard,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

type NavAction = { id: string; label: string; icon: LucideIcon; href?: string; action?: () => void; group: string; shortcut?: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const actions: NavAction[] = [
    // Navigate — Build
    { id: "nav-dash",      group: "Navigate", label: "Overview",       icon: LayoutDashboard, href: "/",            shortcut: "G D" },
    { id: "nav-agents",    group: "Navigate", label: "Agents",         icon: Bot,             href: "/agents",      shortcut: "G A" },
    { id: "nav-workflows", group: "Navigate", label: "Workflows",      icon: Workflow,        href: "/workflows",   shortcut: "G W" },
    { id: "nav-prompts",   group: "Navigate", label: "Prompt library", icon: FileText,        href: "/prompts" },
    { id: "nav-play",      group: "Navigate", label: "Playground",     icon: Code2,           href: "/playground",  shortcut: "G P" },
    { id: "nav-compare",   group: "Navigate", label: "Model compare",  icon: GitCompare,      href: "/compare",     shortcut: "G C" },
    { id: "nav-schedules", group: "Navigate", label: "Schedules",      icon: Calendar,        href: "/schedules" },
    { id: "nav-webhooks",  group: "Navigate", label: "Webhooks",       icon: Webhook,         href: "/webhooks" },
    { id: "nav-activity",  group: "Navigate", label: "Activity",       icon: ScrollText,     href: "/activity" },
    { id: "nav-streams",   group: "Navigate", label: "Live streams",   icon: Activity,        href: "/streams" },
    { id: "nav-kb",        group: "Navigate", label: "Knowledge base", icon: Database,        href: "/knowledge" },
    { id: "nav-graph",     group: "Navigate", label: "Memory graph",   icon: Network,         href: "/memory-graph" },
    { id: "nav-metrics",   group: "Navigate", label: "Metrics",        icon: BarChart3,       href: "/metrics",     shortcut: "G M" },
    { id: "nav-traces",    group: "Navigate", label: "Traces",         icon: GitBranch,       href: "/traces",      shortcut: "G T" },
    { id: "nav-evals",     group: "Navigate", label: "Evaluations",    icon: Target,          href: "/evaluations", shortcut: "G E" },
    { id: "nav-status",    group: "Navigate", label: "Status",         icon: Radar,           href: "/status" },
    { id: "nav-approvals", group: "Navigate", label: "Approvals",      icon: ShieldAlert,     href: "/approvals" },
    { id: "nav-guard",     group: "Navigate", label: "Guardrails",     icon: Shield,          href: "/guardrails" },
    { id: "nav-audit",     group: "Navigate", label: "Audit log",      icon: ScrollText,      href: "/audit" },
    { id: "nav-market",    group: "Navigate", label: "Marketplace",    icon: Store,           href: "/marketplace" },
    { id: "nav-integr",    group: "Navigate", label: "Integrations",   icon: Plug,            href: "/integrations" },
    { id: "nav-team",      group: "Navigate", label: "Team",           icon: Users,           href: "/team" },
    { id: "nav-billing",   group: "Navigate", label: "Billing",        icon: CreditCard,      href: "/billing" },
    { id: "nav-settings",  group: "Navigate", label: "Settings",       icon: Settings,        href: "/settings",    shortcut: "⌘ ," },
    { id: "nav-api",       group: "Navigate", label: "API explorer",   icon: Terminal,        href: "/api-explorer" },
    { id: "nav-docs",      group: "Navigate", label: "Docs",           icon: BookOpen,        href: "/docs" },
    { id: "nav-changelog", group: "Navigate", label: "Changelog",      icon: Rocket,          href: "/changelog" },

    // Actions
    { id: "act-new-agent",    group: "Actions", label: "Create new agent",      icon: Plus,   href: "/agents?new=1", shortcut: "N" },
    { id: "act-new-wf",       group: "Actions", label: "Create new workflow",   icon: Plus,   href: "/workflows/new" },
    { id: "act-new-schedule", group: "Actions", label: "Create new schedule",   icon: Plus,   href: "/schedules" },
    { id: "act-new-eval",     group: "Actions", label: "Start new evaluation",  icon: Target, href: "/evaluations" },
    { id: "act-run",          group: "Actions", label: "Run last agent again",  icon: Zap,    action: () => toast.info("Re-running last agent") },
    { id: "act-shortcuts",    group: "Actions", label: "Show keyboard shortcuts", icon: Keyboard, action: () => {
      const evt = new KeyboardEvent("keydown", { key: "?", bubbles: true });
      document.dispatchEvent(evt);
    }},

    // Preferences
    { id: "theme-light",   group: "Preferences", label: "Switch to light theme", icon: Sun,  action: () => { document.documentElement.classList.remove("dark"); toast.success("Light theme"); } },
    { id: "theme-dark",    group: "Preferences", label: "Switch to dark theme",  icon: Moon, action: () => { document.documentElement.classList.add("dark"); toast.success("Dark theme"); } },
  ];

  const groups = Array.from(new Set(actions.map((a) => a.group)));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] p-4 bg-bg/70 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-bg-elevated shadow-lg animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Search commands, agents, docs…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g} heading={g}>
                {actions.filter((a) => a.group === g).map((a) => (
                  <CommandItem
                    key={a.id}
                    value={a.label}
                    onSelect={() => {
                      setOpen(false);
                      if (a.href) router.push(a.href);
                      else a.action?.();
                    }}
                  >
                    <a.icon className="h-4 w-4 text-fg-muted" />
                    <span>{a.label}</span>
                    {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="border-t border-border px-4 py-2.5 text-2xs text-fg-subtle flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span><kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> select</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
            <span>NexusAI</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
