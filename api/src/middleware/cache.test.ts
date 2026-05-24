import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("ioredis", () => ({
  default: class MockRedis {
    private store = new Map<string, string>();

    get = vi.fn((key: string) => Promise.resolve(this.store.get(key) || null));
    setex = vi.fn((key: string, ttl: number, value: string) => {
      this.store.set(key, value);
      return Promise.resolve("OK");
    });
    keys = vi.fn((pattern: string) => {
      const prefix = pattern.replace(":*", "");
      return Promise.resolve([...this.store.keys()].filter((k) => k.startsWith(prefix)));
    });
    del = vi.fn((keys: string[]) => {
      keys.forEach((k) => this.store.delete(k));
      return Promise.resolve(keys.length);
    });
    on = vi.fn(() => {});
    connect = vi.fn(() => Promise.resolve());
  },
}));

describe("cache middleware", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.resetModules();
    app = new Hono();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("caches GET responses", async () => {
    const { cacheResponse } = await import("../middleware/cache.js");
    let callCount = 0;
    app.use("/cached", cacheResponse({ ttl: 60, keyPrefix: "test" }));
    app.get("/cached", (c) => {
      callCount++;
      return c.json({ data: "value", count: callCount });
    });

    const res1 = await app.request("/cached");
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-Cache")).toBe("MISS");

    const res2 = await app.request("/cached");
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-Cache")).toBe("HIT");
  });

  it("does not cache POST requests", async () => {
    const { cacheResponse } = await import("../middleware/cache.js");
    let callCount = 0;
    app.use("/api", cacheResponse({ ttl: 60, keyPrefix: "test" }));
    app.post("/api", (c) => {
      callCount++;
      return c.json({ count: callCount });
    });

    await app.request("/api", { method: "POST" });
    await app.request("/api", { method: "POST" });

    expect(callCount).toBe(2);
  });

  it("respects method filter", async () => {
    const { cacheResponse } = await import("../middleware/cache.js");
    let callCount = 0;
    app.use("/filtered", cacheResponse({ ttl: 60, keyPrefix: "test", methods: ["GET"] }));
    app.get("/filtered", (c) => {
      callCount++;
      return c.json({ count: callCount });
    });

    await app.request("/filtered");
    await app.request("/filtered");

    expect(callCount).toBe(1);
  });
});
