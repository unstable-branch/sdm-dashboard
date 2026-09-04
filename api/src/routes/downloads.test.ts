import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  getClimateStatus: vi.fn(),
  getJobStatus: vi.fn(),
  post: vi.fn(),
  withUser: vi.fn(),
}));

vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    getClimateStatus: mocks.getClimateStatus,
    get: mocks.getJobStatus,
    post: mocks.post,
    withUser: mocks.withUser,
  },
}));
vi.mock("../middleware/rate-limit.js", () => ({
  climateRateLimit: vi.fn(async (_c: any, next: any) => await next()),
}));
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "user" });
    await next();
  }),
}));
vi.mock("../services/audit.js", () => ({
  logAction: vi.fn(),
  extractClientInfo: vi.fn(() => ({})),
}));

import { downloadsRoutes } from "./downloads.js";

function testApp() {
  const app = new Hono();
  app.route("/downloads", downloadsRoutes);
  return app;
}

describe("downloads dispatch routes", () => {
  beforeEach(() => {
    mocks.getClimateStatus.mockReset();
    mocks.getJobStatus.mockReset();
    mocks.post.mockReset();
    mocks.withUser.mockReset();
    mocks.withUser.mockImplementation((uid: string) => ({
      get: mocks.getJobStatus,
      post: mocks.post,
      _userId: uid,
    }));
  });

  describe("GET /status/:jobId", () => {
    it("routes climate_ prefix to Plumber climate/status", async () => {
      mocks.getClimateStatus.mockResolvedValue({ status: "running", progress_log: [] });
      const res = await testApp().request("/downloads/status/climate_20240101_abcd12");
      expect(res.status).toBe(200);
      expect(mocks.getClimateStatus).toHaveBeenCalledWith("climate_20240101_abcd12");
      expect(mocks.getJobStatus).not.toHaveBeenCalled();
    });

    it("routes cov_ prefix to Plumber jobs/status", async () => {
      mocks.getJobStatus.mockResolvedValue({ status: "completed", progress_log: ["[100%]"] });
      const res = await testApp().request("/downloads/status/cov_20240101_zyxw98");
      expect(res.status).toBe(200);
      expect(mocks.getJobStatus).toHaveBeenCalledWith("/api/v1/jobs/status/cov_20240101_zyxw98");
      expect(mocks.getClimateStatus).not.toHaveBeenCalled();
    });

    it("routes data- prefix to Plumber jobs/status", async () => {
      mocks.getJobStatus.mockResolvedValue({ status: "completed" });
      const res = await testApp().request("/downloads/status/data-20240101-0001");
      expect(res.status).toBe(200);
      expect(mocks.getJobStatus).toHaveBeenCalledWith("/api/v1/jobs/status/data-20240101-0001");
    });

    it("rejects job IDs with disallowed characters", async () => {
      const res = await testApp().request("/downloads/status/bad%2Fid%21");
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("Invalid") });
    });
  });

  describe("POST /cancel/:jobId", () => {
    it("routes climate_ prefix to Plumber climate/cancel with user context", async () => {
      mocks.post.mockResolvedValue({ ok: true, message: "cancelled" });
      const res = await testApp().request("/downloads/cancel/climate_20240101_abcd12", { method: "POST" });
      expect(res.status).toBe(200);
      expect(mocks.withUser).toHaveBeenCalledWith("user-1");
      expect(mocks.post).toHaveBeenCalledWith("/api/v1/climate/cancel/climate_20240101_abcd12", {});
    });

    it("routes cov_ prefix to Plumber jobs/cancel", async () => {
      mocks.post.mockResolvedValue({ ok: true });
      const res = await testApp().request("/downloads/cancel/cov_20240101_zyxw98", { method: "POST" });
      expect(res.status).toBe(200);
      expect(mocks.post).toHaveBeenCalledWith("/api/v1/jobs/cancel/cov_20240101_zyxw98", {});
    });

    it("forwards Plumber 403 access denied response", async () => {
      mocks.post.mockRejectedValue(Object.assign(new Error("Access denied"), { status: 403 }));
      const res = await testApp().request("/downloads/cancel/climate_20240101_abcd12", { method: "POST" });
      expect(res.status).toBe(403);
    });
  });
});
