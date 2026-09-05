"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ExternalLink, Loader2, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ManagerUnreachable,
  managerApi,
  statusTone,
  type NodeState,
  type Plan,
  type ProviderId,
  type ProviderInfo,
  type RunDetail,
  type RunEvent,
  type RunStatus,
} from "@/lib/manager-api";
import { AgentGraph } from "./components/AgentGraph";
import { LLMPicker } from "./components/LLMPicker";
import { RunStream } from "./components/RunStream";

export default function ManagerPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<ProviderId>();
  const [goal, setGoal] = useState("");
  const [runId, setRunId] = useState<string>();
  const [plan, setPlan] = useState<Plan>();
  const [status, setStatus] = useState<RunStatus>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [detail, setDetail] = useState<RunDetail>();
  const [submitting, setSubmitting] = useState(false);
  const sourceRef = useRef<EventSource>();

  // ─── Providers ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    managerApi
      .providers()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        setProvider((current) => current ?? list.find((p) => p.available)?.id);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(
          error instanceof ManagerUnreachable ? error.message : `Could not load providers: ${error.message}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Event stream ─────────────────────────────────────────────

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(managerApi.eventsUrl(runId));
    sourceRef.current = source;

    source.onmessage = (message) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      setEvents((current) => [...current, event]);

      if (event.kind === "plan" && event.payload.plan) setPlan(event.payload.plan);
      if (event.kind === "done") {
        setStatus(event.payload.status);
        source.close();
        managerApi.getRun(runId).then(setDetail).catch(() => undefined);
      }
      if (event.kind === "error") {
        setStatus("error");
        source.close();
      }
    };

    source.onerror = () => {
      // The stream closes normally when a run finishes; only surface a genuine failure.
      if (source.readyState === EventSource.CLOSED && !status) {
        managerApi
          .getRun(runId)
          .then((run) => {
            setDetail(run);
            setStatus(run.status);
          })
          .catch(() => toast.error("Lost connection to the run stream."));
      }
    };

    return () => source.close();
  }, [runId, status]);

  // ─── Node states derived from the stream ──────────────────────

  const nodeStates = useMemo(() => {
    const states: Record<string, NodeState> = {};
    for (const task of plan?.tasks ?? []) states[task.id] = "pending";
    for (const event of events) {
      const id = event.payload.task_id as string | undefined;
      if (!id) continue;
      if (event.kind === "worker_start") states[id] = "running";
      if (event.kind === "worker_done") states[id] = "done";
      if (event.kind === "worker_error") {
        states[id] = (event.payload.error as string)?.includes("skipped") ? "skipped" : "error";
      }
    }
    return states;
  }, [plan, events]);

  const nodeDetails = useMemo(() => {
    const details: Record<string, string> = {};
    for (const event of events) {
      const id = event.payload.task_id as string | undefined;
      if (!id) continue;
      if (event.kind === "worker_step" && event.payload.message) details[id] = event.payload.message;
      if (event.kind === "worker_done") delete details[id];
      if (event.kind === "worker_error") details[id] = String(event.payload.error ?? "").slice(0, 90);
    }
    return details;
  }, [events]);

  const budget = detail?.budget ?? (events.findLast((e) => e.payload.snapshot)?.payload.snapshot as
    | RunDetail["budget"]
    | undefined);

  const running = status === "running" || status === "planning" || submitting;

  // ─── Actions ──────────────────────────────────────────────────

  const submit = useCallback(async () => {
    const trimmed = goal.trim();
    if (trimmed.length < 5 || running) return;

    sourceRef.current?.close();
    setSubmitting(true);
    setEvents([]);
    setPlan(undefined);
    setDetail(undefined);
    setStatus("planning");

    try {
      const started = await managerApi.startRun(trimmed, provider);
      setRunId(started.run_id);
      if (started.plan) setPlan(started.plan);
      setStatus("running");
    } catch (error) {
      setStatus(undefined);
      const message =
        error instanceof ManagerUnreachable ? error.message : (error as Error).message || "The run could not start.";
      toast.error(message, { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }, [goal, provider, running]);

  const stop = useCallback(async () => {
    if (!runId) return;
    try {
      await managerApi.cancelRun(runId);
      toast.success("Run cancelled.");
    } catch (error) {
      toast.error(`Could not cancel: ${(error as Error).message}`);
    }
  }, [runId]);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    setRunId(undefined);
    setPlan(undefined);
    setEvents([]);
    setDetail(undefined);
    setStatus(undefined);
  }, []);

  const answer = detail?.answer ?? (events.findLast((e) => e.kind === "synthesis")?.payload.answer as string | undefined);
  const citations =
    detail?.citations ?? ((events.findLast((e) => e.kind === "synthesis")?.payload.citations as string[]) ?? []);

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <div className="flex min-w-[320px] flex-1 items-center gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Describe what you want researched, read, or built"
            disabled={running}
            className="h-9 w-full rounded-md border border-border bg-bg px-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-fg-muted disabled:opacity-60"
          />
          <Button size="sm" onClick={() => void submit()} disabled={running || goal.trim().length < 5}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
          </Button>
        </div>

        <LLMPicker providers={providers} value={provider} onChange={setProvider} disabled={running} />

        {status && (
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize",
              statusTone(status),
            )}
          >
            {status}
          </span>
        )}

        {budget && (
          <span className="text-[12px] tabular-nums text-fg-muted">
            ${budget.usd_spent.toFixed(4)}
            <span className="opacity-60"> / ${budget.max_usd.toFixed(2)}</span>
            <span className="ml-2 opacity-60">
              {budget.tokens_used.toLocaleString()} tok · {budget.agents_spawned}/{budget.max_agents} agents
            </span>
          </span>
        )}

        {running && runId && (
          <Button size="sm" variant="ghost" onClick={() => void stop()}>
            <Square size={13} /> Stop
          </Button>
        )}
        {!running && runId && (
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw size={13} /> New
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 border-b border-border">
            {plan ? (
              <AgentGraph plan={plan} states={nodeStates} details={nodeDetails} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div className="max-w-md">
                  <p className="text-[14px] text-fg">
                    {running ? "Planning the work…" : "Enter a goal to build an agent graph."}
                  </p>
                  <p className="mt-1.5 text-[13px] text-fg-muted">
                    The planner decomposes it into specialist tasks. Independent tasks run at the same time.
                  </p>
                </div>
              </div>
            )}
          </div>

          {(answer || detail?.reason) && (
            <section className="max-h-[42%] overflow-y-auto px-6 py-4">
              {detail?.reason && status !== "done" && (
                <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                  {detail.reason}
                </p>
              )}
              {answer && (
                <>
                  <h2 className="mb-2 text-[13px] font-medium text-fg-muted">Answer</h2>
                  <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg">{answer}</div>
                  {citations.length > 0 && (
                    <>
                      <h3 className="mb-1.5 mt-4 text-[12px] font-medium text-fg-muted">Sources</h3>
                      <ol className="space-y-1">
                        {citations.map((url, index) => (
                          <li key={url} className="flex items-baseline gap-2 text-[12px]">
                            <span className="tabular-nums text-fg-muted">[{index + 1}]</span>
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 truncate text-sky-400 hover:underline"
                            >
                              {url}
                              <ExternalLink size={11} className="shrink-0 opacity-70" />
                            </a>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </main>

        <aside className="flex w-[340px] shrink-0 flex-col border-l border-border">
          <div className="border-b border-border px-3 py-2">
            <h2 className="text-[12px] font-medium text-fg-muted">Activity</h2>
          </div>
          <RunStream events={events} />
        </aside>
      </div>
    </div>
  );
}
