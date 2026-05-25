import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { climateRoutes } from "./climate.js";
import { enqueueSdmJob } from "../services/queue.js";
import { beginIdempotentRequest, completeIdempotentRequest } from "../services/idempotency.js";
import { plumberClient } from "../services/plumber.js";

type MockContext = {
  req: { header: (name: string) => string | undefined };
  set: (key: string, value: unknown) => void;
  json: (body: unknown, status?: number) => Response;
};

type MockNext = () => Promise<void>;

vi.mock("../middleware/rate-limit", () => ({
  climateRateLimit: vi.fn(async (c: unknown, next: MockNext) => {
    void c;
    await next();
  }),
}));

vi.mock("../middleware/cache", () => ({
  longCache: vi.fn(async (c: unknown, next: MockNext) => {
    void c;
    await next();
  }),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: MockContext, next: MockNext) => {
    const hasAuth = Boolean(c.req.header("Authorization") || c.req.header("X-API-Key"));
    if (!hasAuth) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    await next();
  }),
  optionalAuth: vi.fn(async (c: MockContext, next: MockNext) => {
    const hasAuth = Boolean(c.req.header("Authorization") || c.req.header("X-API-Key"));
    if (hasAuth) {
      c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    }
    await next();
  }),
}));

vi.mock("../services/plumber", () => ({
  plumberClient: {
    getClimateScenarios: vi.fn(),
    deleteClimateScenario: vi.fn(),
    getClimateStatus: vi.fn(),
  },
}));

vi.mock("../services/queue", () => ({
  enqueueSdmJob: vi.fn(() => Promise.resolve("job-123")),
}));

vi.mock("../services/idempotency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/idempotency.js")>();
  return {
    ...actual,
    beginIdempotentRequest: vi.fn(),
    completeIdempotentRequest: vi.fn(),
    failIdempotentRequest: vi.fn(),
  };
});

describe("climate routes", () => {
  const app = new Hono();
  app.route("/api/v1/climate", climateRoutes);
  const authHeader = { Authorization: "Bearer test-token" };

  const idempotencyEntry = {
    id: "idem-climate-1",
    projectId: null,
    userId: "user-1",
    method: "POST",
    route: "/api/v1/climate/download",
    idempotencyKey: "climate-key",
    requestHash: "hash-1",
    state: "completed" as const,
    statusCode: 200,
    responseBody: { jobId: "job-existing", status: "queued" },
    resourceType: "climate_download",
    resourceId: "job-existing",
    expiresAt: new Date("2026-05-26T00:00:00Z"),
    createdAt: new Date("2026-05-25T00:00:00Z"),
    updatedAt: new Date("2026-05-25T00:00:00Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enqueueSdmJob).mockResolvedValue("job-123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows anonymous scenario catalog reads", async () => {
    vi.mocked(plumberClient.getClimateScenarios).mockResolvedValueOnce({
      scenarios: [{ id: "scenario-1", label: "Scenario 1" }],
    });

    const res = await app.request("/api/v1/climate/scenarios");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scenarios: [{ id: "scenario-1", label: "Scenario 1" }],
    });
  });

  it("allows anonymous climate availability checks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: ["bio1"], missing: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/v1/climate/check?source=worldclim&resolution=10");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: ["bio1"], missing: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves current download queuing behavior without an idempotency key", async () => {
    const res = await app.request("/api/v1/climate/download", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "job-123", status: "queued" });
    expect(enqueueSdmJob).toHaveBeenCalledWith(
      {
        type: "climate_download",
        payload: { type: "worldclim", biovars: [1, 12] },
      },
      "user-1"
    );
    expect(beginIdempotentRequest).not.toHaveBeenCalled();
    expect(completeIdempotentRequest).not.toHaveBeenCalled();
  });

  it("completes a started climate download idempotency key with the queued response", async () => {
    vi.mocked(beginIdempotentRequest).mockResolvedValueOnce({
      outcome: "started",
      entry: { ...idempotencyEntry, state: "processing", responseBody: null, statusCode: null },
      reusedFailedEntry: false,
      reusedExpiredEntry: false,
    });

    const res = await app.request("/api/v1/climate/download", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "job-123", status: "queued" });
    expect(completeIdempotentRequest).toHaveBeenCalledWith({
      id: "idem-climate-1",
      statusCode: 200,
      responseBody: { jobId: "job-123", status: "queued" },
      resourceType: "climate_download",
      resourceId: "job-123",
    });
  });

  it("replays a completed climate download response", async () => {
    vi.mocked(beginIdempotentRequest).mockResolvedValueOnce({
      outcome: "replay",
      entry: idempotencyEntry,
    });

    const res = await app.request("/api/v1/climate/download", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(idempotencyEntry.responseBody);
    expect(enqueueSdmJob).not.toHaveBeenCalled();
  });

  it("rejects a reused climate download key with a different body", async () => {
    vi.mocked(beginIdempotentRequest).mockResolvedValueOnce({
      outcome: "conflict",
      entry: idempotencyEntry,
      reason: "hash_mismatch",
    });

    const res = await app.request("/api/v1/climate/download", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({
      error: "Idempotency key conflict",
      status: "conflict",
    }));
    expect(enqueueSdmJob).not.toHaveBeenCalled();
  });

  it("rejects a duplicate climate download while the first is processing", async () => {
    vi.mocked(beginIdempotentRequest).mockResolvedValueOnce({
      outcome: "processing",
      entry: { ...idempotencyEntry, state: "processing", responseBody: null, statusCode: null },
    });

    const res = await app.request("/api/v1/climate/download", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({
      error: "Idempotency key is already processing",
      status: "processing",
    }));
    expect(enqueueSdmJob).not.toHaveBeenCalled();
  });

  it("requires auth for climate status lookups", async () => {
    const res = await app.request("/api/v1/climate/status/job-123");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(plumberClient.getClimateStatus).not.toHaveBeenCalled();
  });

  it("proxies authorized climate status lookups", async () => {
    vi.mocked(plumberClient.getClimateStatus).mockResolvedValueOnce({
      job_id: "job-123",
      status: "running",
    });

    const res = await app.request("/api/v1/climate/status/job-123", {
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: "job-123", status: "running" });
    expect(plumberClient.getClimateStatus).toHaveBeenCalledWith("job-123");
  });

  it("requires auth for climate scenario delete", async () => {
    const res = await app.request("/api/v1/climate/delete/scenario-1", {
      method: "POST",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(plumberClient.deleteClimateScenario).not.toHaveBeenCalled();
  });

  it("proxies authorized climate scenario delete", async () => {
    vi.mocked(plumberClient.deleteClimateScenario).mockResolvedValueOnce({ ok: true, message: "Deleted" });

    const res = await app.request("/api/v1/climate/delete/scenario-1", {
      method: "POST",
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Deleted" });
    expect(plumberClient.deleteClimateScenario).toHaveBeenCalledWith("scenario-1");
  });
});
