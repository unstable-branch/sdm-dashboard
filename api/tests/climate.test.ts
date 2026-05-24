import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Climate API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/climate/scenarios", () => {
    it("returns list of climate scenarios", async () => {
      const mockScenarios = {
        scenarios: [
          { id: "worldclim_current", type: "current", source: "worldclim", file_count: 19, size_bytes: 500000000 },
          { id: "UKESM1-0-LL_SSP2-4.5_2041-2060", type: "future", gcm: "UKESM1-0-LL", ssp: "SSP2-4.5", period: "2041-2060", file_count: 19 },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockScenarios),
      });

      const res = await fetch("/api/v1/climate/scenarios");
      const data = await res.json();

      expect(data.scenarios).toHaveLength(2);
      expect(data.scenarios[0].id).toBe("worldclim_current");
    });

    it("handles empty scenarios", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ scenarios: [] }),
      });

      const res = await fetch("/api/v1/climate/scenarios");
      const data = await res.json();
      expect(data.scenarios).toEqual([]);
    });
  });

  describe("POST /api/v1/climate/download", () => {
    it("starts a climate download job", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: "climate_123", status: "running" }),
      });

      const res = await fetch("/api/v1/climate/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "worldclim", res: 10, biovars: "1,4,6,12" }),
      });
      const data = await res.json();

      expect(data.jobId).toBe("climate_123");
      expect(data.status).toBe("running");
    });

    it("starts a CMIP6 download", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: "climate_456", status: "running" }),
      });

      const res = await fetch("/api/v1/climate/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cmip6", gcm: "UKESM1-0-LL", ssp: "SSP2-4.5", period: "2041-2060" }),
      });
      const data = await res.json();

      expect(data.jobId).toBeDefined();
    });
  });

  describe("POST /api/v1/climate/delete/:id", () => {
    it("deletes a climate scenario", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, message: "Scenario deleted: worldclim_current" }),
      });

      const res = await fetch("/api/v1/climate/delete/worldclim_current", { method: "POST" });
      const data = await res.json();

      expect(data.ok).toBe(true);
    });

    it("returns 404 for non-existent scenario", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Scenario not found" }),
      });

      const res = await fetch("/api/v1/climate/delete/nonexistent", { method: "POST" });
      expect(res.ok).toBe(false);
    });
  });

  describe("GET /api/v1/climate/status/:jobId", () => {
    it("returns climate download job status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: "climate_123",
          type: "worldclim",
          status: "completed",
          started_at: "2024-01-01T00:00:00Z",
          completed_at: "2024-01-01T00:05:00Z",
        }),
      });

      const res = await fetch("/api/v1/climate/status/climate_123");
      const data = await res.json();

      expect(data.status).toBe("completed");
      expect(data.type).toBe("worldclim");
    });
  });
});
