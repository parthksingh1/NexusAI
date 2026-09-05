"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDot, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EventKind, RunEvent } from "@/lib/manager-api";

const KIND_ICON: Partial<Record<EventKind, typeof CircleDot>> = {
  worker_start: Loader2,
  worker_done: CheckCircle2,
  worker_error: XCircle,
  budget_warn: AlertTriangle,
  budget_exceeded: AlertTriangle,
  error: XCircle,
  done: CheckCircle2,
};

const KIND_TONE: Partial<Record<EventKind, string>> = {
  plan: "text-violet-400",
  worker_start: "text-sky-400",
  worker_step: "text-fg-muted",
  worker_done: "text-emerald-400",
  worker_error: "text-rose-400",
  budget_warn: "text-amber-400",
  budget_exceeded: "text-amber-400",
  synthesis: "text-violet-400",
  done: "text-emerald-400",
  error: "text-rose-400",
};

function describe(event: RunEvent): { title: string; body?: string } {
  const { kind, payload } = event;
  switch (kind) {
    case "plan":
      return {
        title: `Planned ${payload.plan?.tasks?.length ?? 0} tasks`,
        body: payload.plan?.reasoning,
      };
    case "worker_start":
      return { title: `${payload.task_type} started`, body: payload.goal };
    case "worker_step":
      return { title: payload.message ?? "step" };
    case "worker_done": {
      const result = payload.result ?? {};
      const citations = result.citations?.length ?? 0;
      return {
        title: `${payload.task_id} complete`,
        body: `${citations} source${citations === 1 ? "" : "s"} · ${result.tokens_used ?? 0} tokens · ${
          Math.round((result.duration_ms ?? 0) / 100) / 10
        }s`,
      };
    }
    case "worker_error":
      return { title: `${payload.task_id} failed`, body: payload.error };
    case "budget_warn":
      return { title: payload.message ?? "budget running low" };
    case "budget_exceeded":
      return { title: "Budget cap reached", body: payload.reason };
    case "synthesis":
      return { title: "Answer written", body: `${payload.citations?.length ?? 0} citations` };
    case "done":
      return { title: `Run ${payload.status}`, body: payload.reason ?? undefined };
    case "error":
      return { title: "Run failed", body: payload.error };
    default:
      return { title: kind };
  }
}

function EventRow({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const { title, body } = describe(event);
  const Icon = KIND_ICON[event.kind] ?? CircleDot;
  const tone = KIND_TONE[event.kind] ?? "text-fg-muted";
  const expandable = event.kind === "worker_done" || event.kind === "plan";

  return (
    <li className="border-b border-border/60 px-3 py-2 last:border-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn("flex w-full items-start gap-2 text-left", expandable && "cursor-pointer")}
        aria-expanded={expandable ? open : undefined}
      >
        <Icon
          size={13}
          className={cn("mt-0.5 shrink-0", tone, event.kind === "worker_start" && "animate-spin")}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] leading-snug text-fg">{title}</span>
          {body && <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">{body}</span>}
        </span>
        {expandable && (
          <ChevronRight size={12} className={cn("mt-1 shrink-0 text-fg-muted transition", open && "rotate-90")} />
        )}
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-border bg-bg px-2 py-1.5 text-[10px] leading-relaxed text-fg-muted">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function RunStream({ events }: { events: RunEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, pinned]);

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        // Unpin as soon as the reader scrolls up, so the log stops yanking them back down.
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
      }}
    >
      {events.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-fg-muted">Activity will appear here once a run starts.</p>
      ) : (
        <ul>
          {events.map((event, index) => (
            <EventRow key={`${event.ts}-${index}`} event={event} />
          ))}
        </ul>
      )}
      <div ref={endRef} />
    </div>
  );
}
