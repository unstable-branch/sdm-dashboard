import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("ioredis", () => {
  class MockRedis {
    on = vi.fn();
    connect = vi.fn(() => Promise.resolve());
  }
  return { default: MockRedis, Redis: MockRedis };
});

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "[EMAIL]", role: "viewer" });
    await next();
  }),
}));

describe("Settings Routes", () => {
  async function setupApp() {
    const { settingsRoutes } = await import("./settings");
    const app = new Hono();
    app.route("/api/v1/settings", settingsRoutes);
    const { db } = await import("../db");
    return { app, db };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("../db", () => ({
      db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    }));
  });

  describe("GET /", () => {
    it("returns user settings", async () => {
      const { app, db } = await setupApp();
      (db as any).select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{
              id: "s1", userId: "user-1", defaultModelId: "glm", theme: "system",
              defaultBiovars: "1,4,6", defaultClimateSource: "worldclim", defaultClimateRes: 10,
              defaultCvStrategy: "random", defaultCvK: 5, defaultBackgroundN: 10000,
              defaultPaReplications: 5, tablePageSize: 50, compactMode: false,
              createdAt: new Date(), updatedAt: new Date(),
            }])),
          })),
        })),
      });

      const res = await app.request("/api/v1/settings");
      expect(res.status).toBe(200);
    });

    it("auto-creates settings if missing", async () => {
      const { app, db } = await setupApp();
      (db as any).select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
        })),
      });
      (db as any).insert.mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: "s-new", userId: "user-1", defaultModelId: "glm" }])),
        })),
      });

      const res = await app.request("/api/v1/settings");
      expect(res.status).toBe(200);
    });
  });

  describe("PUT /", () => {
    it("updates allowed fields", async () => {
      const { app, db } = await setupApp();
      (db as any).select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([{ id: "s1", userId: "user-1" }])) })),
        })),
      });
      (db as any).update.mockReturnValueOnce({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ id: "s1", defaultModelId: "rf", theme: "dark" }])),
          })),
        })),
      });

      const res = await app.request("/api/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultModelId: "rf", theme: "dark" }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 400 for no valid fields", async () => {
      const { app } = await setupApp();
      const res = await app.request("/api/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /", () => {
    it("resets settings to defaults", async () => {
      const { app, db } = await setupApp();
      (db as any).delete.mockReturnValueOnce({ where: vi.fn(() => Promise.resolve()) });
      (db as any).insert.mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: "s-r", userId: "user-1", defaultModelId: "glm", theme: "system" }])),
        })),
      });

      const res = await app.request("/api/v1/settings", { method: "DELETE" });
      expect(res.status).toBe(200);
    });
  });
});
