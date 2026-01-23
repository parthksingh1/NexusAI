import { LlmRouter } from "@nexusai/llm-router";

const router = new LlmRouter({
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  googleKey: process.env.GOOGLE_API_KEY,
});

/**
 * LLM-scored sentiment in [-1, 1]. Batches aggressively to control cost.
 * Queue-batched: collects items for up to 500ms or until batch hits 16, whichever first.
 */
type PendingItem = { text: string; resolve: (v: number) => void };
const queue: PendingItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;

export function scoreSentiment(text: string): Promise<number> {
  return new Promise((resolve) => {
    queue.push({ text, resolve });
    if (queue.length >= 16) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 500);
  });
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = queue.splice(0, 16);
  if (!batch.length) return;

  try {
    const prompt = batch.map((b, i) => `${i + 1}. ${b.text.slice(0, 200)}`).join("\n");
    const result = await router.complete({
      messages: [
        {
          role: "system",
          content:
            "Score each numbered item's sentiment from -1.0 (very negative) to +1.0 (very positive). " +
            "Reply with only a JSON array of numbers in order. Example: [0.3,-0.8,0.9]",
        },
        { role: "user", content: prompt },
      ],
      taskType: "classification",
      maxTokens: 150,
      temperature: 0.0,
      jsonMode: false,
    });
    const match = result.content.match(/\[[-0-9.,\s]+\]/);
    const arr = match ? (JSON.parse(match[0]) as number[]) : [];
    batch.forEach((item, i) => item.resolve(arr[i] ?? 0));
  } catch {
    batch.forEach((item) => item.resolve(0));
  }
}
