import pino from "pino";
import type { MarketTick } from "../clickhouse.js";

const log = pino({ name: "source-news" });

/**
 * Polls Hacker News front-page every 60s. Each item produces a synthetic tick
 * with sentiment computed lazily downstream. Good demo source; swap in a real
 * news API (NewsAPI, Finnhub) when keys are available.
 */
export function startNewsPolling(onTick: (t: MarketTick) => void): () => void {
  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const seen = new Set<number>();

  const tick = async () => {
    if (closed) return;
    try {
      const ids = (await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json()) as number[];
      const fresh = ids.slice(0, 20).filter((id) => !seen.has(id));
      for (const id of fresh) {
        seen.add(id);
        const item = (await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json()) as {
          title?: string; score?: number; time?: number; url?: string;
        };
        if (!item?.title) continue;
        onTick({
          ts: new Date((item.time ?? Date.now() / 1000) * 1000).toISOString().replace("T", " ").slice(0, 23),
          symbol: (item.title ?? "").slice(0, 64),
          source: "news",
          price: item.score ?? 0,
          volume: 1,
          sentiment: 0,
        });
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, "news poll failed");
    } finally {
      if (!closed) timer = setTimeout(tick, 60_000);
    }
  };

  void tick();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
