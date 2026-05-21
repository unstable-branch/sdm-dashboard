import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { sdmRoutes } from "./sdm";

const mockChain = (result: unknown) => ({
  from: vi.fn(() => ({
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({
        offset: vi.fn(() => Promise.resolve(result)),
      })),
    })),
  })),
});

const mockCountChain = (count: number) => ({
  from: vi.fn(() => Promise.resolve([{ count }])),
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
});
