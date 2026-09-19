import { beforeEach, describe, expect, it, vi } from "vitest";

const td = vi.hoisted(() => ({
  run: null as null | { id: string; status: string; jobId: string | null; bullmqId: string | null; [key: string]: unknown },
  updates: [] as Array<Record<string, unknown>>,
  emit: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => td.run ? [td.run] : []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          td.updates.push(values);
          if (td.run) Object.assign(td.run, values);
          return {
            returning: vi.fn(async () => td.run ? [{ id: td.run.id }] : []),
          };
        }),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  runs: {
    id: "id",
    status: "status",
    jobId: "jobId",
    bullmqId: "bullmqId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((arg: unknown) => arg),
}));

vi.mock("./queue.js", () => ({
  MODEL_RUN_POLL_INTERVAL_MS: 0,
  MODEL_RUN_MAX_ATTEMPTS: 3,
}));

vi.mock("./job-events.js", () => ({
  jobEventBus: { emitJobStatus: td.emit },
}));

vi.mock("./storage.js", () => ({
  syncOutputsToS3: td.sync,
}));

vi.mock("./completed-run.js", () => ({
  completedRunFields: vi.fn(async (_client, _jobId, status) => ({
    metrics: status.metrics ?? {},
    outputFiles: status.output_files ?? null,
    provenance: { recovered: true },
  })),
}));

import { handleModelJob } from "./queue-model-worker.js";

const makeJob = (id = "bull-1") => ({
  id,
  data: { type: "model", payload: { runId: "run-1", species: "Test" }, userId: "user-1" },
  updateProgress: vi.fn(async () => {}),
} as unknown as Parameters<typeof handleModelJob>[0]);

const makeClient = () => {
  const client = {
    runModel: vi.fn(async () => ({ job_id: "plumber-1" })),
    getModelStatus: vi.fn(async (): Promise<Record<string, unknown>> => ({
      status: "completed",
      metrics: { auc: 0.9 },
      output_files: { tif: "x.tif" },
    })),
    cancelModel: vi.fn(async () => ({ ok: true, status: "cancelled", message: "cancelled" })),
    getOutputManifest: vi.fn(async () => ({ manifest: {} })),
  };
  return client as typeof client & Parameters<typeof handleModelJob>[1];
};

describe("model worker restart recovery", () => {
  beforeEach(() => {
    td.run = { id: "run-1", status: "queued", jobId: null, bullmqId: null };
    td.updates.length = 0;
    td.emit.mockReset();
    td.sync.mockReset();
  });

  it("treats duplicate delivery of a completed run as a no-op success", async () => {
    td.run!.status = "completed";
    td.run!.jobId = "plumber-1";
    const client = makeClient();

    const result = await handleModelJob(makeJob(), client, "user-1", undefined);

    expect(result).toMatchObject({ status: "success", data: { run_status: "completed", duplicate_delivery: true } });
    expect(client.runModel).not.toHaveBeenCalled();
    expect(client.getModelStatus).not.toHaveBeenCalled();
  });

  it("resumes an existing Plumber job after worker restart without resubmitting", async () => {
    td.run!.status = "running";
    td.run!.jobId = "plumber-existing";
    td.run!.bullmqId = "bull-old";
    const client = makeClient();

    const result = await handleModelJob(makeJob("bull-retry"), client, "user-1", undefined);

    expect(result.status).toBe("success");
    expect(client.runModel).not.toHaveBeenCalled();
    expect(client.getModelStatus).toHaveBeenCalledWith("plumber-existing");
    expect(td.run!.status).toBe("completed");
    expect(td.run!.outputFiles).toEqual({ tif: "x.tif" });
  });

  it("keeps polling a persisted Plumber job after a transient status error without resubmitting", async () => {
    td.run!.status = "running";
    td.run!.jobId = "plumber-existing";
    td.run!.bullmqId = "bull-1";
    const client = makeClient();
    client.getModelStatus
      .mockRejectedValueOnce(new Error("temporary Plumber disconnect"))
      .mockResolvedValueOnce({ status: "completed", metrics: { auc: 0.9 }, output_files: { tif: "x.tif" } });

    const result = await handleModelJob(makeJob(), client, "user-1", undefined);

    expect(result.status).toBe("success");
    expect(client.runModel).not.toHaveBeenCalled();
    expect(client.getModelStatus).toHaveBeenCalledTimes(2);
    expect(td.run!.status).toBe("completed");
  });

  it("suppresses a second BullMQ delivery while another worker owns submission", async () => {
    td.run!.status = "running";
    td.run!.bullmqId = "bull-owner";
    const client = makeClient();

    const result = await handleModelJob(makeJob("bull-duplicate"), client, "user-1", undefined);

    expect(result).toMatchObject({ status: "success", data: { duplicate_delivery: true } });
    expect(client.runModel).not.toHaveBeenCalled();
  });

  it("retries the owning BullMQ job through Plumber's idempotent submission key", async () => {
    td.run!.status = "running";
    td.run!.bullmqId = "bull-1";
    const client = makeClient();

    await handleModelJob(makeJob("bull-1"), client, "user-1", undefined);

    expect(client.runModel).toHaveBeenCalledTimes(1);
    expect(td.run!.jobId).toBe("plumber-1");
    expect(td.run!.status).toBe("completed");
  });

  it("surfaces backend process-death diagnostics and terminates the DB run", async () => {
    td.run!.status = "running";
    td.run!.jobId = "plumber-dead";
    td.run!.bullmqId = "bull-1";
    const client = makeClient();
    client.getModelStatus.mockResolvedValueOnce({
      status: "failed",
      error: "Process crashed or was killed (OOM)",
      error_code: "PROCESS_CRASH",
      error_hint: "Reduce raster resolution",
      progress_log: ["loading covariates"],
    });

    const result = await handleModelJob(makeJob(), client, "user-1", undefined);

    expect(result).toMatchObject({ status: "error", error_code: "PROCESS_CRASH" });
    expect(td.run).toMatchObject({
      status: "failed",
      error: "Process crashed or was killed (OOM)",
      errorCode: "PROCESS_CRASH",
      errorHint: "Reduce raster resolution",
    });
    expect(td.emit).toHaveBeenCalledWith(expect.objectContaining({
      state: "failed",
      failedReason: "Process crashed or was killed (OOM)",
    }));
  });
});
