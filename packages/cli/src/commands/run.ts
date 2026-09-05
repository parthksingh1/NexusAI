/**
 * `nexus run` — give the manager a goal and watch it work.
 *
 * Exit codes are meaningful so this composes in a shell: 0 when the run completed, 2 when it
 * returned a partial answer because a cap was hit or a task failed, 1 on error.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora, { type Ora } from "ora";

const MANAGER_URL = process.env.MANAGER_URL ?? "http://localhost:4100";

type RunStatus = "queued" | "planning" | "running" | "done" | "partial" | "error";

interface PlanTask {
  id: string;
  type: string;
  goal: string;
  depends_on: string[];
  parallel_group: number;
}

interface Plan {
  goal: string;
  reasoning: string;
  tasks: PlanTask[];
  estimated_cost_usd: number;
}

interface RunEvent {
  run_id: string;
  ts: number;
  kind: string;
  payload: Record<string, any>;
}

interface RunDetail {
  run_id: string;
  status: RunStatus;
  answer: string | null;
  citations: string[];
  reason: string | null;
  budget: { usd_spent: number; tokens_used: number; agents_spawned: number } | null;
  results: Record<string, { ok: boolean; error: string | null; duration_ms: number }>;
}

const EXIT_CODE: Record<string, number> = { done: 0, error: 1, partial: 2 };

function typeColor(type: string) {
  switch (type) {
    case "research":
      return chalk.cyan;
    case "scrape":
      return chalk.blue;
    case "video":
      return chalk.magenta;
    case "code":
      return chalk.yellow;
    case "synthesize":
      return chalk.green;
    default:
      return chalk.white;
  }
}

async function managerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${MANAGER_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new Error(
      `The manager service at ${MANAGER_URL} is not responding. Start it with ` +
        `\`docker compose up -d manager\`, or set MANAGER_URL if it runs elsewhere.`,
    );
  }
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* keep the status line */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

function printPlan(plan: Plan) {
  console.log();
  console.log(chalk.bold(`Plan: ${plan.tasks.length} tasks`), chalk.dim(`(~$${plan.estimated_cost_usd.toFixed(3)})`));
  if (plan.reasoning) console.log(chalk.dim(plan.reasoning));
  console.log();

  const groups = new Map<number, PlanTask[]>();
  for (const task of plan.tasks) {
    groups.set(task.parallel_group, [...(groups.get(task.parallel_group) ?? []), task]);
  }
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    const tasks = groups.get(group)!;
    const concurrency = tasks.length > 1 ? chalk.dim(` (${tasks.length} in parallel)`) : "";
    console.log(chalk.dim(`  wave ${group}`) + concurrency);
    for (const task of tasks) {
      console.log(`    ${typeColor(task.type)(task.type.padEnd(11))} ${task.goal}`);
    }
  }
  console.log();
}

/** Read the SSE stream, calling back per event. */
async function consumeEvents(runId: string, onEvent: (event: RunEvent) => void): Promise<void> {
  const resp = await fetch(`${MANAGER_URL}/runs/${runId}/events`, {
    headers: { accept: "text/event-stream" },
  });
  if (!resp.ok || !resp.body) throw new Error(`could not open the event stream (${resp.status})`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as RunEvent);
        } catch {
          /* a malformed frame is not worth ending the stream over */
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function renderEvent(event: RunEvent, spinner: Ora, active: Set<string>): void {
  const { kind, payload } = event;

  switch (kind) {
    case "worker_start":
      active.add(payload.task_id);
      spinner.text = `${payload.task_type}: ${payload.goal}`.slice(0, 90);
      break;

    case "worker_step":
      spinner.text = `${payload.task_id}: ${payload.message}`.slice(0, 90);
      break;

    case "worker_done": {
      active.delete(payload.task_id);
      const result = payload.result ?? {};
      const seconds = ((result.duration_ms ?? 0) / 1000).toFixed(1);
      const sources = result.citations?.length ?? 0;
      spinner.stopAndPersist({
        symbol: chalk.green("✓"),
        text: `${payload.task_id} ${chalk.dim(`${seconds}s · ${sources} source${sources === 1 ? "" : "s"}`)}`,
      });
      spinner.start(active.size ? `${active.size} task(s) running` : "working");
      break;
    }

    case "worker_error":
      active.delete(payload.task_id);
      spinner.stopAndPersist({
        symbol: chalk.red("✗"),
        text: `${payload.task_id} ${chalk.red(String(payload.error).slice(0, 100))}`,
      });
      spinner.start(active.size ? `${active.size} task(s) running` : "working");
      break;

    case "budget_warn":
      spinner.stopAndPersist({ symbol: chalk.yellow("!"), text: chalk.yellow(payload.message) });
      spinner.start("working");
      break;

    case "budget_exceeded":
      spinner.stopAndPersist({
        symbol: chalk.yellow("!"),
        text: chalk.yellow(`budget cap reached — ${payload.reason}`),
      });
      spinner.start("finishing with partial results");
      break;

    default:
      break;
  }
}

function printResult(detail: RunDetail): void {
  console.log();
  if (detail.answer) {
    console.log(chalk.bold("Answer"));
    console.log(detail.answer);
  }

  if (detail.citations.length) {
    console.log();
    console.log(chalk.bold("Sources"));
    detail.citations.forEach((url, index) => console.log(`  ${chalk.dim(`[${index + 1}]`)} ${url}`));
  }

  const failed = Object.entries(detail.results).filter(([, r]) => !r.ok);
  if (failed.length) {
    console.log();
    console.log(chalk.yellow(`${failed.length} task(s) did not complete:`));
    for (const [id, result] of failed) console.log(`  ${chalk.dim(id)} ${result.error ?? "unknown"}`);
  }

  console.log();
  const tone = detail.status === "done" ? chalk.green : detail.status === "partial" ? chalk.yellow : chalk.red;
  const budget = detail.budget;
  console.log(
    tone(detail.status),
    budget
      ? chalk.dim(
          `· $${budget.usd_spent.toFixed(4)} · ${budget.tokens_used.toLocaleString()} tokens · ${budget.agents_spawned} agents`,
        )
      : "",
  );
  if (detail.reason) console.log(chalk.dim(detail.reason));
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Give the manager a goal; it plans, spawns specialist agents, and answers")
    .argument("<goal...>", "What you want researched, read, or built")
    .option("-p, --provider <provider>", "ollama | anthropic | openai | gemini")
    .option("--max-usd <usd>", "Spend ceiling for this run")
    .option("--stream", "Show live progress", true)
    .option("--no-stream", "Print only the final answer")
    .option("--json", "Print the run as JSON instead of prose")
    .action(async (goalParts: string[], opts) => {
      const goal = goalParts.join(" ");
      const spinner = ora({ text: "planning", isEnabled: opts.stream && !opts.json }).start();

      try {
        const started = await managerFetch<{ run_id: string; plan: Plan | null }>("/chat", {
          method: "POST",
          body: JSON.stringify({
            goal,
            provider: opts.provider,
            max_usd: opts.maxUsd ? Number(opts.maxUsd) : undefined,
          }),
        });

        spinner.stop();
        if (started.plan && !opts.json) printPlan(started.plan);

        if (opts.stream && !opts.json) {
          const active = new Set<string>();
          spinner.start("working");
          await consumeEvents(started.run_id, (event) => renderEvent(event, spinner, active));
          spinner.stop();
        } else {
          // Without the stream, poll until the run reaches a terminal state.
          for (;;) {
            const detail = await managerFetch<RunDetail>(`/runs/${started.run_id}`);
            if (["done", "partial", "error"].includes(detail.status)) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        const detail = await managerFetch<RunDetail>(`/runs/${started.run_id}`);
        if (opts.json) {
          console.log(JSON.stringify(detail, null, 2));
        } else {
          printResult(detail);
        }
        process.exitCode = EXIT_CODE[detail.status] ?? 1;
      } catch (error) {
        spinner.stop();
        console.error(chalk.red("error"), (error as Error).message);
        process.exitCode = 1;
      }
    });
}
