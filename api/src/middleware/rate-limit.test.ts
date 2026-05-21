import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "../middleware/rate-limit";

let callCount = 0;

vi.mock("ioredis", () => ({
  Redis: class MockRedis {
    zremrangebyscore = vi.fn(() => Promise.resolve(0));
    zcard = vi.fn(() => Promise.resolve(callCount));
    zadd = vi.fn(() => {
      callCount++;
      return Promise.resolve(1);
    });
    expire = vi.fn(() => Promise.resolve(1));
  },
}));

describe("rate limiting middleware", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    callCount = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    callCount = 0;
  });

  it("allows requests under limit", async () => {
    app.use("*", rateLimit({ windowMs: 60000, max: 5, keyPrefix: "test" }));
    app.get("/test", (c) => c.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/test");
      expect(res.status).toBe(200);
    }
  });

  it("blocks requests over limit", async () => {
    app.use("*", rateLimit({ windowMs: 60000, max: 2, keyPrefix: "test" }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test");
    expect(res2.status).toBe(200);

    const res3 = await app.request("/test");
    expect(res3.status).toBe(429);
    const data = await res3.json();
    expect(data.error).toBe("Rate limit exceeded");
  });
});
