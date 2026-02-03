import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: "demo@nexusai.local",
      name: "Demo User",
      tier: "PRO",
    },
  });
  console.log("user:", user.email);

  const existing = await prisma.agent.findFirst({ where: { ownerId: user.id, name: "Research Assistant" } });
  if (!existing) {
    const agent = await prisma.agent.create({
      data: {
        ownerId: user.id,
        name: "Research Assistant",
        goal: "Help the user research topics, synthesize findings, and produce cited summaries.",
        persona: {
          name: "Research Assistant",
          description: "Careful, source-grounded researcher.",
          systemPrompt:
            "You are a careful research assistant. Use web_search for current topics and knowledge_search for internal docs. Cite every source URL.",
          temperature: 0.3,
        },
        tools: ["web_search", "calculator", "knowledge_search"],
        modelRoutingPolicy: { preferredProvider: "anthropic", maxLatencyMs: 3000 },
      },
    });
    console.log("seeded agent:", agent.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
