import WebSocket from "ws";
import pino from "pino";
import type { MarketTick } from "../clickhouse.js";

const log = pino({ name: "source-crypto" });

/**
 * Connects to Binance's public trade stream (no auth, public data).
 * Emits unified MarketTick events. Auto-reconnects with backoff.
 */
export function startCryptoStream(symbols: string[], onTick: (t: MarketTick) => void): () => void {
  const lower = symbols.map((s) => s.toLowerCase());
  const streams = lower.map((s) => `${s}@trade`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 1000;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.on("open", () => {
      log.info({ count: symbols.length }, "crypto stream connected");
      backoff = 1000;
    });
    ws.on("message", (buf) => {
      try {
        const envelope = JSON.parse(buf.toString());
        const d = envelope.data;
        if (!d?.s || !d?.p) return;
        onTick({
          ts: new Date(d.T ?? Date.now()).toISOString().replace("T", " ").slice(0, 23),
          symbol: d.s,
          source: "crypto",
          price: parseFloat(d.p),
          volume: parseFloat(d.q ?? "0"),
          sentiment: 0,
        });
      } catch {
        /* ignore */
      }
    });
    const reconnect = () => {
      if (closed) return;
      setTimeout(connect, backoff);
      backoff = Math.min(30_000, backoff * 2);
    };
    ws.on("close", reconnect);
    ws.on("error", (err) => log.warn({ err: err.message }, "crypto stream error"));
  };

  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
