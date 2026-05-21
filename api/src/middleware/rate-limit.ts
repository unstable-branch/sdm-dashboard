import { createMiddleware } from "hono/factory";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const key = `${options.keyPrefix || "rl"}:${c.req.url}`;
    const now = Date.now();
    const windowStart = now - options.windowMs;

    await redis.zremrangebyscore(key, 0, windowStart);

    const count = await redis.zcard(key);

    if (count >= options.max) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    await redis.zadd(key, now, `${now}-${Math.random()}`);
    await redis.expire(key, Math.ceil(options.windowMs / 1000));

    await next();
  });
}

export const gbifRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "gbif" });
export const climateRateLimit = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: "climate" });
export const modelRateLimit = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "model" });
export const defaultRateLimit = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "default" });
