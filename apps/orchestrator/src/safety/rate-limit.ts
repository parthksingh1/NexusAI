import { redis } from "../redis.js";
import { RateLimitError } from "@nexusai/shared";

/** Simple sliding-window rate limiter in Redis. Limits per (userId, bucket). */
export async function rateLimit(userId: string, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const key = `rl:${userId}:${bucket}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const pipe = redis.multi();
  pipe.zremrangebyscore(key, 0, windowStart);
  pipe.zadd(key, now, `${now}-${Math.random()}`);
  pipe.zcard(key);
  pipe.expire(key, windowSeconds + 5);
  const results = await pipe.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;
  if (count > limit) {
    const oldest = (await redis.zrange(key, 0, 0, "WITHSCORES"))[1];
    const retryAfter = oldest ? Math.max(1, Math.ceil((Number(oldest) + windowSeconds * 1000 - now) / 1000)) : windowSeconds;
    throw new RateLimitError(retryAfter);
  }
}
