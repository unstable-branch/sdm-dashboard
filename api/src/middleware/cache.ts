import { createMiddleware } from "hono/factory";
import { Redis } from "ioredis";
import { createHash } from "crypto";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export interface CacheOptions {
  ttl: number;
  keyPrefix?: string;
  methods?: string[];
}

export function cacheResponse(options: CacheOptions) {
  return createMiddleware(async (c, next) => {
    const method = c.req.method;
    if (options.methods && !options.methods.includes(method)) {
      await next();
      return;
    }

    const url = c.req.url;
    const cacheKey = `${options.keyPrefix || "cache"}:${createHash("md5").update(url).digest("hex")}`;

    if (method === "GET") {
      const cached = await redis.get(cacheKey);
      if (cached) {
        c.header("X-Cache", "HIT");
        return c.json(JSON.parse(cached));
      }
    }

    await next();

    if (method === "GET" && c.res.status === 200) {
      const clone = c.res.clone();
      const body = await clone.text();
      await redis.setex(cacheKey, options.ttl, body);
      c.header("X-Cache", "MISS");
    }
  });
}

export const shortCache = cacheResponse({ ttl: 60, keyPrefix: "short" });
export const mediumCache = cacheResponse({ ttl: 300, keyPrefix: "medium" });
export const longCache = cacheResponse({ ttl: 3600, keyPrefix: "long" });

export async function invalidateCache(prefix: string) {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) {
    await redis.del(keys);
  }
}
