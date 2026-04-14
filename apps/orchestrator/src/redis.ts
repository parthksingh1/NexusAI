import IORedis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

// `ioredis` is published as CommonJS with a default export. Under strict ESM interop
// the default can resolve to the module namespace rather than the Redis class, so we
// alias + cast to the constructor type.
const Redis = IORedis as unknown as typeof import("ioredis").Redis;

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err: Error) => logger.error({ err }, "redis error"));
redis.on("connect", () => logger.info("redis connected"));

/** Pub/Sub subscriber — separate connection so it can block without impacting commands. */
export const redisSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
