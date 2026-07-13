import { Job } from "bullmq";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, or, inArray } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import { syncOutputsToS3 } from "./storage.js";
import { join } from "path";
import { MODEL_RUN_POLL_INTERVAL_MS, MODEL_RUN_MAX_ATTEMPTS, SdmJobData, SdmJobResult } from "./queue.js";

export async function handleModelJob(
  job: Job<SdmJobData, SdmJobResult>,
  client: PlumberClient,
  _userId: string | undefined,
  cpuStart: NodeJS.CpuUsage | undefined,
): Promise<SdmJobResult> {
  const { payload } = job.data;
  const runId = payload.runId as string | undefined;

  if (runId) {
    await db
      .update(runs)
      .set({ status: "running", startedAt: new Date(), bullmqId: job.id! })
      .where(and(eq(runs.id, runId), or(eq(runs.status, "queued"), eq(runs.status, "failed"))));
  }

  let modelRes: Record<string, unknown>;
  try {
    modelRes = await client.runModel(payload);
  } catch (runErr) {
    const runErrMsg = runErr instanceof Error ? runErr.message : String(runErr);
    console.error(`[queue] Model run failed: ${runErrMsg}`);
    if (runId) {
      await db
        .update(runs)
        .set({ status: "failed", completedAt: new Date(), error: runErrMsg })
        .where(eq(runs.id, runId));
    }
    jobEventBus.emitJobStatus({
      jobId: runId ?? job.id!,
      state: "failed",
      progress: 0,
      failedReason: runErrMsg,
    });
    return { status: "error", error: runErrMsg, error_code: "MODEL_RUN_FAILED" };
  }
  const plumberJobId = modelRes.job_id as string | undefined;

  if (runId) {
    const cpuDelta = cpuStart ? process.cpuUsage(cpuStart) : undefined;
    await db
      .update(runs)
      .set({
        jobId: plumberJobId ?? null,
        bullmqId: job.id!,
        rCpuTimeMs: cpuDelta ? Math.round((cpuDelta.user + cpuDelta.system) / 1000) : null,
        peakMemoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      })
      .where(eq(runs.id, runId));
  }

  await job.updateProgress(30);

  if (plumberJobId) {
    await job.updateProgress(35);
    jobEventBus.emitJobStatus({
      jobId: runId ?? job.id!,
      state: "active",
      progress: 35,
      logs: ["Model run submitted to Plumber, waiting for completion..."],
    });

    let modelStatus: Record<string, unknown> = {};
    let modelCompleted = false;
    let modelAttempts = 0;

    while (!modelCompleted && modelAttempts < MODEL_RUN_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, MODEL_RUN_POLL_INTERVAL_MS));
      modelAttempts++;

      try {
        modelStatus = await client.getModelStatus(plumberJobId);
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
        }

        if (pollState === "completed") {
          modelCompleted = true;
          const metrics = modelStatus.metrics as Record<string, unknown> | undefined;

          if (runId) {
            const [currentRun] = await db
              .select({ status: runs.status })
              .from(runs)
              .where(eq(runs.id, runId))
              .limit(1);
            if (currentRun && currentRun.status !== "running") { modelCompleted = true; break; }
          }

          const outputFiles = modelStatus.output_files as Record<string, string> | undefined;
          let syncWarning: string | undefined;
          if (outputFiles && runId) {
            const jobDir = join("outputs", "jobs", runId);
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
              await syncOutputsToS3(jobDir, runId, outputFiles);
            } catch (err) {
              syncWarning = err instanceof Error ? err.message : String(err);
              console.warn(`[S3] Output sync failed for run ${runId}:`, err);
            }
          }

          if (runId) {
            await db
              .update(runs)
              .set({
                status: "completed",
                completedAt: new Date(),
                error: null,
                metrics: metrics as Record<string, unknown>,
              })
              .where(and(eq(runs.id, runId), inArray(runs.status, ["running", "queued"])));
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
        } else if (pollState === "cancelled") {
          modelCompleted = true;
          if (runId) {
            await db
              .update(runs)
              .set({ status: "cancelled", completedAt: new Date() })
              .where(and(eq(runs.id, runId), inArray(runs.status, ["running", "queued"])));
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
        } else if (pollState === "failed" || pollState === "error") {
          // Guard: skip if another process already transitioned this run
          if (runId) {
            const [currentRun] = await db
              .select({ status: runs.status })
              .from(runs)
              .where(eq(runs.id, runId))
              .limit(1);
            if (currentRun && currentRun.status !== "running") { modelCompleted = true; break; }
          }
          modelCompleted = true;
          const errMsg = (modelStatus.error as string) || "Model run failed";
          const errCode = modelStatus.error_code as string | undefined;
          const errHint = modelStatus.error_hint as string | undefined;
          if (runId) {
            await db
              .update(runs)
              .set({
                status: "failed",
                completedAt: new Date(),
                error: errMsg,
                provenance: errCode ? { error_code: errCode, error_hint: errHint ?? null } : undefined,
              })
              .where(and(eq(runs.id, runId), inArray(runs.status, ["running", "queued"])));
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
      }
    }

    if (!modelCompleted) {
      const timeoutMsg = "Model run polling timeout — Plumber did not complete in time";
      if (runId) {
        await db
          .update(runs)
          .set({ status: "failed", completedAt: new Date(), error: timeoutMsg })
          .where(eq(runs.id, runId));
      }
      jobEventBus.emitJobStatus({
        jobId: runId ?? job.id!,
        state: "failed",
        progress: 0,
        failedReason: timeoutMsg,
      });
      return { status: "error", error: timeoutMsg, error_code: "PLUMBER_TIMEOUT" };
    }
  } else {
    const runIdElse = (job.data.payload as Record<string, unknown>)?.runId as string | undefined;
    const outputFiles = modelRes.output_files as Record<string, string> | undefined;
    let syncWarning: string | undefined;
    if (outputFiles && runIdElse) {
      await job.updateProgress(99);
      try {
        await syncOutputsToS3(join("outputs", "jobs", runIdElse), runIdElse, outputFiles);
      } catch (err) {
        syncWarning = err instanceof Error ? err.message : String(err);
        console.warn(`[S3] Output sync failed for run ${runIdElse}:`, err);
      }
    }
    await job.updateProgress(100);
    jobEventBus.emitJobStatus({
      jobId: runIdElse ?? job.id!,
      state: "completed",
      progress: 100,
      logs: syncWarning ? [`Output sync warning: ${syncWarning}`] : undefined,
      result: modelRes,
    });
    return { status: "success", data: modelRes };
  }

  return { status: "error", error: "Job processing failed" };
}
