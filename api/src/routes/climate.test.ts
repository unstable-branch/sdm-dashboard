import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { climateRoutes } from "./climate.js";
import { enqueueSdmJob } from "../services/queue.js";
import { beginIdempotentRequest, completeIdempotentRequest } from "../services/idempotency.js";

vi.mock("../middleware/rate-limit", () => ({
  climateRateLimit: vi.fn(async (_c: any, next: any) => {
    await next();
  }),
}));

vi.mock("../middleware/cache", () => ({
  longCache: vi.fn(async (_c: any, next: any) => {
    await next();
  }),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    await next();
  }),
  optionalAuth: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
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

  it("preserves current download queuing behavior without an idempotency key", async () => {
    const res = await app.request("/api/v1/climate/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "job-123", status: "queued" });
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
      headers: { "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
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
      headers: { "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
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
      headers: { "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
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
      headers: { "Content-Type": "application/json", "Idempotency-Key": "climate-key" },
      body: JSON.stringify({ type: "worldclim", biovars: [1, 12] }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({
      error: "Idempotency key is already processing",
      status: "processing",
    }));
    expect(enqueueSdmJob).not.toHaveBeenCalled();
  });
});
