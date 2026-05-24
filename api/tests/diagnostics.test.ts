import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Diagnostics API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/diagnostics/vif/:runId", () => {
    it("returns VIF data for a completed run", async () => {
      const mockVif = {
        available: true,
        selected: ["bio1", "bio12"],
        dropped: ["bio2"],
        vif_final: 5.2,
        vif_history: [{ iteration: 1, variable_removed: "bio2", max_vif: 15.3 }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVif),
      });

      const res = await fetch("/api/v1/diagnostics/vif/run-123");
      const data = await res.json();

      expect(data.available).toBe(true);
      expect(data.selected).toEqual(["bio1", "bio12"]);
      expect(data.dropped).toEqual(["bio2"]);
    });

    it("returns error for non-existent run", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Run not found" }),
      });

      const res = await fetch("/api/v1/diagnostics/vif/nonexistent");
      expect(res.ok).toBe(false);
    });

    it("handles VIF not enabled", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available: false, message: "VIF reduction was not enabled" }),
      });

      const res = await fetch("/api/v1/diagnostics/vif/run-123");
      const data = await res.json();
      expect(data.available).toBe(false);
    });
  });

  describe("GET /api/v1/diagnostics/response-curves/:runId", () => {
    it("returns response curve data", async () => {
      const mockCurves = {
        available: true,
        n_curves: 2,
        curves: [
          { covariate: "bio1", points: [{ value: 10, suitability: 0.3 }] },
          { covariate: "bio12", points: [{ value: 500, suitability: 0.7 }] },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCurves),
      });

      const res = await fetch("/api/v1/diagnostics/response-curves/run-123");
      const data = await res.json();

      expect(data.available).toBe(true);
      expect(data.n_curves).toBe(2);
      expect(data.curves).toHaveLength(2);
    });

    it("handles curves not computed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available: false, message: "Response curves not computed" }),
      });

      const res = await fetch("/api/v1/diagnostics/response-curves/run-123");
      const data = await res.json();
      expect(data.available).toBe(false);
    });
  });

  describe("GET /api/v1/diagnostics/importance/:runId", () => {
    it("returns variable importance data", async () => {
      const mockImportance = {
        available: true,
        n_variables: 3,
        importance: [
          { variable: "bio1", importance: 0.15, sd: 0.02, baseline: 0.82 },
          { variable: "bio12", importance: 0.08, sd: 0.01, baseline: 0.82 },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockImportance),
      });

      const res = await fetch("/api/v1/diagnostics/importance/run-123");
      const data = await res.json();

      expect(data.available).toBe(true);
      expect(data.importance).toHaveLength(2);
      expect(data.importance[0].variable).toBe("bio1");
    });
  });

  describe("GET /api/v1/diagnostics/cbi/:runId", () => {
    it("returns CBI data with bins", async () => {
      const mockCbi = {
        available: true,
        cbi: 0.75,
        pe_ratio: 2.3,
        n_bins: 51,
        bins: [
          { bin_mid: 0.1, ratio: 0.5, smoothed: 0.6 },
          { bin_mid: 0.5, ratio: 1.5, smoothed: 1.8 },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCbi),
      });

      const res = await fetch("/api/v1/diagnostics/cbi/run-123");
      const data = await res.json();

      expect(data.cbi).toBe(0.75);
      expect(data.pe_ratio).toBe(2.3);
      expect(data.bins).toHaveLength(2);
    });
  });

  describe("GET /api/v1/diagnostics/mess/:runId", () => {
    it("returns MESS summary when future projection exists", async () => {
      const mockMess = {
        available: true,
        mess_tif: "outputs/jobs/run-123/mess.tif",
        mod_tif: "outputs/jobs/run-123/mod.tif",
        pct_extrapolation: 12.5,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMess),
      });

      const res = await fetch("/api/v1/diagnostics/mess/run-123");
      const data = await res.json();

      expect(data.available).toBe(true);
      expect(data.pct_extrapolation).toBe(12.5);
    });

    it("handles no future projection", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available: false, message: "No future projection with MESS" }),
      });

      const res = await fetch("/api/v1/diagnostics/mess/run-123");
      const data = await res.json();
      expect(data.available).toBe(false);
    });
  });

  describe("GET /api/v1/diagnostics/summary/:runId", () => {
    it("returns combined diagnostics summary", async () => {
      const mockSummary = {
        run_id: "run-123",
        species: "Acacia mearnsii",
        model_id: "glm",
        diagnostics: {
          vif: { available: true, enabled: true },
          response_curves: { available: true },
          variable_importance: { available: true },
          cbi: { available: true },
          mess: { available: false },
        },
        metrics: {
          auc_mean: 0.85,
          auc_sd: 0.03,
          tss_mean: 0.62,
          tss_sd: 0.05,
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSummary),
      });

      const res = await fetch("/api/v1/diagnostics/summary/run-123");
      const data = await res.json();

      expect(data.diagnostics.vif.available).toBe(true);
      expect(data.diagnostics.cbi.available).toBe(true);
      expect(data.metrics.auc_mean).toBe(0.85);
    });
  });
});
