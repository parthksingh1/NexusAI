import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err) => logger.error({ err }, "redis error"));
redis.on("connect", () => logger.info("redis connected"));

/** Pub/Sub subscriber — separate connection so it can block without impacting commands. */
export const redisSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
