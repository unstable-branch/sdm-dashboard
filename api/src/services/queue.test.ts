import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const td = vi.hoisted(() => {
  const processorRef: { current: ((job: any) => Promise<any>) | null } = { current: null };
  let _redisStatus = "ready";

  class MockIORedis {
    on = td.mockRedisOn;
    disconnect = td.mockRedisDisconnect;
    get status() { return _redisStatus; }
    set status(v: string) { _redisStatus = v; }
  }

  return {
    processorRef,
    MockIORedis,
    setRedisStatus: (v: string) => { _redisStatus = v; },
    mockQueueAdd: vi.fn(),
    mockQueueGetJob: vi.fn(),
    mockQueueClose: vi.fn(),
    mockQueueOn: vi.fn(),
    mockWorkerClose: vi.fn(),
    mockWorkerOn: vi.fn(),
    mockRedisOn: vi.fn(),
    mockRedisDisconnect: vi.fn(),
    mockHandleModelJob: vi.fn(),
    mockHandleCleanJob: vi.fn(),
    mockHandleClimateJob: vi.fn(),
    mockHandleCovariateJob: vi.fn(),
    mockJobEventBusEmit: vi.fn(),
    mockDbUpdate: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    mockEq: vi.fn(),
  };
});

vi.mock("ioredis", () => ({
  default: td.MockIORedis,
}));

vi.mock("bullmq", () => {
  class MockQueue {
    add = td.mockQueueAdd;
    getJob = td.mockQueueGetJob;
    close = td.mockQueueClose;
    on = td.mockQueueOn;
  }
  class MockWorker {
    close = td.mockWorkerClose;
    on = td.mockWorkerOn;
    constructor(_name: string, processor: (job: any) => Promise<any>) {
      td.processorRef.current = processor;
    }
  }
  return { Queue: MockQueue, Worker: MockWorker, Job: {} };
});

vi.mock("./plumber.js", () => {
  class MockPlumberClient {
    withUser = vi.fn(() => new MockPlumberClient());
    runModel = vi.fn();
    cleanOccurrences = vi.fn();
    downloadClimate = vi.fn();
    downloadCovariateBg = vi.fn();
    getModelStatus = vi.fn();
    getJobStatus = vi.fn();
    getClimateStatus = vi.fn();
  }
  return { PlumberClient: MockPlumberClient };
});

vi.mock("../db/index.js", () => ({
  db: { update: td.mockDbUpdate },
}));

vi.mock("../db/schema.js", () => ({
  runs: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: td.mockEq,
}));

vi.mock("./job-events.js", () => ({
  jobEventBus: { emitJobStatus: td.mockJobEventBusEmit },
}));

vi.mock("./queue-model-worker.js", () => ({
  handleModelJob: td.mockHandleModelJob,
}));

vi.mock("./queue-clean-worker.js", () => ({
  handleCleanJob: td.mockHandleCleanJob,
}));

vi.mock("./queue-climate-worker.js", () => ({
  handleClimateJob: td.mockHandleClimateJob,
  handleCovariateJob: td.mockHandleCovariateJob,
}));

const mockJob = (overrides: Record<string, unknown> = {}) => ({
  id: "test-job-1",
  data: {
    type: "model",
    payload: { runId: "run-1" },
    userId: "user-1",
    ...(overrides.data || {}),
  } as { type: string; payload: Record<string, unknown>; userId?: string },
  progress: 0,
  returnvalue: null,
  failedReason: null,
  updateProgress: vi.fn(),
  getState: vi.fn().mockResolvedValue("completed"),
  ...overrides,
});

let queue: Awaited<ReturnType<typeof loadQueue>>;

async function loadQueue() {
  return import("./queue.js");
}

beforeEach(async () => {
  vi.clearAllMocks();
  td.processorRef.current = null;
  td.setRedisStatus("ready");
  queue = await loadQueue();
  queue.resetRedis();
});

afterEach(async () => {
  await queue.shutdownQueue();
});

describe("isRedisUnavailableError", () => {
  it("returns true for ECONNREFUSED message", () => {
    expect(queue.isRedisUnavailableError({ message: "ECONNREFUSED" })).toBe(true);
  });

  it("returns true for ENOTFOUND message", () => {
    expect(queue.isRedisUnavailableError({ message: "ENOTFOUND" })).toBe(true);
  });

  it("returns true for ETIMEDOUT message", () => {
    expect(queue.isRedisUnavailableError({ message: "ETIMEDOUT" })).toBe(true);
  });

  it("returns true for ECONNRESET message", () => {
    expect(queue.isRedisUnavailableError({ message: "ECONNRESET" })).toBe(true);
  });

  it("returns true for ENETUNREACH message", () => {
    expect(queue.isRedisUnavailableError({ message: "ENETUNREACH" })).toBe(true);
  });

  it("returns true for EHOSTUNREACH message", () => {
    expect(queue.isRedisUnavailableError({ message: "EHOSTUNREACH" })).toBe(true);
  });

  it("returns true for EPIPE message", () => {
    expect(queue.isRedisUnavailableError({ message: "EPIPE" })).toBe(true);
  });

  it("returns true for Connection is closed message", () => {
    expect(queue.isRedisUnavailableError({ message: "Connection is closed" })).toBe(true);
  });

  it("returns true for connect ECONNREFUSED message", () => {
    expect(queue.isRedisUnavailableError({ message: "connect ECONNREFUSED" })).toBe(true);
  });

  it("returns false for non-object", () => {
    expect(queue.isRedisUnavailableError(null)).toBe(false);
    expect(queue.isRedisUnavailableError(undefined)).toBe(false);
    expect(queue.isRedisUnavailableError("string")).toBe(false);
  });

  it("returns false for unrelated error", () => {
    expect(queue.isRedisUnavailableError({ message: "SOME_OTHER_ERROR" })).toBe(false);
  });
});

describe("getRedisStatus", () => {
  it("returns status object with connection state", () => {
    const status = queue.getRedisStatus();
    expect(status).toHaveProperty("available");
    expect(status).toHaveProperty("disabled");
    expect(status).toHaveProperty("failCount");
    expect(status).toHaveProperty("reconnectDelayMs");
    expect(status).toHaveProperty("permanentOffline");
  });

  it("reports disabled false when active", () => {
    const status = queue.getRedisStatus();
    expect(status.disabled).toBe(false);
  });
});

describe("getJobQueue", () => {
  it("returns a Queue instance", () => {
    const q = queue.getJobQueue();
    expect(q).not.toBeNull();
  });

  it("returns null when redis is disabled", async () => {
    await queue.shutdownQueue();
    const q = queue.getJobQueue();
    expect(q).toBeNull();
  });
});

describe("enqueueSdmJob", () => {
  it("adds a job to BullMQ queue with correct data", async () => {
    td.mockQueueAdd.mockResolvedValue({ id: "bullmq-job-1" });
    const jobId = await queue.enqueueSdmJob({
      type: "model",
      payload: { runId: "run-1", species: "Test" },
    }, "user-1");

    expect(jobId).toBe("bullmq-job-1");
    expect(td.mockQueueAdd).toHaveBeenCalledWith("sdm-task", {
      type: "model",
      payload: { runId: "run-1", species: "Test" },
      userId: "user-1",
    }, expect.objectContaining({
      attempts: 2,
      backoff: { type: "exponential", delay: 1000 },
    }));
  });

  it("throws when redis is unavailable", async () => {
    await queue.shutdownQueue();
    await expect(queue.enqueueSdmJob({
      type: "model",
      payload: { runId: "run-1" },
    })).rejects.toThrow("Redis unavailable");
  });

  it("calls disableRedis on UE unavailable error", async () => {
    td.mockQueueAdd.mockRejectedValue({ message: "ECONNREFUSED" });
    await expect(queue.enqueueSdmJob({
      type: "model",
      payload: { runId: "run-1" },
    })).rejects.toThrow("Redis unavailable");
    expect(queue.getRedisStatus().disabled).toBe(true);
  });

  it("re-throws non-redis errors", async () => {
    td.mockQueueAdd.mockRejectedValue(new Error("INTERNAL_ERROR"));
    await expect(queue.enqueueSdmJob({
      type: "model",
      payload: { runId: "run-1" },
    })).rejects.toThrow("INTERNAL_ERROR");
  });
});

describe("ensureWorker", () => {
  it("creates a Worker that dispatches model jobs", async () => {
    const worker = queue.ensureWorker();
    expect(worker).not.toBeNull();
    expect(td.processorRef.current).not.toBeNull();

    const job = mockJob({ data: { type: "model", payload: { runId: "run-1" }, userId: "user-1" } });
    td.mockHandleModelJob.mockResolvedValue({ status: "success", data: { metrics: {} } });

    await td.processorRef.current!(job);

    expect(td.mockHandleModelJob).toHaveBeenCalledWith(job, expect.anything(), "user-1", expect.anything());
  });

  it("creates a Worker that dispatches clean jobs", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "clean", payload: { file_id: "f1" }, userId: "user-2" } });
    td.mockHandleCleanJob.mockResolvedValue({ status: "success", data: {} });

    await td.processorRef.current!(job);

    expect(td.mockHandleCleanJob).toHaveBeenCalledWith(job, expect.anything(), "user-2");
  });

  it("creates a Worker that dispatches climate_download jobs", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "climate_download", payload: {} } });
    td.mockHandleClimateJob.mockResolvedValue({ status: "success", data: {} });

    await td.processorRef.current!(job);

    expect(td.mockHandleClimateJob).toHaveBeenCalledWith(job, expect.anything(), undefined);
  });

  it("creates a Worker that dispatches covariate_download jobs", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "covariate_download", payload: {} } });
    td.mockHandleCovariateJob.mockResolvedValue({ status: "success", data: {} });

    await td.processorRef.current!(job);

    expect(td.mockHandleCovariateJob).toHaveBeenCalledWith(job, expect.anything(), undefined);
  });

  it("returns existing worker on subsequent calls", () => {
    const w1 = queue.ensureWorker();
    const w2 = queue.ensureWorker();
    expect(w1).toBe(w2);
  });

  it("handles unknown job type", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "unknown_type", payload: {} } });
    const result = await td.processorRef.current!(job);

    expect(result).toMatchObject({ status: "error", error: "Unknown job type: unknown_type" });
  });

  it("handles errors in job processor for model type", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "model", payload: { runId: "run-1" }, userId: "u-1" } });
    td.mockHandleModelJob.mockRejectedValue(new Error("Model failed"));

    const result = await td.processorRef.current!(job);

    expect(td.mockJobEventBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failed", failedReason: "Model failed" })
    );
    expect(result).toMatchObject({ status: "error", error: "Model failed" });
  });

  it("re-throws timeout-related errors", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "clean", payload: {} } });
    td.mockHandleCleanJob.mockRejectedValue(new Error("timeout"));

    await expect(td.processorRef.current!(job)).rejects.toThrow("timeout");
  });

  it("re-throws ECONNREFUSED errors", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "clean", payload: {} } });
    td.mockHandleCleanJob.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(td.processorRef.current!(job)).rejects.toThrow("ECONNREFUSED");
  });

  it("re-throws 500 errors", async () => {
    queue.ensureWorker();

    const job = mockJob({ data: { type: "clean", payload: {} } });
    td.mockHandleCleanJob.mockRejectedValue(new Error("500"));

    await expect(td.processorRef.current!(job)).rejects.toThrow("500");
  });
});

describe("getJobStatus", () => {
  it("returns status for existing job", async () => {
    td.mockQueueGetJob.mockResolvedValue({
      id: "job-1",
      getState: vi.fn().mockResolvedValue("completed"),
      progress: 100,
      returnvalue: { status: "success" },
      failedReason: null,
    });
    const status = await queue.getJobStatus("job-1");
    expect(status).toEqual({
      id: "job-1",
      state: "completed",
      progress: 100,
      result: { status: "success" },
      failedReason: null,
    });
  });

  it("returns null for non-existent job", async () => {
    td.mockQueueGetJob.mockResolvedValue(null);
    const status = await queue.getJobStatus("non-existent");
    expect(status).toBeNull();
  });

  it("returns null when redis is disabled", async () => {
    await queue.shutdownQueue();
    const status = await queue.getJobStatus("job-1");
    expect(status).toBeNull();
  });

  it("returns null on UE error", async () => {
    td.mockQueueGetJob.mockRejectedValue({ message: "ECONNREFUSED" });
    const status = await queue.getJobStatus("job-1");
    expect(status).toBeNull();
  });

  it("re-throws non-redis errors", async () => {
    td.mockQueueGetJob.mockRejectedValue(new Error("UNEXPECTED"));
    await expect(queue.getJobStatus("job-1")).rejects.toThrow("UNEXPECTED");
  });
});

describe("shutdownQueue", () => {
  it("closes all connections", async () => {
    queue.ensureWorker();
    queue.getJobQueue();

    await queue.shutdownQueue();

    expect(td.mockWorkerClose).toHaveBeenCalled();
    expect(td.mockQueueClose).toHaveBeenCalled();
    expect(td.mockRedisDisconnect).toHaveBeenCalled();

    expect(queue.getRedisStatus().disabled).toBe(true);
  });
});

describe("resetRedis", () => {
  it("resets state and reconnects", async () => {
    await queue.shutdownQueue();
    expect(queue.getRedisStatus().disabled).toBe(true);

    queue.resetRedis();
    const status = queue.getRedisStatus();
    expect(status.disabled).toBe(false);
    expect(status.failCount).toBe(0);

    queue.ensureWorker();
    const q = queue.getJobQueue();
    expect(q).not.toBeNull();
  });
});

describe("Redis unavailable degradation", () => {
  it("shutdown marks redis as disabled", async () => {
    await queue.shutdownQueue();
    expect(queue.getRedisStatus().disabled).toBe(true);
  });
});

describe("constants", () => {
  it("exports CLIMATE_DOWNLOAD_TIMEOUT_MS with default", () => {
    expect(queue.CLIMATE_DOWNLOAD_TIMEOUT_MS).toBe(1800000);
  });

  it("exports MODEL_RUN_TIMEOUT_MS with default", () => {
    expect(queue.MODEL_RUN_TIMEOUT_MS).toBe(7200000);
  });

  it("exports REDIS_UNAVAILABLE_CODES", () => {
    expect(queue.REDIS_UNAVAILABLE_CODES.has("ECONNREFUSED")).toBe(true);
    expect(queue.REDIS_UNAVAILABLE_CODES.has("ENOTFOUND")).toBe(true);
    expect(queue.REDIS_UNAVAILABLE_CODES.has("ETIMEDOUT")).toBe(true);
    expect(queue.REDIS_UNAVAILABLE_CODES.has("ECONNRESET")).toBe(true);
    expect(queue.REDIS_UNAVAILABLE_CODES.has("ENETUNREACH")).toBe(true);
    expect(queue.REDIS_UNAVAILABLE_CODES.has("EHOSTUNREACH")).toBe(true);
    expect(queue.REDIS_UNAVAILABLE_CODES.has("EPIPE")).toBe(true);
  });
});
