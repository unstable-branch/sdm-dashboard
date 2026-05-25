import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { resultsRoutes } from "./results.js";

const fetchMock = vi.fn();

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
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("GET /:id/manifest normalizes Plumber manifests", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          manifest_path: "/app/outputs/jobs/run-123/manifest.json",
          manifest: {
            run_id: "run-123",
            generated_at: "2026-05-26T00:00:00Z",
            species: "Test species",
            model: { id: "glm", parameters: { seed: 123 } },
            metrics: { auc_mean: 0.85 },
            output_files: {
              suitability_tif: "outputs/jobs/run-123/suitability.tif",
            },
          },
        }),
    });

    const res = await app.request("/api/v1/results/run-123/manifest");

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.schema_version).toBe("run_manifest.v1");
    expect(data.manifest_path).toBe("/app/outputs/jobs/run-123/manifest.json");
    expect(data.manifest.run_id).toBe("run-123");
    expect(data.manifest.model.id).toBe("glm");
    expect(data.manifest.artifacts).toEqual([
      {
        key: "suitability_tif",
        path: "outputs/jobs/run-123/suitability.tif",
        kind: "raster",
        media_type: "image/tiff",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/output/manifest/run-123",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Forwarded-User": "user-1" }),
      }),
    );
  });

  it("GET /:id/manifest returns upstream non-ok responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Run not found" }),
    });

    const res = await app.request("/api/v1/results/run-123/manifest");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Run not found" });
  });

  it("GET /:id/manifest rejects missing manifest objects", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    const res = await app.request("/api/v1/results/run-123/manifest");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Malformed manifest response: missing manifest object" });
  });

  it("GET /:id/manifest reports fetch failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const res = await app.request("/api/v1/results/run-123/manifest");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "network down" });
  });
});
