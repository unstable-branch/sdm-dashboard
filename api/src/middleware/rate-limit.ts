import { createMiddleware } from "hono/factory";
import type { Redis } from "ioredis";
import { getSharedRedis } from "../services/queue.js";

let redisAvailable = false;

// In-memory fallback rate limiter for when Redis is unavailable
const memoryStore = new Map<string, { timestamps: number[] }>();
const MEMORY_CLEANUP_INTERVAL = 60_000;
let lastMemoryCleanup = Date.now();

function checkMemoryRateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  if (now - lastMemoryCleanup > MEMORY_CLEANUP_INTERVAL) {
    for (const [k, v] of memoryStore) {
      v.timestamps = v.timestamps.filter(t => now - t < windowMs);
      if (v.timestamps.length === 0) memoryStore.delete(k);
    }
    lastMemoryCleanup = now;
  }
  let entry = memoryStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    memoryStore.set(key, entry);
  }
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
  if (entry.timestamps.length >= max) return false;
  entry.timestamps.push(now);
  return true;
}

function getRedis(): Redis | null {
  const shared = getSharedRedis();
  if (shared) {
    redisAvailable = shared.status === "ready";
    return shared;
  }
  redisAvailable = false;
  return null;
}

async function redisZremrangebyscore(key: string, min: number, max: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try { await r.zremrangebyscore(key, min, max); } catch { /* skip */ }
}

async function redisZcard(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try { return await r.zcard(key); } catch { return 0; }
}

async function redisZadd(key: string, score: number, member: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try { await r.zadd(key, score, member); } catch { /* skip */ }
}

async function redisExpire(key: string, seconds: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try { await r.expire(key, seconds); } catch { /* skip */ }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || c.req.header("cf-connecting-ip") || "unknown";
    const key = `${options.keyPrefix || "rl"}:${ip}`;
    const r = getRedis();

    if (r) {
      const now = Date.now();
      const windowStart = now - options.windowMs;
      await redisZremrangebyscore(key, 0, windowStart);
      const count = await redisZcard(key);
      if (count >= options.max) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }
      await redisZadd(key, now, `${now}-${Math.random()}`);
      await redisExpire(key, Math.ceil(options.windowMs / 1000));
    } else {
      if (!checkMemoryRateLimit(key, options.windowMs, options.max)) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }
    }

    await next();
  });
}

export const gbifRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "gbif" });
export const climateRateLimit = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "climate" });
export const modelRateLimit = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "model" });
export const defaultRateLimit = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "default" });
export const authRateLimit = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "auth" });

/**
 * Check rate limit for a given key (e.g., IP address for auth failures).
 * Returns true if the request is allowed, false if rate limited.
 */
export async function checkRateLimit(key: string, windowMs: number, max: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return checkMemoryRateLimit(key, windowMs, max);

  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    await r.zremrangebyscore(key, 0, windowStart);
    const count = await r.zcard(key);
    if (count >= max) return false;
    await r.zadd(key, now, `${now}-${Math.random()}`);
    await r.expire(key, Math.ceil(windowMs / 1000));
    return true;
  } catch {
    return checkMemoryRateLimit(key, windowMs, max);
  }
}

export function closeRateLimitRedis(): void {
  redisAvailable = false;
  // Redis connection is shared via queue.ts — shutdownQueue handles closure
}
