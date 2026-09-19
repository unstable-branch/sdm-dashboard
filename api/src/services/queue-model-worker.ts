import { Job } from "bullmq";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import { syncOutputsToS3 } from "./storage.js";
import { join } from "path";
import { MODEL_RUN_POLL_INTERVAL_MS, MODEL_RUN_MAX_ATTEMPTS, SdmJobData, SdmJobResult } from "./queue.js";
import { completedRunFields } from "./completed-run.js";

type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface RunState {
  status: RunStatus;
  jobId: string | null;
  bullmqId: string | null;
}

const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running"];
const COMPLETION_RECONCILABLE_STATUSES: RunStatus[] = ["queued", "running", "failed", "cancelled"];

function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function terminalNoop(runId: string, status: RunStatus): SdmJobResult {
  return {
    status: "success",
    data: { run_id: runId, run_status: status, duplicate_delivery: true },
  };
}

async function getRunState(runId: string): Promise<RunState | null> {
  const [run] = await db
    .select({ status: runs.status, jobId: runs.jobId, bullmqId: runs.bullmqId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return run ?? null;
}

async function claimRun(runId: string, bullmqId: string, current: RunState): Promise<boolean> {
  if (current.status === "queued") {
    const claimed = await db
      .update(runs)
      .set({ status: "running", startedAt: new Date(), bullmqId })
      .where(and(eq(runs.id, runId), eq(runs.status, "queued")))
      .returning({ id: runs.id });
    return claimed.length > 0;
  }

  if (current.status !== "running") return false;
  if (current.jobId || current.bullmqId === bullmqId) return true;
  if (current.bullmqId) return false;

  const claimed = await db
    .update(runs)
    .set({ bullmqId })
    .where(and(eq(runs.id, runId), eq(runs.status, "running"), isNull(runs.bullmqId)))
    .returning({ id: runs.id });
  return claimed.length > 0;
}

async function stopBackendAfterLostClaim(client: PlumberClient, plumberJobId: string, status: RunStatus): Promise<void> {
  if (status !== "cancelled") return;
  try {
    await client.cancelModel(plumberJobId);
  } catch (err) {
    console.warn(`[queue] Failed to cancel backend job ${plumberJobId} after a concurrent cancellation:`, err);
  }
}

export async function handleModelJob(
  job: Job<SdmJobData, SdmJobResult>,
  client: PlumberClient,
  _userId: string | undefined,
  cpuStart: NodeJS.CpuUsage | undefined,
): Promise<SdmJobResult> {
  const { payload } = job.data;
  const runId = payload.runId as string | undefined;
  const bullmqId = job.id ?? runId ?? "unknown";

  let current: RunState | null = null;
  let plumberJobId: string | undefined;

  if (runId) {
    current = await getRunState(runId);
    if (!current) throw new Error(`Run ${runId} not found`);
    if (isTerminalStatus(current.status)) return terminalNoop(runId, current.status);

    plumberJobId = current.jobId ?? undefined;
    if (!plumberJobId) {
      const claimed = await claimRun(runId, bullmqId, current);
      if (!claimed) {
        current = await getRunState(runId);
        if (!current) throw new Error(`Run ${runId} disappeared while claiming work`);
        if (isTerminalStatus(current.status)) return terminalNoop(runId, current.status);
        if (current.jobId) plumberJobId = current.jobId;
        else if (current.bullmqId !== bullmqId) {
          return {
            status: "success",
            data: { run_id: runId, run_status: current.status, duplicate_delivery: true },
          };
        }
      }
    }
  }

  let modelRes: Record<string, unknown> = plumberJobId
    ? { job_id: plumberJobId, status: "running", resumed: true }
    : {};

  if (!plumberJobId) {
    modelRes = await client.runModel(payload);
    plumberJobId = modelRes.job_id as string | undefined;
    if (!plumberJobId) {
      throw new Error("Plumber accepted the model run without returning a job_id");
    }

    if (runId) {
      const cpuDelta = cpuStart ? process.cpuUsage(cpuStart) : undefined;
      const persisted = await db
        .update(runs)
        .set({
          jobId: plumberJobId,
          bullmqId,
          rCpuTimeMs: cpuDelta ? Math.round((cpuDelta.user + cpuDelta.system) / 1000) : null,
          peakMemoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        })
        .where(and(eq(runs.id, runId), eq(runs.status, "running"), eq(runs.bullmqId, bullmqId)))
        .returning({ id: runs.id });

      if (persisted.length === 0) {
        const latest = await getRunState(runId);
        if (!latest) throw new Error(`Run ${runId} disappeared after Plumber submission`);
        await stopBackendAfterLostClaim(client, plumberJobId, latest.status);
        if (isTerminalStatus(latest.status)) return terminalNoop(runId, latest.status);
        if (latest.jobId) plumberJobId = latest.jobId;
        else throw new Error(`Run ${runId} lost its worker claim after Plumber submission`);
      }
    }
  } else if (runId) {
    await db
      .update(runs)
      .set({ status: "running", bullmqId })
      .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_RUN_STATUSES)));
  }

  await job.updateProgress(35);
  jobEventBus.emitJobStatus({
    jobId: runId ?? job.id!,
    state: "active",
    progress: 35,
    logs: [modelRes.resumed ? "Resuming existing Plumber model run..." : "Model run submitted to Plumber, waiting for completion..."],
  });

  let modelAttempts = 0;
  while (modelAttempts < MODEL_RUN_MAX_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, MODEL_RUN_POLL_INTERVAL_MS));
    modelAttempts++;

    if (runId) {
      const latest = await getRunState(runId);
      if (!latest) throw new Error(`Run ${runId} disappeared while polling`);
      if (latest.status === "completed") {
        return terminalNoop(runId, latest.status);
      }
    }

    try {
      const modelStatus = await client.getModelStatus(plumberJobId);
      const pollState = modelStatus.status as string | undefined;
      const logs = Array.isArray(modelStatus.progress_log)
        ? (modelStatus.progress_log as string[])
        : [];
      const pollProgressJson = modelStatus.progress_json;
      const pollCurrentStage = modelStatus.last_stage as string | undefined;

      const pollProgress = (() => {
        if (Array.isArray(pollProgressJson) && pollProgressJson.length > 0) {
          const last = pollProgressJson[pollProgressJson.length - 1] as { percent?: number } | undefined;
          if (last && typeof last.percent === "number") return Math.round(last.percent * 100);
        }
        for (let i = logs.length - 1; i >= 0; i--) {
          const p = extractProgressPercent(logs[i]);
          if (p !== undefined) return p;
        }
        return undefined;
      })();

      if (pollState === "loading" || pollState === "pending") {
        jobEventBus.emitJobStatus({
          jobId: runId ?? job.id!,
          state: pollState,
          progress: pollProgress ?? 5,
          logs,
          currentStage: pollCurrentStage ?? (pollState === "loading" ? "Loading modules" : "Queued"),
          progressJson: pollProgressJson ?? null,
        });
        continue;
      }

      if (pollState === "running") {
        if (runId) {
          const latest = await getRunState(runId);
          if (latest?.status === "cancelled") return terminalNoop(runId, "cancelled");
        }
        const runningProgress = Math.min(99, pollProgress ?? Math.min(90, 35 + Math.round(modelAttempts * 0.5)));
        await job.updateProgress(runningProgress);
        jobEventBus.emitJobStatus({
          jobId: runId ?? job.id!,
          state: "active",
          progress: runningProgress,
          logs,
          currentStage: pollCurrentStage ?? null,
          progressJson: pollProgressJson ?? null,
        });
        continue;
      }

      if (pollState === "completed") {
        const completed = await completedRunFields(client, plumberJobId, modelStatus);
        let syncWarning: string | undefined;
        if (completed.outputFiles && runId) {
          const jobDir = join("outputs", "jobs", plumberJobId);
          await job.updateProgress(99);
          jobEventBus.emitJobStatus({
            jobId: runId,
            state: "active",
            progress: 99,
            logs: logs.concat(["Synchronising completed outputs..."]),
            currentStage: "sync",
            result: modelStatus,
            progressJson: pollProgressJson ?? null,
          });
          try {
            await syncOutputsToS3(jobDir, runId, completed.outputFiles);
          } catch (err) {
            syncWarning = err instanceof Error ? err.message : String(err);
            console.warn(`[S3] Output sync failed for run ${runId}:`, err);
          }
        }

        if (runId) {
          const completedRows = await db
            .update(runs)
            .set({
              status: "completed",
              completedAt: new Date(),
              error: null,
              errorCode: null,
              errorHint: null,
              metrics: completed.metrics,
              outputFiles: completed.outputFiles,
              provenance: completed.provenance,
            })
            .where(and(eq(runs.id, runId), inArray(runs.status, COMPLETION_RECONCILABLE_STATUSES)))
            .returning({ id: runs.id });
          if (completedRows.length === 0) {
            const latest = await getRunState(runId);
            if (latest) return terminalNoop(runId, latest.status);
            throw new Error(`Run ${runId} disappeared while persisting completion`);
          }
        }

        await job.updateProgress(100);
        jobEventBus.emitJobStatus({
          jobId: runId ?? job.id!,
          state: "completed",
          progress: 100,
          logs: logs.concat(syncWarning ? [`Output sync warning: ${syncWarning}`, "Model run completed."] : ["Model run completed."]),
          currentStage: null,
          result: modelStatus,
          error_code: modelStatus.error_code as string | null | undefined,
          error_hint: modelStatus.error_hint as string | null | undefined,
          progressJson: pollProgressJson ?? null,
        });
        return { status: "success", data: modelStatus };
      }

      if (pollState === "cancelled") {
        let updated = true;
        if (runId) {
          const rows = await db
            .update(runs)
            .set({ status: "cancelled", completedAt: new Date() })
            .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_RUN_STATUSES)))
            .returning({ id: runs.id });
          updated = rows.length > 0;
          if (!updated) {
            const latest = await getRunState(runId);
            if (latest) return terminalNoop(runId, latest.status);
          }
        }
        const cancelledProgress = Math.min(99, pollProgress ?? 0);
        await job.updateProgress(cancelledProgress);
        jobEventBus.emitJobStatus({
          jobId: runId ?? job.id!,
          state: "cancelled",
          progress: cancelledProgress,
          currentStage: null,
          failedReason: "Model run cancelled by user",
          error_code: "CANCELLED",
          error_hint: null,
          progressJson: pollProgressJson ?? null,
        });
        return { status: "error", error: "Cancelled", error_code: "CANCELLED" };
      }

      if (pollState === "failed" || pollState === "error") {
        const errMsg = (modelStatus.error as string) || "Model run failed";
        const errCode = modelStatus.error_code as string | undefined;
        const errHint = modelStatus.error_hint as string | undefined;
        if (runId) {
          const updated = await db
            .update(runs)
            .set({
              status: "failed",
              completedAt: new Date(),
              error: errMsg,
              errorCode: errCode ?? null,
              errorHint: errHint ?? null,
              provenance: errCode ? { error_code: errCode, error_hint: errHint ?? null } : undefined,
            })
            .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_RUN_STATUSES)))
            .returning({ id: runs.id });
          if (updated.length === 0) {
            const latest = await getRunState(runId);
            if (latest) return terminalNoop(runId, latest.status);
          }
        }
        const failedProgress = Math.min(99, pollProgress ?? 0);
        await job.updateProgress(failedProgress);
        jobEventBus.emitJobStatus({
          jobId: runId ?? job.id!,
          state: "failed",
          progress: failedProgress,
          currentStage: null,
          failedReason: errMsg,
          error_code: errCode ?? null,
          error_hint: errHint ?? null,
          progressJson: pollProgressJson ?? null,
        });
        return { status: "error", error: errMsg, error_code: errCode ?? null, error_hint: errHint ?? null };
      }
    } catch (pollErr) {
      const pollMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
      console.warn(`[queue] Polling error for model job ${job.id}: ${pollMsg}`);
      if (runId) {
        const latest = await getRunState(runId);
        if (latest && isTerminalStatus(latest.status)) return terminalNoop(runId, latest.status);
      }
    }
  }

  const timeoutMsg = "Model run polling timeout — Plumber did not complete in time";
  if (runId) {
    const updated = await db
      .update(runs)
      .set({ status: "failed", completedAt: new Date(), error: timeoutMsg, errorCode: "PLUMBER_TIMEOUT" })
      .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_RUN_STATUSES)))
      .returning({ id: runs.id });
    if (updated.length === 0) {
      const latest = await getRunState(runId);
      if (latest) return terminalNoop(runId, latest.status);
    }
  }
  jobEventBus.emitJobStatus({
    jobId: runId ?? job.id!,
    state: "failed",
    progress: 0,
    failedReason: timeoutMsg,
  });
  return { status: "error", error: timeoutMsg, error_code: "PLUMBER_TIMEOUT" };
}
