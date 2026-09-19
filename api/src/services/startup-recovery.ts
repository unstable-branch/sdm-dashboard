import type { Queue } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { jobEventBus } from "./job-events.js";
import { getJobQueue } from "./queue.js";
import { syncRunningJobs } from "./plumber-sync.js";

export const STARTUP_RECOVERY_GRACE_MS = parseInt(process.env.SDM_STARTUP_GRACE_PERIOD_MS || "60000", 10);
export const RUN_RECOVERY_INTERVAL_MS = parseInt(process.env.SDM_RUN_RECOVERY_INTERVAL_MS || "15000", 10);

type ActiveRunStatus = "queued" | "running";

export interface RecoveryRun {
  id: string;
  status: ActiveRunStatus;
  jobId: string | null;
  bullmqId: string | null;
  createdAt: Date;
  startedAt: Date | null;
}

export interface BullJobSnapshot {
  state: string;
  failedReason?: string | null;
}

export type RecoveryDecision =
  | { action: "none"; reason: string }
  | { action: "promote"; reason: string }
  | { action: "fail"; reason: string; detail: string };

const LIVE_BULL_STATES = new Set([
  "active",
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
]);
const TERMINAL_BULL_STATES = new Set(["completed", "failed"]);

export function decideRunRecovery(
  run: RecoveryRun,
  bull: BullJobSnapshot | null | undefined,
  nowMs = Date.now(),
  graceMs = STARTUP_RECOVERY_GRACE_MS,
): RecoveryDecision {
  if (run.jobId) {
    return run.status === "queued"
      ? { action: "promote", reason: "Plumber job already persisted" }
      : { action: "none", reason: "Plumber reconciliation owns this run" };
  }

  const reference = run.status === "queued" ? run.createdAt : (run.startedAt ?? run.createdAt);
  if (nowMs - reference.getTime() < graceMs) {
    return { action: "none", reason: "within startup grace" };
  }

  if (!run.bullmqId) {
    return {
      action: "fail",
      reason: "missing BullMQ job ID",
      detail: "No BullMQ job or Plumber job was recorded before the recovery grace period expired.",
    };
  }

  if (bull === undefined) {
    return { action: "none", reason: "BullMQ unavailable; deferring recovery" };
  }

  if (bull === null) {
    return {
      action: "fail",
      reason: "BullMQ job missing",
      detail: `BullMQ job ${run.bullmqId} no longer exists and no Plumber job was recorded.`,
    };
  }

  if (LIVE_BULL_STATES.has(bull.state)) {
    return { action: "none", reason: `BullMQ job is ${bull.state}` };
  }

  if (!TERMINAL_BULL_STATES.has(bull.state)) {
    return { action: "none", reason: `BullMQ job state ${bull.state} is not recognized; deferring recovery` };
  }

  const failedReason = bull.failedReason ? ` Last BullMQ error: ${bull.failedReason}` : "";
  return {
    action: "fail",
    reason: `BullMQ job is terminal (${bull.state})`,
    detail: `BullMQ job ${run.bullmqId} reached ${bull.state} without persisting a Plumber job.${failedReason}`,
  };
}

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;

async function inspectBullJob(queue: Queue | null, bullmqId: string | null): Promise<BullJobSnapshot | null | undefined> {
  if (!bullmqId) return null;
  if (!queue) return undefined;
  try {
    const job = await queue.getJob(bullmqId);
    if (!job) return null;
    return { state: await job.getState(), failedReason: job.failedReason };
  } catch (err) {
    console.warn(`[run-recovery] BullMQ inspection deferred for ${bullmqId}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

export async function reconcileQueueBackedRuns(
  queue: Queue | null = getJobQueue(),
  nowMs = Date.now(),
  graceMs = STARTUP_RECOVERY_GRACE_MS,
): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const activeRuns = await db
      .select({
        id: runs.id,
        status: runs.status,
        jobId: runs.jobId,
        bullmqId: runs.bullmqId,
        createdAt: runs.createdAt,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .where(inArray(runs.status, ["queued", "running"]));

    for (const run of activeRuns as RecoveryRun[]) {
      const bull = run.jobId ? undefined : await inspectBullJob(queue, run.bullmqId);
      const decision = decideRunRecovery(run, bull, nowMs, graceMs);

      if (decision.action === "promote") {
        await db
          .update(runs)
          .set({ status: "running" })
          .where(and(eq(runs.id, run.id), eq(runs.status, "queued")));
        continue;
      }

      if (decision.action !== "fail") continue;

      const error = `Model run could not be recovered after restart: ${decision.detail}`;
      const updated = await db
        .update(runs)
        .set({
          status: "failed",
          error,
          errorCode: "WORKER_ORPHAN",
          errorHint: "Retry the run. If this recurs, inspect the retained BullMQ and Plumber logs.",
          completedAt: new Date(nowMs),
        })
        .where(and(eq(runs.id, run.id), inArray(runs.status, ["queued", "running"])))
        .returning({ id: runs.id });

      if (updated.length > 0) {
        jobEventBus.emitJobStatus({
          jobId: run.id,
          state: "failed",
          progress: 0,
          failedReason: error,
          error_code: "WORKER_ORPHAN",
          error_hint: "Retry the run. If this recurs, inspect the retained BullMQ and Plumber logs.",
        });
      }
    }
  } finally {
    _running = false;
  }
}

export async function reconcileRunsAfterStartup(): Promise<void> {
  // Reattach to persisted Plumber jobs first. Queue reconciliation then handles
  // only runs for which no backend job was ever persisted.
  await syncRunningJobs();
  await reconcileQueueBackedRuns();
}

export function startRunRecovery(intervalMs = RUN_RECOVERY_INTERVAL_MS): void {
  if (_interval) return;
  reconcileRunsAfterStartup().catch((err) => {
    console.error("[run-recovery] Startup reconciliation failed:", err instanceof Error ? err.message : err);
  });
  _interval = setInterval(() => {
    reconcileQueueBackedRuns().catch((err) => {
      console.error("[run-recovery] Periodic reconciliation failed:", err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  console.log(`[run-recovery] Started restart recovery every ${intervalMs}ms`);
}

export function stopRunRecovery(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
