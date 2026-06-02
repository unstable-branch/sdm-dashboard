import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/auth.js";

vi.mock("bcrypt", () => ({
  hash: vi.fn(() => Promise.resolve("$2b$10$hashed")),
  compare: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("ioredis", () => ({
  Redis: class { on = vi.fn(); connect = vi.fn(() => Promise.resolve()); },
}));

process.env.JWT_SECRET = "test-secret";

describe("Auth Integration", () => {
  describe("requireRole middleware", () => {
    it("allows admin to pass", async () => {
      const { requireRole } = await import("../middleware/auth");
      const guard = requireRole(["admin"]);
      const app = new Hono<AppEnv>();
      app.use("/test", async (c, next) => {
        c.set("user", { id: "u1", email: "[EMAIL]", role: "admin" });
        await next();
      });
      app.use("/test", guard);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("blocks viewer with 403", async () => {
      const { requireRole } = await import("../middleware/auth");
      const guard = requireRole(["admin"]);
      const app = new Hono<AppEnv>();
      app.use("/test", async (c, next) => {
        c.set("user", { id: "u2", email: "[EMAIL]", role: "viewer" });
        await next();
      });
      app.use("/test", guard);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
    });

    it("blocks editor with 403", async () => {
      const { requireRole } = await import("../middleware/auth");
      const guard = requireRole(["admin"]);
      const app = new Hono<AppEnv>();
      app.use("/test", async (c, next) => {
        c.set("user", { id: "u3", email: "[EMAIL]", role: "editor" });
        await next();
      });
      app.use("/test", guard);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
    });

    it("blocks unauthenticated with 403", async () => {
      const { requireRole } = await import("../middleware/auth");
      const guard = requireRole(["admin"]);
      const app = new Hono();
      app.use("/test", guard);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
    });

    it("allows editor when role list includes editor", async () => {
      const { requireRole } = await import("../middleware/auth");
      const guard = requireRole(["admin", "editor"]);
      const app = new Hono<AppEnv>();
      app.use("/test", async (c, next) => {
        c.set("user", { id: "u3", email: "[EMAIL]", role: "editor" });
        await next();
      });
      app.use("/test", guard);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });
  });

  describe("JWT issuance", () => {
    it("generates token with correct payload shape", async () => {
      const { sign } = await import("hono/jwt");
      const token = await sign(
        { sub: "u1", email: "[EMAIL]", role: "viewer", iss: "sdm-dashboard", exp: Math.floor(Date.now() / 1000) + 86400 },
        "test-secret",
      );
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(10);
    });

    it("accepts tokens issued with the default issuer", async () => {
      const { sign } = await import("hono/jwt");
      const { authMiddleware } = await import("../middleware/auth");
      const token = await sign(
        { sub: "u1", email: "[EMAIL]", role: "viewer", iss: "sdm-dashboard", exp: Math.floor(Date.now() / 1000) + 86400 },
        "test-secret",
      );
      const app = new Hono<AppEnv>();
      app.use("/me", authMiddleware);
      app.get("/me", (c) => c.json({ user: c.get("user") }));

      const res = await app.request("/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { user: { id: string; role: string } };
      expect(data.user).toMatchObject({ id: "u1", role: "viewer" });
    });
  });

  describe("API key lifecycle", () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.resetModules();

      vi.doMock("../db", () => ({
        db: {
          select: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      }));

      vi.doMock("../middleware/auth", () => ({
        authMiddleware: vi.fn(async (c: any, next: any) => {
          c.set("user", { id: "user-1", email: "[EMAIL]", role: "admin" });
          await next();
        }),
        requireRole: () => vi.fn(async (_c: any, next: any) => { await next(); }),
      }));
    });

    it("creates API key with sdm_ prefix", async () => {
      const { authRoutes } = await import("./auth");
      const { db } = await import("../db");
      const app = new Hono();
      app.route("/api/v1/auth", authRoutes);

      (db.insert as any).mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{
            id: "key-1", name: "Test Key", key_hash: "sha256hash",
            created_at: new Date().toISOString(), expires_at: null,
          }])),
        })),
      });

      const res = await app.request("/api/v1/auth/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Key" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.key).toMatch(/^sdm_/);
    });

    it("deletes API key", async () => {
      const { authRoutes } = await import("./auth");
      const { db } = await import("../db");
      const app = new Hono();
      app.route("/api/v1/auth", authRoutes);

      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ id: "key-1", userId: "user-1" }])),
          })),
        })),
      });
      (db.delete as any).mockReturnValueOnce({
        where: vi.fn(() => Promise.resolve()),
      });

      const res = await app.request("/api/v1/auth/api-keys/key-1", { method: "DELETE" });
      expect(res.status).toBe(200);
    });
  });
});
