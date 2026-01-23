import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Kafka } from "kafkajs";
import pino from "pino";
import { KAFKA_TOPICS } from "@nexusai/shared";
import { insertTicks, type MarketTick } from "./clickhouse.js";
import { WindowedZScore } from "./anomaly.js";
import { fireAlert, recentAlerts, alertsRedis } from "./alerts.js";
import { scoreSentiment } from "./sentiment.js";
import { startCryptoStream } from "./sources/crypto.js";
import { startNewsPolling } from "./sources/news.js";
import { startWeatherPolling } from "./sources/weather.js";

const log = pino({
  name: "realtime",
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
});

const kafka = new Kafka({
  clientId: "nexusai-realtime",
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
});
const producer = kafka.producer();

const detectors = new Map<string, WindowedZScore>();
let buffer: MarketTick[] = [];

/**
 * Hot path: ingest tick → (optional sentiment) → anomaly check → Kafka → buffered ClickHouse write.
 * Ticks are buffered to 100/2s to amortize ClickHouse write overhead.
 */
async function handleTick(t: MarketTick) {
  if (t.source === "news" && t.symbol) {
    t.sentiment = await scoreSentiment(t.symbol);
    if (t.sentiment < -0.5) {
      await fireAlert({
        id: crypto.randomUUID(),
        kind: "sentiment",
        symbol: t.symbol.slice(0, 40),
        message: `Negative news sentiment: ${t.sentiment.toFixed(2)}`,
        severity: t.sentiment < -0.8 ? "critical" : "warn",
        value: t.sentiment,
        ts: t.ts,
      });
    }
  }

  if (typeof t.price === "number" && !Number.isNaN(t.price)) {
    let det = detectors.get(`${t.source}:${t.symbol}`);
    if (!det) {
      det = new WindowedZScore(120, 3.0);
      detectors.set(`${t.source}:${t.symbol}`, det);
    }
    const { z, anomaly } = det.observe(t.price);
    if (anomaly) {
      await fireAlert({
        id: crypto.randomUUID(),
        kind: "anomaly",
        symbol: t.symbol,
        message: `${t.source}/${t.symbol} z=${z.toFixed(2)} price=${t.price}`,
        severity: Math.abs(z) >= 5 ? "critical" : "warn",
        value: t.price,
        z,
        ts: t.ts,
      });
    }
  }

  buffer.push(t);
  try {
    await producer.send({
      topic: KAFKA_TOPICS.MARKET_TICK,
      messages: [{ key: `${t.source}:${t.symbol}`, value: JSON.stringify(t) }],
    });
  } catch (err) {
    log.warn({ err }, "kafka publish failed");
  }
}

setInterval(async () => {
  if (!buffer.length) return;
  const rows = buffer;
  buffer = [];
  try {
    await insertTicks(rows);
  } catch (err) {
    log.warn({ err, count: rows.length }, "clickhouse insert failed");
  }
}, 2000);

async function main() {
  await producer.connect();

  const symbols = (process.env.CRYPTO_SYMBOLS ?? "BTCUSDT,ETHUSDT,SOLUSDT").split(",");
  const stopCrypto = startCryptoStream(symbols, (t) => void handleTick(t));
  const stopNews = startNewsPolling((t) => void handleTick(t));
  const stopWeather = startWeatherPolling((t) => void handleTick(t));

  const app = Fastify({ loggerInstance: log });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/alerts/recent", async () => ({ alerts: await recentAlerts(100) }));

  /** WebSocket: live stream of ticks (filter by symbol prefix). */
  app.get<{ Querystring: { symbol?: string } }>("/ws/ticks", { websocket: true }, async (socket, req) => {
    const filter = req.query.symbol?.toUpperCase();
    const sub = alertsRedis.duplicate();
    await sub.subscribe("nexus:alerts");
    sub.on("message", (_ch, msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "alert", ...JSON.parse(msg) }));
    });

    const consumer = kafka.consumer({ groupId: `ws-${crypto.randomUUID()}` });
    await consumer.connect();
    await consumer.subscribe({ topic: KAFKA_TOPICS.MARKET_TICK, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (socket.readyState !== socket.OPEN) return;
        const v = message.value?.toString();
        if (!v) return;
        if (filter && !v.includes(filter)) return;
        socket.send(JSON.stringify({ type: "tick", ...JSON.parse(v) }));
      },
    });

    socket.on("close", async () => {
      await consumer.disconnect().catch(() => {});
      await sub.disconnect();
    });
  });

  const port = Number(process.env.REALTIME_PORT ?? 4200);
  await app.listen({ port, host: "0.0.0.0" });
  log.info({ port }, "realtime service up");

  const shutdown = async () => {
    stopCrypto();
    stopNews();
    stopWeather();
    await producer.disconnect();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.fatal({ err }, "realtime startup failed");
  process.exit(1);
});
