import { beforeEach, describe, expect, it, vi } from "vitest";

const td = vi.hoisted(() => ({
  run: null as null | Record<string, any>,
  updates: [] as Array<Record<string, unknown>>,
  emit: vi.fn(),
  getModelStatus: vi.fn(),
  cancelBeforeCompletionUpdate: false,
}));

vi.mock("./plumber.js", () => ({
  PlumberClient: class {
    getModelStatus = td.getModelStatus;
    targetsStatus = td.getModelStatus;
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: (resolve: (value: Array<Record<string, unknown>>) => unknown) => {
            const run = td.run;
            const recoverable = run && (run.status === "running"
              || (run.status === "failed" && ["PLUMBER_TIMEOUT", "PROCESS_CRASH"].includes(run.errorCode)));
            return Promise.resolve(resolve(recoverable ? [run] : []));
          },
          limit: vi.fn(async () => td.run ? [{ status: td.run.status, errorCode: td.run.errorCode }] : []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (!td.run || td.run.status === "completed") return [];
            if (values.status === "completed" && td.cancelBeforeCompletionUpdate) {
              td.run.status = "cancelled";
            }
            if (values.status === "completed" && td.run.status === "cancelled") return [];
            Object.assign(td.run, values);
            td.updates.push(values);
            return [{ id: td.run.id }];
          }),
        })),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  runs: {
    id: "id", jobId: "jobId", status: "status", startedAt: "startedAt", completedAt: "completedAt",
    projectId: "projectId", errorCode: "errorCode", error: "error", errorHint: "errorHint",
  },
  projects: { id: "id", ownerId: "ownerId" },
  users: { id: "id", storageUsedBytes: "storageUsedBytes" },
  batches: { id: "id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

vi.mock("./job-events.js", () => ({ jobEventBus: { emitJobStatus: td.emit } }));
vi.mock("./storage.js", () => ({
  uploadFile: vi.fn(),
  getBucketNames: vi.fn(() => ({ rasters: "rasters" })),
  getDirSize: vi.fn(() => 0),
}));
vi.mock("./encryption.js", () => ({ encrypt: vi.fn((value: Buffer) => value) }));

import { syncRunningJobs } from "./plumber-sync.js";

describe("Plumber terminal reconciliation", () => {
  beforeEach(() => {
    td.run = {
      id: "run-1",
      jobId: "run-run-1",
      status: "failed",
      errorCode: "PLUMBER_TIMEOUT",
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      completedAt: new Date(),
      projectId: null,
    };
    td.updates.length = 0;
    td.emit.mockReset();
    td.cancelBeforeCompletionUpdate = false;
    td.getModelStatus.mockReset().mockResolvedValue({
      status: "completed",
      metrics: { auc: 0.91 },
      output_files: { tif: "result.tif" },
      progress_log: ["complete"],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  });

  it("recovers a timed-out DB run when Plumber later reports completion exactly once", async () => {
    await syncRunningJobs();
    await syncRunningJobs();

    expect(td.run).toMatchObject({
      status: "completed",
      error: null,
      errorCode: null,
      metrics: { auc: 0.91 },
      outputFiles: { tif: "result.tif" },
    });
    expect(td.updates.filter((update) => update.status === "completed")).toHaveLength(1);
    expect(td.getModelStatus).toHaveBeenCalledTimes(1);
    expect(td.emit).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a cancellation committed after the status recheck", async () => {
    td.run!.status = "running";
    td.run!.errorCode = null;
    td.run!.startedAt = new Date();
    td.cancelBeforeCompletionUpdate = true;

    await syncRunningJobs();

    expect(td.run!.status).toBe("cancelled");
    expect(td.updates.filter((update) => update.status === "completed")).toHaveLength(0);
    expect(td.emit).not.toHaveBeenCalled();
  });
});
