import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<Record<string, unknown>>,
  selectError: null as Error | null,
  getJobStatus: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (mocks.selectError) throw mocks.selectError;
            return mocks.selectResult;
          }),
        })),
      })),
    })),
  },
}));

vi.mock("../services/queue.js", () => ({
  getJobStatus: mocks.getJobStatus,
  getJobQueue: vi.fn(),
}));

vi.mock("../services/access.js", () => ({
  getUserProjectIds: vi.fn(async () => null),
}));

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    await next();
  }),
}));

vi.mock("../services/job-events.js", () => ({
  jobEventBus: { on: vi.fn(), off: vi.fn() },
}));

import jobsRoutes from "./jobs.js";

function testApp() {
  const app = new Hono();
  app.route("/jobs", jobsRoutes);
  return app;
}

describe("job status routes", () => {
  beforeEach(() => {
    mocks.selectResult = [];
    mocks.selectError = null;
    mocks.getJobStatus.mockReset().mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  });

  it("returns durable failed-run diagnostics after queue and Plumber retention", async () => {
    mocks.selectResult = [{
      id: "run-1",
      jobId: "plumber-job-1",
      status: "failed",
      error: "R process crashed",
      errorCode: "PROCESS_CRASH",
      errorHint: "Reduce memory usage",
      progressLog: ["loading", "failed"],
    }];

    const res = await testApp().request("/jobs/run-1");
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/models/status/plumber-job-1"),
      expect.any(Object),
    );
    await expect(res.json()).resolves.toMatchObject({
      id: "run-1",
      state: "failed",
      failedReason: "R process crashed",
      error_code: "PROCESS_CRASH",
      error_hint: "Reduce memory usage",
    });
  });

  it("returns 404 for a missing persisted model job", async () => {
    const res = await testApp().request("/jobs/missing-run");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Job not found" });
  });

  it("returns controlled 404 for a missing async data job", async () => {
    const res = await testApp().request("/jobs/data-missing");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Job not found" });
  });

  it("returns 503 rather than 500 when persisted status is temporarily unavailable", async () => {
    mocks.selectError = new Error("database restarting");
    const res = await testApp().request("/jobs/run-1");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Job status temporarily unavailable" });
  });
});
