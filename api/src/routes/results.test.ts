import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { resultsRoutes } from "./results.js";

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => [{
            id: "run-123",
            status: "completed",
            speciesName: "Test species",
            modelId: "glm",
            startedAt: new Date("2024-01-01"),
            completedAt: new Date("2024-01-01T01:00:00Z"),
            metrics: { auc_mean: 0.85, tss_mean: 0.7 },
            outputFiles: { suitability_tif: "outputs/jobs/run-123/suitability.tif" },
            error: null,
            progressLog: ["Run started", "Run completed"],
            config: { threshold: 0.5, biovars: "1,4,6,12" },
          }]),
        })),
      })),
    })),
  },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn((path: string) => !path.includes("..")),
  readFileSync: vi.fn(() => "test content"),
  createReadStream: vi.fn(() => {
    const { Readable } = require("stream");
    return Readable.from(["test content"]);
  }),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(() => Promise.resolve({ size: 1024, mtimeMs: 123456789 })),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    await next();
  }),
}));

describe("results routes", () => {
  const app = new Hono();
  app.route("/api/v1/results", resultsRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /:id returns run data", async () => {
    const res = await app.request("/api/v1/results/run-123");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("run-123");
    expect(data.species).toBe("Test species");
    expect(data.status).toBe("completed");
    expect(data.metrics).toEqual({ auc_mean: 0.85, tss_mean: 0.7 });
  });

  it("GET /:id returns 404 for missing run", async () => {
    const { db } = await import("../db");
    (db.select as any).mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    });

    const res = await app.request("/api/v1/results/nonexistent");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Run not found");
  });

  it("GET /file/:filePath blocks path traversal", async () => {
    const res = await app.request("/api/v1/results/file/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid file path");
  });

  it("GET /file/:filePath serves valid files", async () => {
    const res = await app.request("/api/v1/results/file/outputs%2Fjobs%2Frun-123%2Fsuitability.tif");
    expect(res.status).toBe(200);
  });
});
