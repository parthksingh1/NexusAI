import pino from "pino";
import type { MarketTick } from "../clickhouse.js";

const log = pino({ name: "source-weather" });

type City = { name: string; lat: number; lon: number };

const DEFAULT_CITIES: City[] = [
  { name: "NYC", lat: 40.71, lon: -74.01 },
  { name: "SFO", lat: 37.77, lon: -122.42 },
  { name: "LON", lat: 51.51, lon: -0.13 },
  { name: "TYO", lat: 35.68, lon: 139.69 },
];

/**
 * Uses open-meteo (no key needed). Polls each city every 5 minutes.
 * Emits temperature as `price`, wind as `volume`.
 */
export function startWeatherPolling(onTick: (t: MarketTick) => void, cities: City[] = DEFAULT_CITIES): () => void {
  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (closed) return;
    for (const city of cities) {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current_weather=true`,
        );
        const d = await r.json();
        const cw = d.current_weather;
        if (!cw) continue;
        onTick({
          ts: new Date(cw.time).toISOString().replace("T", " ").slice(0, 23),
          symbol: city.name,
          source: "weather",
          price: cw.temperature,
          volume: cw.windspeed,
          sentiment: 0,
        });
      } catch (err) {
        log.warn({ err: (err as Error).message, city: city.name }, "weather fetch failed");
      }
    }
    if (!closed) timer = setTimeout(tick, 300_000);
  };

  void tick();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
