import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { sdmRoutes } from "./sdm.js";

const mockChain = (result: unknown) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          offset: vi.fn(() => Promise.resolve(result)),
        })),
      })),
    })),
  })),
});

const mockCountChain = (count: number) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => Promise.resolve([{ total: count }])),
  })),
});

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../services/plumber", () => ({
  plumberClient: {
    getModelStatus: vi.fn(),
  },
}));

vi.mock("ioredis", () => ({
  Redis: class MockRedis {
    on = vi.fn();
    connect = vi.fn(() => Promise.resolve());
    zremrangebyscore = vi.fn(() => Promise.resolve(0));
    zcard = vi.fn(() => Promise.resolve(0));
    zadd = vi.fn(() => Promise.resolve(1));
    expire = vi.fn(() => Promise.resolve(1));
  },
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
  optionalAuth: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
}));

vi.mock("../services/access", () => ({
  ensureDefaultProject: vi.fn(async () => "proj-1"),
  getUserProjectIds: vi.fn(async () => ["proj-1"]),
}));

vi.mock("hono/jwt", () => ({
  verify: vi.fn(async () => ({ sub: "user-1", email: "test@example.com", role: "admin" })),
}));

describe("SDM routes", () => {
  const app = new Hono();
  app.route("/api/v1/sdm", sdmRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /runs", () => {
    it("returns paginated runs", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce(mockChain([
          {
            id: "run-1",
            species: "Test species",
            model_id: "glm",
            status: "completed",
            started_at: new Date("2024-01-01"),
            completed_at: new Date("2024-01-01T01:00:00Z"),
            metrics: { auc_mean: 0.85 },
            error: null,
          },
        ]))
        .mockReturnValueOnce(mockCountChain(2));

      const res = await app.request("/api/v1/sdm/runs?page=1&limit=10");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.runs).toBeDefined();
      expect(data.runs).toHaveLength(1);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(10);
    });

    it("uses default pagination when no params", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce(mockChain([]))
        .mockReturnValueOnce(mockCountChain(0));

      const res = await app.request("/api/v1/sdm/runs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(20);
      expect(data.pagination.total).toBe(0);
    });
  });

  describe("GET /status/:jobId", () => {
    it("returns run status with config", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{
              id: "run-1",
              status: "completed",
              speciesName: "Test species",
              modelId: "glm",
              startedAt: new Date("2024-01-01"),
              completedAt: new Date("2024-01-01T01:00:00Z"),
              metrics: { auc_mean: 0.85 },
              outputFiles: { suitability_tif: "outputs/jobs/run-1/suitability.tif" },
              error: null,
              progressLog: ["Started", "Completed"],
              config: { threshold: 0.5, biovars: "1,4,6,12" },
              jobId: null,
            }])),
          })),
        })),
      });

      const res = await app.request("/api/v1/sdm/status/run-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config).toEqual({ threshold: 0.5, biovars: "1,4,6,12" });
    });

    it("returns 404 for missing run", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const res = await app.request("/api/v1/sdm/status/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /batch", () => {
    it("rejects empty configs", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects missing configs array", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /batches/:batchId", () => {
    it("returns aggregate batch status for visible runs", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            {
              id: "run-1",
              species: "Species A",
              model_id: "glm",
              status: "queued",
              started_at: null,
              completed_at: null,
              created_at: new Date("2024-01-01T00:00:00Z"),
              error: null,
            },
            {
              id: "run-2",
              species: "Species B",
              model_id: "rf",
              status: "failed",
              started_at: new Date("2024-01-01T00:10:00Z"),
              completed_at: new Date("2024-01-01T00:20:00Z"),
              created_at: new Date("2024-01-01T00:05:00Z"),
              error: "Plumber failed",
            },
            {
              id: "run-3",
              species: "Species C",
              model_id: "gam",
              status: "completed",
              started_at: new Date("2024-01-01T00:06:00Z"),
              completed_at: new Date("2024-01-01T00:30:00Z"),
              created_at: new Date("2024-01-01T00:06:00Z"),
              error: null,
            },
          ])),
        })),
      });

      const res = await app.request("/api/v1/sdm/batches/batch-123");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.batch_id).toBe("batch-123");
      expect(data.total).toBe(3);
      expect(data.counts_by_status).toEqual({
        queued: 1,
        running: 0,
        completed: 1,
        failed: 1,
        cancelled: 0,
      });
      expect(data.active).toBe(1);
      expect(data.completed).toBe(1);
      expect(data.failed).toBe(1);
      expect(data.cancelled).toBe(0);
      expect(data.runs).toHaveLength(3);
      expect(data.created_at).toBe("2024-01-01T00:00:00.000Z");
      expect(data.started_at).toBe("2024-01-01T00:06:00.000Z");
      expect(data.completed_at).toBeNull();
      expect(data.latest_error).toBe("Plumber failed");
    });

    it("returns 404 when batch is not visible", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      });

      const res = await app.request("/api/v1/sdm/batches/missing-batch");
      expect(res.status).toBe(404);
    });
  });
});
