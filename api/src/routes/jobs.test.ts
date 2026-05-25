import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import jobsRoutes from "./jobs.js";
import { getJobStatus } from "../services/queue.js";

vi.mock("../services/queue.js", () => ({
  getJobStatus: vi.fn(),
  getJobQueue: vi.fn(),
}));

vi.mock("../services/job-events.js", () => ({
  jobEventBus: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe("jobs routes", () => {
  const app = new Hono();
  app.route("/api/v1/jobs", jobsRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /:jobId preserves legacy fields and adds polling fields for queued jobs", async () => {
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "job-123",
      state: "waiting",
      progress: 25,
      result: { status: "success" },
      failedReason: "",
    });

    const res = await app.request("/api/v1/jobs/job-123");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "job-123",
      state: "waiting",
      progress: 25,
      result: { status: "success" },
      failedReason: "",
      status: "queued",
      progress_percent: 25,
      terminal: false,
      poll_after_ms: 2000,
      error: null,
    });
  });

  it("GET /:jobId normalizes failed jobs with an error and no poll hint", async () => {
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "job-456",
      state: "failed",
      progress: 80,
      result: { status: "error", error: "Plumber failed" },
      failedReason: "Worker failed",
    });

    const res = await app.request("/api/v1/jobs/job-456");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      id: "job-456",
      state: "failed",
      progress: 80,
      failedReason: "Worker failed",
      status: "failed",
      progress_percent: 80,
      terminal: true,
      poll_after_ms: null,
      error: "Worker failed",
    }));
  });

  it("GET /:jobId returns the existing 404 shape when the queue cannot find a job", async () => {
    vi.mocked(getJobStatus).mockResolvedValueOnce(null);

    const res = await app.request("/api/v1/jobs/missing-job");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Job not found or queue unavailable" });
  });
});
