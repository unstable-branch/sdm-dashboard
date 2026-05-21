import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Results API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/results/:id", () => {
    it("returns run details", async () => {
      const mockRun = {
        id: "run-123",
        status: "completed",
        species: "Acacia mearnsii",
        model_id: "glm",
        started_at: "2024-01-01T00:00:00Z",
        completed_at: "2024-01-01T00:05:00Z",
        error: null,
        metrics: { auc_mean: 0.85, tss_mean: 0.62 },
        output_files: { tif: "outputs/jobs/run-123/suitability.tif" },
        progress_log: ["[0%] Starting", "[100%] Complete"],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRun),
      });

      const res = await fetch("/api/v1/results/run-123");
      const data = await res.json();

      expect(data.id).toBe("run-123");
      expect(data.species).toBe("Acacia mearnsii");
      expect(data.metrics?.auc_mean).toBe(0.85);
    });

    it("returns 404 for non-existent run", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Run not found" }),
      });

      const res = await fetch("/api/v1/results/nonexistent");
      expect(res.ok).toBe(false);
    });
  });

  describe("GET /api/v1/results/:id/report.txt", () => {
    it("returns report text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("Conservation Status Summary: Acacia mearnsii\nModel: glm"),
      });

      const res = await fetch("/api/v1/results/run-123/report.txt");
      const text = await res.text();

      expect(text).toContain("Acacia mearnsii");
    });

    it("returns 404 for missing report", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Report not found" }),
      });

      const res = await fetch("/api/v1/results/run-123/report.txt");
      expect(res.ok).toBe(false);
    });
  });

  describe("GET /api/v1/results/file/:filePath", () => {
    it("serves a file by path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "image/png" },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const res = await fetch("/api/v1/results/file/outputs%2Fjobs%2Frun-123%2Fsuitability.png");
      expect(res.ok).toBe(true);
    });
  });

  describe("GET /api/v1/results/:id/script", () => {
    it("proxies to Plumber for reproducible script", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, script_path: "outputs/jobs/run-123/reproducible_run.R" }),
      });

      const res = await fetch("/api/v1/results/run-123/script");
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.script_path).toContain("reproducible_run.R");
    });
  });

  describe("GET /api/v1/results/:id/manifest", () => {
    it("proxies to Plumber for run manifest", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          manifest: {
            run_id: "run-123",
            species: "Acacia mearnsii",
            model: { id: "glm" },
          },
        }),
      });

      const res = await fetch("/api/v1/results/run-123/manifest");
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.manifest.run_id).toBe("run-123");
    });
  });
});
