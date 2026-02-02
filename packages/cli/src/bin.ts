#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { NexusClient } from "@nexusai/sdk";

const program = new Command();
program.name("nexus").description("NexusAI CLI").version("0.1.0");

function client(): NexusClient {
  return new NexusClient();
}

program
  .command("agents:list")
  .description("List your agents")
  .action(async () => {
    const { agents } = await client().agents.list();
    if (!agents.length) { console.log(chalk.dim("No agents yet. Run `nexus agents:create`.")); return; }
    for (const a of agents) {
      console.log(`${chalk.bold(a.name)}  ${chalk.dim(a.id)}`);
      console.log(`  goal: ${a.goal}`);
      console.log(`  status: ${a.status}  tools: ${a.tools.join(", ") || "(none)"}`);
    }
  });

program
  .command("agents:create")
  .description("Create an agent")
  .requiredOption("-n, --name <name>")
  .requiredOption("-g, --goal <goal>")
  .option("-p, --prompt <prompt>", "System prompt", "You are a helpful autonomous agent.")
  .option("-t, --tools <tools>", "Comma-separated tools", "web_search,calculator")
  .action(async (opts) => {
    const agent = await client().agents.create({
      name: opts.name,
      goal: opts.goal,
      persona: { name: opts.name, description: opts.goal, systemPrompt: opts.prompt },
      tools: (opts.tools as string).split(",").map((s) => s.trim()).filter(Boolean),
    });
    console.log(chalk.green("created"), agent.id);
  });

program
  .command("agents:run")
  .description("Run an agent with a prompt and stream ReAct steps")
  .argument("<agentId>")
  .argument("<input...>")
  .option("-m, --max-steps <n>", "Max steps", "12")
  .action(async (agentId: string, input: string[], opts) => {
    const prompt = input.join(" ");
    const nx = client();
    const spinner = ora("Starting run").start();
    try {
      for await (const ev of nx.agents.run(agentId, prompt, Number(opts.maxSteps))) {
        spinner.stop();
        if ("kind" in ev) {
          const color =
            ev.kind === "thought" ? chalk.blue :
            ev.kind === "action" ? chalk.yellow :
            ev.kind === "observation" ? chalk.magenta :
            chalk.green;
          console.log(color(`[${ev.kind}${ev.tool ? ` ${ev.tool}` : ""}]`), ev.content.slice(0, 400));
        } else if ("type" in ev && ev.type === "done") {
          console.log(chalk.bold(`\n=== ${ev.status} ===`));
          if (ev.result) console.log(ev.result);
        }
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("ingest")
  .description("Ingest text into the RAG knowledge base")
  .requiredOption("-t, --title <title>")
  .requiredOption("-s, --source-id <sid>")
  .option("--source <source>", "notion|github|slack|url|upload", "upload")
  .option("-f, --file <file>", "Read text from file (else stdin)")
  .action(async (opts) => {
    const fs = await import("node:fs/promises");
    const text = opts.file ? await fs.readFile(opts.file, "utf8") : await readStdin();
    const res = await client().rag.ingest({
      source: opts.source,
      sourceId: opts.sourceId,
      title: opts.title,
      text,
    });
    console.log(chalk.green("ingested"), res);
  });

program
  .command("search")
  .description("Hybrid search the RAG index")
  .argument("<query...>")
  .option("-k <k>", "topK", "5")
  .action(async (query: string[], opts) => {
    const { hits } = await client().rag.search(query.join(" "), Number(opts.k));
    for (const h of hits) {
      console.log(chalk.bold(h.title), chalk.dim(`(score ${h.score.toFixed(3)})`));
      console.log("  " + h.snippet.slice(0, 200));
    }
  });

async function readStdin(): Promise<string> {
  return new Promise((res) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c.toString()));
    process.stdin.on("end", () => res(data));
  });
}

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red("error"), err?.message ?? err);
  process.exitCode = 1;
});
