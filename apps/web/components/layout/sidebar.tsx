"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot, Code2, Activity, Store, ShieldAlert, BarChart3, Database, CreditCard,
  Settings, LayoutDashboard, Sparkles, FileText, Users, Plug, ChevronsLeft,
  HelpCircle, Workflow, Target, Network, GitCompare, GitBranch, Calendar,
  Webhook, Shield, ScrollText, Radar, Terminal, BookOpen, Rocket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string | number };

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/",           label: "Overview",   icon: LayoutDashboard },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/agents",     label: "Agents",     icon: Bot, badge: 6 },
      { href: "/workflows",  label: "Workflows",  icon: Workflow, badge: 5 },
      { href: "/prompts",    label: "Prompts",    icon: FileText },
      { href: "/playground", label: "Playground", icon: Code2 },
      { href: "/compare",    label: "Compare",    icon: GitCompare },
    ],
  },
  {
    title: "Run",
    items: [
      { href: "/schedules",  label: "Schedules",  icon: Calendar },
      { href: "/webhooks",   label: "Webhooks",   icon: Webhook },
      { href: "/activity",   label: "Activity",   icon: ScrollText },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/streams",      label: "Live streams", icon: Activity, badge: "Live" },
      { href: "/knowledge",    label: "Knowledge",    icon: Database },
      { href: "/memory-graph", label: "Memory graph", icon: Network },
    ],
  },
  {
    title: "Observe",
    items: [
      { href: "/metrics",     label: "Metrics",      icon: BarChart3 },
      { href: "/traces",      label: "Traces",        icon: GitBranch },
      { href: "/evaluations", label: "Evaluations",  icon: Target },
      { href: "/status",      label: "Status",       icon: Radar },
    ],
  },
  {
    title: "Trust",
    items: [
      { href: "/approvals",   label: "Approvals",    icon: ShieldAlert, badge: 2 },
      { href: "/guardrails",  label: "Guardrails",   icon: Shield },
      { href: "/audit",       label: "Audit log",    icon: ScrollText },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/marketplace",  label: "Marketplace",  icon: Store },
      { href: "/integrations", label: "Integrations", icon: Plug },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/team",     label: "Team",     icon: Users },
      { href: "/billing",  label: "Billing",  icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    title: "Developer",
    items: [
      { href: "/api-explorer", label: "API explorer", icon: Terminal },
      { href: "/docs",         label: "Docs",         icon: BookOpen },
      { href: "/changelog",    label: "Changelog",    icon: Rocket },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-bg-subtle flex flex-col">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2.5 px-4 h-14 border-b border-border hover:bg-bg-hover transition-colors">
        <div className="relative h-7 w-7 rounded-md bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-none flex-1">
          <span className="font-semibold tracking-tight text-[14px]">NexusAI</span>
          <span className="text-2xs text-fg-subtle mt-0.5">Agent OS · v1.4</span>
        </div>
        <ChevronsLeft className="h-3.5 w-3.5 text-fg-subtle" />
      </Link>

      {/* Nav — scrolls independently */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-3">
        {SECTIONS.map((section, i) => (
          <div key={i}>
            {section.title && (
              <div className="px-2 mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
                {section.title}
              </div>
            )}
            <ul className="space-y-px">
              {section.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-bg-elevated text-fg shadow-sm border border-border"
                          : "text-fg-muted hover:text-fg hover:bg-bg-hover border border-transparent",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-colors",
                          active ? "text-brand" : "text-fg-subtle group-hover:text-fg-muted",
                        )}
                        strokeWidth={active ? 2.25 : 2}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={cn(
                            "text-2xs font-medium px-1.5 py-0.5 rounded-full",
                            item.badge === "Live"
                              ? "bg-success/10 text-success border border-success/20"
                              : active
                                ? "bg-bg-muted text-fg-muted"
                                : "bg-bg-muted text-fg-subtle",
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={() => {
            const evt = new KeyboardEvent("keydown", { key: "?", bubbles: true });
            document.dispatchEvent(evt);
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-fg-muted hover:text-fg hover:bg-bg-hover rounded-md transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5 text-fg-subtle" />
          <span className="flex-1 text-left">Shortcuts</span>
          <kbd className="text-2xs text-fg-subtle font-mono">?</kbd>
        </button>
        <Link href="/status" className="block rounded-md bg-bg-elevated border border-border p-2.5 text-2xs hover:bg-bg-hover transition-colors">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
            <span>All systems normal</span>
          </div>
          <div className="text-fg-subtle mt-0.5">99.98% · 90d</div>
        </Link>
      </div>
    </aside>
  );
}
