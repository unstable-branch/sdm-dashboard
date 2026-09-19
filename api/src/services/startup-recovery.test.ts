import { beforeEach, describe, expect, it, vi } from "vitest";

const td = vi.hoisted(() => ({
  activeRuns: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  emit: vi.fn(),
  syncRunningJobs: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => td.activeRuns),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        td.updates.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: "updated" }]),
          })),
        };
      }),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  runs: {
    id: "id",
    status: "status",
    jobId: "jobId",
    bullmqId: "bullmqId",
    createdAt: "createdAt",
    startedAt: "startedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
}));

vi.mock("./job-events.js", () => ({
  jobEventBus: { emitJobStatus: td.emit },
}));

vi.mock("./queue.js", () => ({
  getJobQueue: vi.fn(() => null),
}));

vi.mock("./plumber-sync.js", () => ({
  syncRunningJobs: td.syncRunningJobs,
}));

import {
  decideRunRecovery,
  reconcileQueueBackedRuns,
  reconcileRunsAfterStartup,
  type RecoveryRun,
} from "./startup-recovery.js";

const oldRun = (overrides: Partial<RecoveryRun> = {}): RecoveryRun => ({
  id: "run-1",
  status: "queued",
  jobId: null,
  bullmqId: "bull-1",
  createdAt: new Date(0),
  startedAt: null,
  ...overrides,
});

describe("restart recovery decisions", () => {
  it("does not orphan freshly queued work during startup grace", () => {
    const run = oldRun({ createdAt: new Date(9_500) });
    expect(decideRunRecovery(run, null, 10_000, 1_000)).toMatchObject({ action: "none" });
  });

  it("fails an old queued run whose BullMQ job is missing", () => {
    expect(decideRunRecovery(oldRun(), null, 10_000, 1_000)).toMatchObject({
      action: "fail",
      reason: "BullMQ job missing",
    });
  });

  it("fails a run after a terminal failed BullMQ job and retains its diagnostic", () => {
    const decision = decideRunRecovery(oldRun(), { state: "failed", failedReason: "worker crashed" }, 10_000, 1_000);
    expect(decision).toMatchObject({ action: "fail" });
    expect(decision.action === "fail" && decision.detail).toContain("worker crashed");
  });

  it("fails an inconsistent completed BullMQ job with no persisted Plumber job", () => {
    expect(decideRunRecovery(oldRun(), { state: "completed" }, 10_000, 1_000)).toMatchObject({
      action: "fail",
      reason: "BullMQ job is terminal (completed)",
    });
  });

  it("defers unknown BullMQ states instead of guessing they are terminal", () => {
    expect(decideRunRecovery(oldRun(), { state: "unknown-new-state" }, 10_000, 1_000)).toMatchObject({
      action: "none",
    });
  });

  it("defers while BullMQ is live or unavailable", () => {
    expect(decideRunRecovery(oldRun(), { state: "active" }, 10_000, 1_000).action).toBe("none");
    expect(decideRunRecovery(oldRun(), undefined, 10_000, 1_000).action).toBe("none");
  });

  it("promotes a queued run with a persisted Plumber job for resumed polling", () => {
    expect(decideRunRecovery(oldRun({ jobId: "plumber-1" }), undefined, 10_000, 1_000)).toMatchObject({
      action: "promote",
    });
  });
});

describe("restart recovery service", () => {
  beforeEach(() => {
    td.activeRuns = [];
    td.updates.length = 0;
    td.emit.mockReset();
    td.syncRunningJobs.mockReset();
  });

  it("marks a missing BullMQ/Plumber orphan failed with user-visible diagnostics", async () => {
    td.activeRuns = [{ ...oldRun() }];
    const queue = { getJob: vi.fn(async () => null) } as unknown as Parameters<typeof reconcileQueueBackedRuns>[0];

    await reconcileQueueBackedRuns(queue, 10_000, 1_000);

    expect(td.updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorCode: "WORKER_ORPHAN",
    }));
    expect(td.emit).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "run-1",
      state: "failed",
      error_code: "WORKER_ORPHAN",
    }));
  });

  it("does not fail runs when Redis is unavailable", async () => {
    td.activeRuns = [{ ...oldRun() }];
    await reconcileQueueBackedRuns(null, 10_000, 1_000);
    expect(td.updates).toHaveLength(0);
  });

  it("reattaches Plumber jobs before checking BullMQ startup ownership", async () => {
    await reconcileRunsAfterStartup();
    expect(td.syncRunningJobs).toHaveBeenCalledTimes(1);
  });
});
