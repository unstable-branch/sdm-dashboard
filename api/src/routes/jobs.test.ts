import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import jobsRoutes from "./jobs.js";
import { getJobQueue, getJobStatus } from "../services/queue.js";
import { getUserProjectIds } from "../services/access.js";

type MockContext = {
  req: { header: (name: string) => string | undefined };
  set: (key: string, value: unknown) => void;
  json: (body: unknown, status?: number) => Response;
};

type MockNext = () => Promise<void>;

vi.mock("../services/queue.js", () => ({
  getJobStatus: vi.fn(),
  getJobQueue: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../services/access.js", () => ({
  getUserProjectIds: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: MockContext, next: MockNext) => {
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", {
      id: "user-1",
      email: "test@example.com",
      role: "viewer",
    });
    await next();
  }),
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
    vi.mocked(getJobQueue).mockReturnValue({
      getJob: vi.fn(async () => ({ data: { userId: "user-1" } })),
    } as never);
    vi.mocked(getUserProjectIds).mockResolvedValue(["proj-1"]);
  });

  const authHeaders = { Authorization: "Bearer test-token" };

  function mockRunLookup(rows: unknown[]) {
    return vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows),
        })),
      })),
    }));
  }

  it("GET /:jobId requires authentication", async () => {
    const res = await app.request("/api/v1/jobs/job-123");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it("GET /:jobId preserves legacy fields and adds polling fields for queued jobs", async () => {
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "job-123",
      state: "waiting",
      progress: 25,
      result: { status: "success" },
      failedReason: "",
    });

    const res = await app.request("/api/v1/jobs/job-123", { headers: authHeaders });

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

    const res = await app.request("/api/v1/jobs/job-456", { headers: authHeaders });

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
    vi.mocked(getJobQueue).mockReturnValueOnce({
      getJob: vi.fn(async () => null),
    } as never);

    const res = await app.request("/api/v1/jobs/missing-job", { headers: authHeaders });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Job not found or queue unavailable" });
  });

  it("GET /:jobId returns visible run-backed jobs for authorized project members", async () => {
    vi.mocked(getJobQueue).mockReturnValueOnce({
      getJob: vi.fn(async () => ({ data: { payload: { runId: "run-1" } } })),
    } as never);
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockImplementationOnce(mockRunLookup([{ id: "run-1" }]) as never);
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "job-run-1",
      state: "active",
      progress: 45,
      result: null,
      failedReason: "",
    });

    const res = await app.request("/api/v1/jobs/job-run-1", { headers: authHeaders });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      id: "job-run-1",
      state: "active",
      status: "running",
      progress_percent: 45,
    }));
  });

  it("GET /:jobId hides run-backed jobs outside the caller's projects", async () => {
    vi.mocked(getJobQueue).mockReturnValueOnce({
      getJob: vi.fn(async () => ({ data: { payload: { runId: "run-private" } } })),
    } as never);
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockImplementationOnce(mockRunLookup([]) as never);

    const res = await app.request("/api/v1/jobs/job-private", { headers: authHeaders });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Job not found or queue unavailable" });
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it("POST /:jobId/cancel hides run-backed jobs outside the caller's projects", async () => {
    const remove = vi.fn();
    vi.mocked(getJobQueue).mockReturnValueOnce({
      getJob: vi.fn(async () => ({
        data: { payload: { runId: "run-private" } },
        getState: vi.fn(async () => "waiting"),
        remove,
      })),
    } as never);
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockImplementationOnce(mockRunLookup([]) as never);

    const res = await app.request("/api/v1/jobs/job-private/cancel", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Job not found" });
    expect(remove).not.toHaveBeenCalled();
  });
});
