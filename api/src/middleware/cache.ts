import { createMiddleware } from "hono/factory";
import { createHash } from "crypto";

let redis: import("ioredis").Redis | null = null;

function getCacheRedis(): import("ioredis").Redis | null {
  if (redis) return redis;
  try {
    const { Redis } = require("ioredis");
    const r = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
    });
    r.connect().catch(() => { redis = null; });
    redis = r;
    return redis;
  } catch {
    return null;
  }
}

export interface CacheOptions {
  ttl: number;
  keyPrefix?: string;
  methods?: string[];
}

export function cacheResponse(options: CacheOptions) {
  return createMiddleware(async (c, next) => {
    const r = getCacheRedis();
    const method = c.req.method;
    if (options.methods && !options.methods.includes(method)) {
      await next();
      return;
    }

    const url = c.req.url;
    const cacheKey = `${options.keyPrefix || "cache"}:${createHash("md5").update(url).digest("hex")}`;

    if (method === "GET" && r) {
      try {
        const cached = await r.get(cacheKey);
        if (cached) {
          c.header("X-Cache", "HIT");
          return c.json(JSON.parse(cached));
        }
      } catch {
        // Cache read failed; proceed without cache
      }
    }

    await next();

    if (method === "GET" && c.res.status === 200 && r) {
      try {
        const clone = c.res.clone();
        const body = await clone.text();
        await r.setex(cacheKey, options.ttl, body);
        c.header("X-Cache", "MISS");
      } catch {
        // Cache write failed; response already sent
      }
    }
  });
}

export const shortCache = cacheResponse({ ttl: 60, keyPrefix: "short" });
export const mediumCache = cacheResponse({ ttl: 300, keyPrefix: "medium" });
export const longCache = cacheResponse({ ttl: 3600, keyPrefix: "long" });

export async function invalidateCache(prefix: string) {
  const r = getCacheRedis();
  if (!r) return;
  try {
    const keys = await r.keys(`${prefix}:*`);
    if (keys.length > 0) {
      await r.del(keys);
    }
  } catch {
    // Best-effort invalidation
  }
}
