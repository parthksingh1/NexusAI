"use client";

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/cn";

const SECTIONS: { title: string; items: { keys: string[]; action: string }[] }[] = [
  {
    title: "General",
    items: [
      { keys: ["⌘", "K"], action: "Open command palette" },
      { keys: ["⌘", ","], action: "Open settings" },
      { keys: ["?"],       action: "Show keyboard shortcuts" },
      { keys: ["/"],       action: "Focus search" },
      { keys: ["Esc"],     action: "Close dialog / panel" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: ["G", "D"], action: "Go to overview" },
      { keys: ["G", "A"], action: "Go to agents" },
      { keys: ["G", "W"], action: "Go to workflows" },
      { keys: ["G", "P"], action: "Go to playground" },
      { keys: ["G", "M"], action: "Go to metrics" },
      { keys: ["G", "E"], action: "Go to evaluations" },
      { keys: ["G", "C"], action: "Go to compare" },
      { keys: ["G", "T"], action: "Go to traces" },
      { keys: ["G", "S"], action: "Go to settings" },
    ],
  },
  {
    title: "Agents",
    items: [
      { keys: ["N"],      action: "New agent" },
      { keys: ["R"],      action: "Run selected agent" },
      { keys: ["⌘", "D"], action: "Duplicate agent" },
      { keys: ["⌘", "↵"], action: "Run from prompt box" },
    ],
  },
  {
    title: "Playground",
    items: [
      { keys: ["⌘", "↵"], action: "Run code" },
      { keys: ["⌘", "S"], action: "Save snippet" },
      { keys: ["⌘", "⇧", "T"], action: "New tab" },
    ],
  },
];

export function ShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName ?? "")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-bg/70 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-bg-elevated shadow-lg animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-fg-muted" />
            <h2 className="font-semibold tracking-tight">Keyboard shortcuts</h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-fg-subtle hover:text-fg rounded-md p-1 hover:bg-bg-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 p-5 max-h-[70vh] overflow-y-auto">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <div className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle mb-2">{s.title}</div>
              <ul className="space-y-1.5">
                {s.items.map((i, k) => (
                  <li key={k} className="flex items-center justify-between py-1">
                    <span className="text-sm text-fg-muted">{i.action}</span>
                    <div className="flex items-center gap-1">
                      {i.keys.map((key, j) => (
                        <kbd key={j} className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-bg-muted px-1 font-mono text-2xs text-fg-muted">
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-5 py-3 text-2xs text-fg-subtle flex items-center justify-between">
          <span>Press <kbd className="font-mono px-1 py-0.5 rounded bg-bg-muted border border-border">?</kbd> anywhere to open</span>
          <span>NexusAI · v1.4.0</span>
        </div>
      </div>
    </div>
  );
}
