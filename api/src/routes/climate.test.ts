import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  getClimateScenarios: vi.fn(),
  getClimateCheck: vi.fn(),
  downloadClimate: vi.fn(),
  getClimateStatus: vi.fn(),
  registerSystemClimateCollectionFromServerPath: vi.fn(),
  resolveInputAsset: vi.fn(),
  updateInputAssetState: vi.fn(),
  role: "user",
}));

vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    getClimateScenarios: mocks.getClimateScenarios,
    getClimateCheck: mocks.getClimateCheck,
    withUser: vi.fn(() => ({
      withRole: vi.fn(() => ({
        getClimateScenarios: mocks.getClimateScenarios,
        downloadClimate: mocks.downloadClimate,
        getClimateStatus: mocks.getClimateStatus,
      })),
    })),
  },
}));
vi.mock("../services/input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {
    constructor(message: string, public reason?: string) { super(message); }
  },
  registerSystemClimateCollectionFromServerPath: mocks.registerSystemClimateCollectionFromServerPath,
  resolveInputAsset: mocks.resolveInputAsset,
  updateInputAssetState: mocks.updateInputAssetState,
}));
vi.mock("../middleware/rate-limit.js", () => ({
  climateRateLimit: vi.fn(async (_c: any, next: any) => await next()),
  longCache: vi.fn(async (_c: any, next: any) => await next()),
}));
vi.mock("../middleware/cache.js", () => ({
  longCache: vi.fn(async (_c: any, next: any) => await next()),
}));
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "11111111-1111-4111-8111-111111111111", email: "test@example.com", role: mocks.role });
    await next();
  }),
  optionalAuth: vi.fn(async (_c: any, next: any) => await next()),
}));
vi.mock("../services/audit.js", () => ({
  logAction: vi.fn(),
  extractClientInfo: vi.fn(() => ({})),
}));

import { climateRoutes } from "./climate.js";

function testApp() {
  const app = new Hono();
  app.route("/climate", climateRoutes);
  return app;
}

describe("climate routes — Plumber unavailability propagation", () => {
  beforeEach(() => {
    mocks.getClimateScenarios.mockReset();
    mocks.getClimateCheck.mockReset();
    mocks.downloadClimate.mockReset();
    mocks.getClimateStatus.mockReset();
    mocks.registerSystemClimateCollectionFromServerPath.mockReset();
    mocks.resolveInputAsset.mockReset();
    mocks.updateInputAssetState.mockReset();
    mocks.role = "user";
    mocks.registerSystemClimateCollectionFromServerPath.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });
  });

  describe("GET /scenarios", () => {
    it("returns 200 with scenarios on success", async () => {
      mocks.getClimateScenarios.mockResolvedValue({ scenarios: [{ id: "wc_current", type: "current", source: "worldclim", resolution: 10, file_count: 19, size_bytes: 2048, manifest_path: "/safe/climate.json" }] });
      const res = await testApp().request("/climate/scenarios");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ scenarios: [{ id: "wc_current", type: "current", climateCollectionId: "22222222-2222-4222-8222-222222222222", source: "worldclim", resolution: 10, file_count: 19, size_bytes: 2048 }] });
      expect(body.scenarios[0].manifest_path).toBeUndefined();
      expect(mocks.registerSystemClimateCollectionFromServerPath).toHaveBeenCalledWith({
        creatorUserId: "11111111-1111-4111-8111-111111111111",
        absolutePath: "/safe/climate.json",
      });
    });

    it("registers future manifests and returns opaque collection IDs", async () => {
      mocks.getClimateScenarios.mockResolvedValue({ scenarios: [{
        id: "future-1", type: "future", source: "worldclim", gcm: "ACCESS-CM2",
        ssp: "ssp245", period: "2041-2060", resolution: 10, manifest_path: "/safe/future.json",
        file_count: 19, size_bytes: 4096,
      }] });
      mocks.registerSystemClimateCollectionFromServerPath.mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
      });

      const res = await testApp().request("/climate/scenarios");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ scenarios: [{
        id: "future-1", type: "future", source: "worldclim", gcm: "ACCESS-CM2",
        ssp: "ssp245", period: "2041-2060", resolution: 10, file_count: 19, size_bytes: 4096,
        climateCollectionId: "33333333-3333-4333-8333-333333333333",
      }] });
    });

    it("omits a soft-deleted system collection without breaking scenario discovery", async () => {
      const { InputAssetRegistrationError } = await import("../services/input-assets.js");
      mocks.getClimateScenarios.mockResolvedValue({ scenarios: [{
        id: "wc_current", type: "current", source: "worldclim", resolution: 10,
        manifest_path: "/safe/climate.json", status: "completed",
      }] });
      mocks.registerSystemClimateCollectionFromServerPath.mockRejectedValue(
        new InputAssetRegistrationError("Climate collection is deleted", "deleted"),
      );

      const res = await testApp().request("/climate/scenarios");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ scenarios: [] });
    });

    it("returns 502 with PLUMBER_UNAVAILABLE code on Plumber error", async () => {
      mocks.getClimateScenarios.mockRejectedValue(new Error("connection refused"));
      const res = await testApp().request("/climate/scenarios");
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.code).toBe("PLUMBER_UNAVAILABLE");
      expect(body.error).toBe("Plumber unavailable");
      expect(body.message).toBe("connection refused");
    });
  });

  describe("GET /check", () => {
    it("returns 200 with biovar availability on success", async () => {
      mocks.getClimateCheck.mockResolvedValue({ available: [1, 4, 12], missing: [6] });
      const res = await testApp().request("/climate/check?source=worldclim&res=10&biovars=1,4,6,12");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ available: [1, 4, 12], missing: [6] });
    });

    it("returns 502 with PLUMBER_UNAVAILABLE code on Plumber error", async () => {
      mocks.getClimateCheck.mockRejectedValue(new Error("timeout"));
      const res = await testApp().request("/climate/check?source=worldclim&res=10&biovars=1,4");
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.code).toBe("PLUMBER_UNAVAILABLE");
      expect(body.error).toBe("Plumber unavailable");
      expect(body.message).toBe("timeout");
    });
  });

  describe("canonical collection registration", () => {
    it("registers only a completed download and returns an opaque collection ID", async () => {
      mocks.downloadClimate.mockResolvedValue({
        job_id: "climate-complete",
        status: "completed",
        manifest_path: "/safe/climate.json",
        user_id: "11111111-1111-4111-8111-111111111111",
      });
      const res = await testApp().request("/climate/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "worldclim", res: 10 }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        jobId: "climate-complete", status: "completed",
        climateCollectionId: "22222222-2222-4222-8222-222222222222",
      });
      expect(mocks.registerSystemClimateCollectionFromServerPath).toHaveBeenCalledTimes(1);
    });

    it.each(["running", "failed"])("does not register an incomplete or %s job", async (status: string) => {
      mocks.getClimateStatus.mockResolvedValue({ id: "climate-job", status, manifest_path: "/safe/climate.json" });
      const res = await testApp().request("/climate/status/climate-job");
      expect(res.status).toBe(200);
      expect(mocks.registerSystemClimateCollectionFromServerPath).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toMatchObject({ status });
    });

    it("fails closed when the completed producer response lacks trusted identity", async () => {
      mocks.getClimateStatus.mockResolvedValue({ id: "climate-job", status: "completed", path: "/safe/climate.json" });
      const res = await testApp().request("/climate/status/climate-job");
      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe("CLIMATE_MANIFEST_UNAVAILABLE");
      expect(mocks.registerSystemClimateCollectionFromServerPath).not.toHaveBeenCalled();
    });

    it("fails closed when a completed user job lacks producer ownership", async () => {
      mocks.getClimateStatus.mockResolvedValue({ id: "climate-job", status: "completed", manifest_path: "/safe/climate.json" });
      const res = await testApp().request("/climate/status/climate-job");
      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe("CLIMATE_MANIFEST_UNAVAILABLE");
      expect(mocks.registerSystemClimateCollectionFromServerPath).not.toHaveBeenCalled();
    });

    it("denies a producer response owned by another user", async () => {
      mocks.getClimateStatus.mockResolvedValue({
        id: "climate-job", status: "completed", manifest_path: "/safe/climate.json", user_id: "33333333-3333-4333-8333-333333333333",
      });
      const res = await testApp().request("/climate/status/climate-job");
      expect(res.status).toBe(502);
      expect(mocks.registerSystemClimateCollectionFromServerPath).not.toHaveBeenCalled();
    });

    it("denies client-supplied path aliases before Plumber", async () => {
      const res = await testApp().request("/climate/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "worldclim", worldclimDir: "/foreign/climate" }),
      });
      expect(res.status).toBe(400);
      expect(mocks.downloadClimate).not.toHaveBeenCalled();
      expect(mocks.registerSystemClimateCollectionFromServerPath).not.toHaveBeenCalled();
    });

    it("normalizes and rejects deeply nested path aliases before Plumber", async () => {
      const res = await testApp().request("/climate/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "worldclim", nested: { one: { two: { three: { four: { five: { six: { seven: { WORLDCLIM_DIR: "/foreign/climate" } } } } } } } } }),
      });
      expect(res.status).toBe(400);
      expect(mocks.downloadClimate).not.toHaveBeenCalled();
    });

    it("propagates containment or tamper denial without exposing a path", async () => {
      mocks.getClimateStatus.mockResolvedValue({ id: "climate-job", status: "completed", manifest_path: "/outside/climate.json" });
      mocks.registerSystemClimateCollectionFromServerPath.mockRejectedValueOnce(new Error("manifest is outside configured roots or tampered"));
      const res = await testApp().request("/climate/status/climate-job");
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.climateCollectionId).toBeUndefined();
      expect(body.code).toBe("CLIMATE_MANIFEST_UNAVAILABLE");
      expect(JSON.stringify(body)).not.toContain("/outside/climate.json");
    });
  });

  describe("canonical collection deletion", () => {
    const collectionId = "22222222-2222-4222-8222-222222222222";

    it("conceals system collections from non-admin deletion", async () => {
      const res = await testApp().request(`/climate/delete/${collectionId}`, { method: "POST" });
      expect(res.status).toBe(404);
      expect(mocks.updateInputAssetState).not.toHaveBeenCalled();
    });

    it("soft-deletes an admin-authorized opaque collection ID", async () => {
      mocks.role = "admin";
      mocks.resolveInputAsset.mockResolvedValue({ ok: true, asset: { id: collectionId, kind: "climate_collection", scope: "system" } });
      mocks.updateInputAssetState.mockResolvedValue(true);

      const res = await testApp().request(`/climate/delete/${collectionId}`, { method: "POST" });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, climateCollectionId: collectionId, state: "deleted" });
      expect(mocks.updateInputAssetState).toHaveBeenCalledWith(collectionId, "deleted");
    });
  });
});
