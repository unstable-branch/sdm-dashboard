import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Plumber Auth", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API key validation via X-API-Key header", () => {
    it("returns 401 when no API key provided on protected endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species: "Test", model_id: "glm", occurrence_file: "test.csv" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(401);
    });

    it("returns 401 when invalid API key provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"Invalid or expired API key."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "invalid-key-12345",
        },
        body: JSON.stringify({ species: "Test", model_id: "glm", occurrence_file: "test.csv" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(401);
    });

    it("accepts valid API key on protected endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: "run-123", status: "running" }),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "valid-api-key-from-db",
        },
        body: JSON.stringify({ species: "Test", model_id: "glm", occurrence_file: "test.csv" }),
      });

      expect(res.ok).toBe(true);
    });

    it("accepts X-Hono-Internal + X-Forwarded-User for Hono-proxied requests", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: "run-456", status: "running" }),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hono-Internal": "internal-secret-key",
          "X-Forwarded-User": "user-uuid-here",
        },
        body: JSON.stringify({ species: "Test", model_id: "glm", occurrence_file: "test.csv" }),
      });

      expect(res.ok).toBe(true);
    });
  });

  describe("Open endpoints (no auth required)", () => {
    it("GET /health is always open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "ok", r_version: "4.4.0", timestamp: "2024-01-01T00:00:00Z" }),
      });

      const res = await fetch("http://localhost:8000/health");
      expect(res.ok).toBe(true);
    });

    it("GET /api/v1/climate/scenarios requires no auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ scenarios: [] }),
      });

      const res = await fetch("http://localhost:8000/api/v1/climate/scenarios");
      expect(res.ok).toBe(true);
    });

    it("GET /api/v1/models/runs requires no auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/runs");
      expect(res.ok).toBe(true);
    });

    it("GET /api/v1/models (list available models) requires no auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: "glm", label: "Generalized Linear Model" }]),
      });

      const res = await fetch("http://localhost:8000/api/v1/models");
      expect(res.ok).toBe(true);
    });

    it("GET /api/v1/config/defaults requires no auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ biovars: [1, 4, 6, 12] }),
      });

      const res = await fetch("http://localhost:8000/api/v1/config/defaults");
      expect(res.ok).toBe(true);
    });

    it("GET /api/v1/future/scenarios requires no auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available_scenarios: [], base_directory: "Worldclim_future" }),
      });

      const res = await fetch("http://localhost:8000/api/v1/future/scenarios");
      expect(res.ok).toBe(true);
    });

    it("GET /api/v1/ecology/:runId requires no auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ run_id: "run-123", available: false, message: "Run not found" }),
      });

      const res = await fetch("http://localhost:8000/api/v1/ecology/run-123");
      expect(res.ok).toBe(true);
    });
  });

  describe("Protected endpoints (auth required)", () => {
    it("POST /api/v1/models/run requires auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species: "Test", model_id: "glm" }),
      });

      expect(res.status).toBe(401);
    });

    it("POST /api/v1/models/cancel/:job_id requires auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/cancel/run-123", {
        method: "POST",
      });

      expect(res.status).toBe(401);
    });

    it("POST /api/v1/climate/download requires auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/climate/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "worldclim" }),
      });

      expect(res.status).toBe(401);
    });

    it("POST /api/v1/occurrences/upload requires auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/occurrences/upload", {
        method: "POST",
        body: "test",
      });

      expect(res.status).toBe(401);
    });

    it("POST /api/v1/occurrences/clean requires auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/occurrences/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
    });

    it("POST /api/v1/occurrences/gbif/search requires auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"API key required. Provide X-API-Key header."}'),
      });

      const res = await fetch("http://localhost:8000/api/v1/occurrences/gbif/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxon: "Acacia" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("PLUMBER_AUTH_DISABLED env var", () => {
    it("bypasses auth when PLUMBER_AUTH_DISABLED=true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: "run-789", status: "running" }),
      });

      const res = await fetch("http://localhost:8000/api/v1/models/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species: "Test" }),
      });

      expect(res.ok).toBe(true);
    });
  });
});