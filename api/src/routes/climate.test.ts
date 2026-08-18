import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  getClimateScenarios: vi.fn(),
  getClimateCheck: vi.fn(),
}));

vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    getClimateScenarios: mocks.getClimateScenarios,
    getClimateCheck: mocks.getClimateCheck,
  },
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
    c.set("user", { id: "user-1", email: "test@example.com", role: "user" });
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
  });

  describe("GET /scenarios", () => {
    it("returns 200 with scenarios on success", async () => {
      mocks.getClimateScenarios.mockResolvedValue({ scenarios: [{ id: "wc_current" }] });
      const res = await testApp().request("/climate/scenarios");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ scenarios: [{ id: "wc_current" }] });
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
});