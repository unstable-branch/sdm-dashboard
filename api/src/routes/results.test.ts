import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { Readable } from "stream";
import { resultsRoutes } from "./results.js";

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => [{
            id: "550e8400-e29b-41d4-a716-446655440000",
            status: "completed",
            speciesName: "Test species",
            modelId: "glm",
            startedAt: new Date("2024-01-01"),
            completedAt: new Date("2024-01-01T01:00:00Z"),
            metrics: { auc_mean: 0.85, tss_mean: 0.7 },
            outputFiles: { suitability_tif: "outputs/jobs/run-123/suitability.tif" },
            jobId: "run-123",
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
  existsSync: vi.fn((path: string) => !path.includes("..") && !path.endsWith(".enc")),
  readFileSync: vi.fn(() => "test content"),
  createReadStream: vi.fn(() => Readable.from([])),
  readdirSync: vi.fn(() => ["Test_species_20260713_120000_suitability.tif", "Test_species_20260713_120000_report.txt"]),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(() => Promise.resolve({ size: 1024, mtimeMs: 123456789 })),
  readFile: vi.fn(() => Promise.resolve(Buffer.from("test content"))),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    await next();
  }),
}));

vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    withUser: vi.fn(() => ({
      getTileCog: vi.fn(),
    })),
  },
}));

describe("results routes", () => {
  const app = new Hono();
  app.route("/api/v1/results", resultsRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /:id returns run data", async () => {
    const runUuid = "550e8400-e29b-41d4-a716-446655440000";
    const res = await app.request(`/api/v1/results/${runUuid}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(runUuid);
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

  it("GET /:id discovers completed artifacts when outputFiles is blank", async () => {
    const { db } = await import("../db");
    (db.select as any).mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => [{
            id: "run-123",
            status: "completed",
            speciesName: "Test species",
            modelId: "dnn",
            startedAt: new Date("2026-01-01"),
            completedAt: new Date("2026-01-01T00:01:00Z"),
            metrics: {},
            outputFiles: {},
            jobId: "plumber-job-123",
            provenance: null,
            error: null,
          }]),
        })),
      })),
    });

    const res = await app.request("/api/v1/results/run-123");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.output_files.report).toContain("plumber-job-123/Test_species_20260713_120000_report.txt");
    expect(data.output_files.tif).toContain("plumber-job-123/Test_species_20260713_120000_suitability.tif");
  });

  it("GET /:id/report.txt discovers the suffixed report in the Plumber job directory", async () => {
    const res = await app.request("/api/v1/results/run-123/report.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("test content");
  });

  it("GET /:id/report.txt retains compatibility with legacy report.txt artifacts", async () => {
    const fs = await import("fs");
    (fs.readdirSync as any).mockReturnValueOnce(["report.txt"]);

    const res = await app.request("/api/v1/results/run-123/report.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("test content");
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

  describe("discoverOutputFiles EOO/AOO coverage", () => {
    it("GET /:id discovers eoo_polygon / aoo_grid / eoo_aoo_json when outputFiles is blank", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => [{
              id: "run-123",
              status: "completed",
              speciesName: "Test species",
              modelId: "glm",
              startedAt: new Date("2026-01-01"),
              completedAt: new Date("2026-01-01T00:01:00Z"),
              metrics: {},
              outputFiles: {},
              jobId: "plumber-job-123",
              provenance: null,
              error: null,
            }]),
          })),
        })),
      });
      const fs = await import("fs");
      (fs.readdirSync as any).mockReturnValueOnce([
        "Test_species_20260713_120000_suitability.tif",
        "Test_species_20260713_120000_report.txt",
        "odmap_report.md",
        "odmap_report.csv",
        "eoo_polygon.geojson",
        "aoo_grid.geojson",
        "eoo_aoo.json",
        "niche_overlap.json",
        "result.rds",
      ]);

      const res = await app.request("/api/v1/results/run-123");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.output_files).not.toBeNull();
      expect(data.output_files.eoo_polygon).toContain("eoo_polygon.geojson");
      expect(data.output_files.aoo_grid).toContain("aoo_grid.geojson");
      expect(data.output_files.eoo_aoo_json).toContain("eoo_aoo.json");
      expect(data.output_files.niche_overlap).toContain("niche_overlap.json");
      expect(data.output_files.odmap_report_md).toContain("odmap_report.md");
      expect(data.output_files.odmap_report_csv).toContain("odmap_report.csv");
      expect(data.output_files.report).toContain("_report.txt");
      expect(data.output_files.tif).toContain("_suitability.tif");
    });

    it("GET /file/:filePath serves eoo_polygon.geojson after discovery fallback", async () => {
      const { db } = await import("../db");
      const eooRecord = [{
        id: "run-123",
        status: "completed",
        speciesName: "Test species",
        modelId: "glm",
        startedAt: new Date("2026-01-01"),
        completedAt: new Date("2026-01-01T00:01:00Z"),
        metrics: {},
        outputFiles: {},
        jobId: "run-123",
        provenance: null,
        error: null,
      }];
      // Both canAccessRun and serveFileFromPath select from runs; mock impl so every call returns the same row.
      (db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => eooRecord),
          })),
        })),
      }));
      const fs = await import("fs");
      (fs.readdirSync as any).mockReturnValueOnce([
        "eoo_polygon.geojson",
        "aoo_grid.geojson",
        "Test_species_20260713_120000_suitability.tif",
      ]);
      const res = await app.request(
        "/api/v1/results/file/outputs%2Fjobs%2Frun-123%2Feoo_polygon.geojson",
      );
      expect(res.status).toBe(200);
    });

    it("GET /file/:filePath serves aoo_grid.geojson after discovery fallback", async () => {
      const { db } = await import("../db");
      const aooRecord = [{
        id: "run-123",
        status: "completed",
        speciesName: "Test species",
        modelId: "glm",
        startedAt: new Date("2026-01-01"),
        completedAt: new Date("2026-01-01T00:01:00Z"),
        metrics: {},
        outputFiles: {},
        jobId: "run-123",
        provenance: null,
        error: null,
      }];
      (db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => aooRecord),
          })),
        })),
      }));
      const fs = await import("fs");
      (fs.readdirSync as any).mockReturnValueOnce([
        "aoo_grid.geojson",
        "Test_species_20260713_120000_suitability.tif",
      ]);
      const res = await app.request(
        "/api/v1/results/file/outputs%2Fjobs%2Frun-123%2Faoo_grid.geojson",
      );
      expect(res.status).toBe(200);
    });
  });
  describe("on-demand tile fallback", () => {
    const tileFixture = {
      id: "tile-run",
      status: "completed",
      speciesName: "Test species",
      modelId: "glm",
      startedAt: new Date("2026-01-01"),
      completedAt: new Date("2026-01-01T00:01:00Z"),
      metrics: {},
      outputFiles: {},
      jobId: "plumber-job-tile",
      provenance: null,
      error: null,
    };
    const tileApp = new Hono();
    tileApp.route("/api/v1/results", resultsRoutes);

    async function setupRunLookup() {
      const { db } = await import("../db");
      (db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => [tileFixture]),
          })),
        })),
      }));
    }
    async function mockPlumberTile(handler: (z: string, x: string, y: string, band: string) => Promise<Response>) {
      const { plumberClient } = await import("../services/plumber.js");
      const getTileCog = vi.fn((_jobId: string, z: string, x: string, y: string, band: string) => handler(z, x, y, band));
      (plumberClient.withUser as any).mockReturnValue({ getTileCog });
      return getTileCog;
    }
    async function disableMapTiles() {
      const fs = await import("fs");
      (fs.existsSync as any).mockImplementation(() => false);
    }

    it("transparently serves Plumber 204 (no raster coverage) to the client", async () => {
      await setupRunLookup();
      await mockPlumberTile(async () => new Response(null, { status: 204 }));
      await disableMapTiles();
      const res = await tileApp.request(
        "/api/v1/results/tiles/tile-run/2/3/3?band=suitability",
      );
      expect(res.status).toBe(204);
    });

    it("forwards Plumber 200 PNG (and ETag) to the client", async () => {
      await setupRunLookup();
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await mockPlumberTile(async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
      await disableMapTiles();
      const res = await tileApp.request(
        "/api/v1/results/tiles/tile-run/2/3/3?band=suitability",
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const out = Buffer.from(await res.arrayBuffer());
      expect(out.equals(png)).toBe(true);
    });

    it("returns 502 with upstream_status when Plumber responds 500 — no silent 204", async () => {
      await setupRunLookup();
      await mockPlumberTile(async () =>
        new Response(JSON.stringify({ error: "raster not found" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
      await disableMapTiles();
      const res = await tileApp.request(
        "/api/v1/results/tiles/tile-run/2/3/3?band=suitability",
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.source).toBe("plumber");
      expect(body.upstream_status).toBe(500);
      expect(body.upstream_hint).toContain("raster not found");
      expect(body.run_id).toBe("tile-run");
    });

    it("returns 502 with upstream_status when Plumber responds 403 (ownership)", async () => {
      await setupRunLookup();
      await mockPlumberTile(async () =>
        new Response(JSON.stringify({ error: "ACCESS_DENIED" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      );
      await disableMapTiles();
      const res = await tileApp.request(
        "/api/v1/results/tiles/tile-run/2/3/3?band=suitability",
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.source).toBe("plumber");
      expect(body.upstream_status).toBe(403);
    });

    it("returns 502 with diagnostic when Plumber throws (network/unreachable)", async () => {
      await setupRunLookup();
      await mockPlumberTile(async () => { throw new Error("ECONNREFUSED"); });
      await disableMapTiles();
      const res = await tileApp.request(
        "/api/v1/results/tiles/tile-run/2/3/3?band=suitability",
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.source).toBe("plumber");
      expect(body.upstream_status).toBe(0);
      expect(body.upstream_hint).toContain("ECONNREFUSED");
    });

    it("still returns 204 when run has no Plumber job id (no upstream to call)", async () => {
      const { db } = await import("../db");
      (db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => [{
              id: "tile-run",
              status: "completed",
              speciesName: "Test species",
              modelId: "glm",
              startedAt: new Date("2026-01-01"),
              completedAt: new Date("2026-01-01T00:01:00Z"),
              metrics: {},
              outputFiles: {},
              jobId: null,
              provenance: null,
              error: null,
            }]),
          })),
        })),
      }));
      await disableMapTiles();
      const res = await tileApp.request(
        "/api/v1/results/tiles/tile-run/2/3/3?band=suitability",
      );
      expect(res.status).toBe(204);
    });
  });
});
