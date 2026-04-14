import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

/**
 * Must match apps/orchestrator/src/auth/passwords.ts so the orchestrator
 * can verify the seeded password. Keep parameters in sync.
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEMO_EMAIL = "demo@nexusai.local";
const DEMO_PASSWORD = "demo1234";

async function main() {
  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {
      email: DEMO_EMAIL,
      name: "Demo User",
      passwordHash: hashPassword(DEMO_PASSWORD),
      tier: "PRO",
    },
    create: {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      name: "Demo User",
      passwordHash: hashPassword(DEMO_PASSWORD),
      tier: "PRO",
    },
  });
  console.log(`✔ Demo user: ${user.email}  (password: ${DEMO_PASSWORD})`);

  // ─── Seed a handful of realistic demo agents ───────────────
  const agents: Array<{ name: string; goal: string; systemPrompt: string; tools: string[] }> = [
    {
      name: "Research Assistant",
      goal: "Help the user research topics, synthesize findings, and produce cited summaries.",
      systemPrompt:
        "You are a careful research assistant. Use web_search for current topics and knowledge_search for internal docs. Cite every source URL.",
      tools: ["web_search", "calculator", "knowledge_search"],
    },
    {
      name: "Customer Support",
      goal: "Answer customer questions grounded in our documentation, and escalate when needed.",
      systemPrompt:
        "You are a polite L1 support specialist. Prefer answers grounded in our knowledge base. Escalate cases you cannot resolve with a structured hand-off.",
      tools: ["knowledge_search", "web_search"],
    },
    {
      name: "Code Helper",
      goal: "Write, debug, and explain code snippets. Verify outputs in the sandbox.",
      systemPrompt:
        "You are a senior software engineer. Write concise, correct code. Always run it in the sandbox before claiming it works.",
      tools: ["code_exec", "calculator", "github_read_file"],
    },
    {
      name: "Market Analyst",
      goal: "Research public markets, summarize earnings calls, and track competitor news.",
      systemPrompt:
        "You analyze public equity markets. Always cite primary sources and quantify claims. When uncertain, say so.",
      tools: ["web_search", "knowledge_search", "calculator"],
    },
  ];

  for (const a of agents) {
    const existing = await prisma.agent.findFirst({ where: { ownerId: user.id, name: a.name } });
    if (existing) continue;
    const agent = await prisma.agent.create({
      data: {
        ownerId: user.id,
        name: a.name,
        goal: a.goal,
        persona: {
          name: a.name,
          description: a.goal.slice(0, 160),
          systemPrompt: a.systemPrompt,
          temperature: 0.3,
        },
        tools: a.tools,
        modelRoutingPolicy: { preferredProvider: "gemini", maxLatencyMs: 3000 },
      },
    });
    console.log(`✔ Seeded agent: ${agent.name}`);
  }
}

main()
  .then(() => {
    console.log("\nSign in at /login with:");
    console.log(`  email:    ${DEMO_EMAIL}`);
    console.log(`  password: ${DEMO_PASSWORD}`);
    console.log("\nOr just click 'Try the demo' — it fills these automatically.\n");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
