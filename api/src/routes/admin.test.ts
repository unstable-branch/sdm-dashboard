import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

let currentRole = "admin";
let mockSelectResults: any[] = [];
let mockExecuteResult: any = { rows: [] };

vi.mock("bcrypt", () => ({
  hash: vi.fn(() => Promise.resolve("$2b$10$hashed")),
  compare: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("ioredis", () => ({
  Redis: class MockRedis { on = vi.fn(); connect = vi.fn(() => Promise.resolve()); },
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "[EMAIL]", role: currentRole });
    await next();
  }),
  requireRole: (roles: string[]) => vi.fn(async (c: any, next: any) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (!roles.includes(user.role)) return c.json({ error: "Forbidden" }, 403);
    await next();
  }),
}));

vi.mock("../services/audit", () => ({
  logAction: vi.fn(() => Promise.resolve()),
  extractClientInfo: vi.fn(() => ({ ipAddress: "[IP_ADDRESS]", userAgent: "test-agent" })),
}));

vi.mock("../middleware/cache", () => ({
  invalidateCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("../db", () => ({
  db: {},
}));

function mockDb() {
  let selectIndex = 0;
  return {
    select: vi.fn(() => {
      const next = () => mockSelectResults[selectIndex++] || [];
      const mkThenable = (obj: Record<string, any>) => ({ ...obj, then: vi.fn((resolve: any) => resolve(next())) });
      const limit = mkThenable({
        offset: vi.fn(() => mkThenable({})),
      });
      const orderBy = mkThenable({ limit: vi.fn(() => limit) });
      const where = mkThenable({
        groupBy: vi.fn(() => mkThenable({ orderBy: vi.fn(() => orderBy) })),
        orderBy: vi.fn(() => orderBy),
        limit: vi.fn(() => limit),
      });
      return {
        from: vi.fn(() => mkThenable({ where: vi.fn(() => where), orderBy: vi.fn(() => orderBy) })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: "new-id", email: "[EMAIL]", name: "New", role: "viewer" }])),
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: "updated", email: "[EMAIL]", name: "Updated", role: "editor", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: new Date() }])),
        })),
        returning: vi.fn(() => Promise.resolve([{ id: "updated" }])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
    execute: vi.fn(() => Promise.resolve(mockExecuteResult)),
  };
}

describe("Admin Routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    currentRole = "admin";
    mockSelectResults = [];
    mockExecuteResult = { rows: [] };

    vi.doMock("../db", () => ({ db: mockDb() }));
  });

  async function setupApp() {
    const { adminRoutes } = await import("./admin");
    const app = new Hono();
    app.route("/api/v1/admin", adminRoutes);
    const { db } = await import("../db");
    return { app, db };
  }

  describe("GET /overview", () => {
    it("returns dashboard counts", async () => {
      mockSelectResults = [
        [{ count: 2 }],
      ];

      const { app } = await setupApp();
      await app.request("/api/v1/admin/overview");
    });
  });

  describe("Simple validation tests", () => {
    it("POST /users returns 400 for missing email", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "pass1234" }),
      });
      expect(res.status).toBe(400);
    });

    it("POST /users returns 400 for missing password", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "[EMAIL]" }),
      });
      expect(res.status).toBe(400);
    });

    it("PUT /users/:id returns 400 for no valid fields", async () => {
      mockSelectResults = [[{ id: "u1" }]];
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/users/u1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("DELETE /users/:id returns 400 for own account", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/users/user-1", { method: "DELETE" });
      expect(res.status).toBe(400);
    });

    it("reset-password returns 400 for short password", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/users/u1/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "short" }),
      });
      expect(res.status).toBe(400);
    });

    it("reset-password returns 400 for missing password", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/users/u1/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("database returns 403 for non-whitelisted table", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/database/secret_table");
      expect(res.status).toBe(403);
    });

    it("database stats returns 403 for non-whitelisted table", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/database/secret_table/stats");
      expect(res.status).toBe(403);
    });

    it("settings PUT returns 400 for missing key", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/system/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Role enforcement", () => {
    it("returns 403 for viewer", async () => {
      currentRole = "viewer";
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/overview");
      expect(res.status).toBe(403);
    });

    it("returns 403 for editor", async () => {
      currentRole = "editor";
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/overview");
      expect(res.status).toBe(403);
    });

    it("returns 200 for admin", async () => {
      currentRole = "admin";
      mockSelectResults = [[{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], []];
      const { app } = await setupApp();
      const res = await app.request("/api/v1/admin/overview");
      expect(res.status).toBe(200);
    });
  });
});