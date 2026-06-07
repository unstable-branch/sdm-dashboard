import { Job } from "bullmq";
import { PlumberClient } from "./plumber.js";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import { CLIMATE_DOWNLOAD_POLL_INTERVAL_MS, CLIMATE_DOWNLOAD_MAX_ATTEMPTS, SdmJobData, SdmJobResult } from "./queue.js";

export async function handleClimateJob(
  job: Job<SdmJobData, SdmJobResult>,
  client: PlumberClient,
  _userId: string | undefined,
): Promise<SdmJobResult> {
  const { payload } = job.data;

  await job.updateProgress(10);
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: 10 });

  const downloadRes = await client.downloadClimate(payload);
  const climateJobId = downloadRes.job_id as string | undefined;

  await job.updateProgress(20);
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: 20 });

  if (climateJobId) {
    let status: Record<string, unknown> = {};
    let completed = false;
    let attempts = 0;

    while (!completed && attempts < CLIMATE_DOWNLOAD_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CLIMATE_DOWNLOAD_POLL_INTERVAL_MS));
      attempts++;

      try {
        status = await client.getClimateStatus(climateJobId);
        const runStatus = status.status as string | undefined;
        const logs = Array.isArray(status.progress_log) ? (status.progress_log as string[]) : [];

        if (runStatus === "running" || runStatus === "partial") {
          const pct = (() => {
            for (let i = logs.length - 1; i >= 0; i--) {
              const p = extractProgressPercent(logs[i]);
              if (p !== undefined) return p;
            }
            return Math.min(90, 10 + Math.round(logs.length * 0.4));
          })();
          await job.updateProgress(pct);
          jobEventBus.emitJobStatus({
            jobId: job.id!,
            state: runStatus,
            progress: pct,
            logs,
          });
        }

        if (runStatus === "completed" || runStatus === "failed" || runStatus === "partial") {
          completed = true;
          const error = status.error as string | undefined;
          const failedVars = status.failed_vars as number[] | undefined;

          if (runStatus === "partial") {
            await job.updateProgress(100);
            jobEventBus.emitJobStatus({
              jobId: job.id!,
              state: "completed",
              progress: 100,
              logs,
              result: status,
              failedReason: error || undefined,
            });

            if (failedVars && failedVars.length > 0) {
              jobEventBus.emitJobStatus({
                jobId: job.id!,
                state: "warning",
                progress: 100,
                result: { ...status, failed_vars: failedVars },
                failedReason: `Failed layers: ${failedVars.join(", ")}`,
              });
            }

            return { status: "success", data: status, error: error || "Some layers failed to download" };
          } else {
            await job.updateProgress(100);
            jobEventBus.emitJobStatus({
              jobId: job.id!,
              state: runStatus,
              progress: 100,
              logs,
              result: status,
              failedReason: error,
            });

            if (failedVars && failedVars.length > 0) {
              jobEventBus.emitJobStatus({
                jobId: job.id!,
                state: "warning",
                progress: 100,
                result: { ...status, failed_vars: failedVars },
                failedReason: `Failed layers: ${failedVars.join(", ")}`,
              });
            }

            return {
              status: runStatus === "completed" ? "success" : "error",
              data: status,
              error,
            };
          }
        }
      } catch (pollErr) {
        const pollMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
        console.warn(`[queue] Polling error for climate job ${job.id}: ${pollMsg}`);
      }
    }

    if (!completed) {
      jobEventBus.emitJobStatus({
        jobId: job.id!,
        state: "failed",
        progress: 0,
        failedReason: "Polling timeout: download did not complete in time",
      });
      return { status: "error", error: "Polling timeout: climate download did not complete in time" };
    }
  } else {
    await job.updateProgress(100);
    jobEventBus.emitJobStatus({ jobId: job.id!, state: "completed", progress: 100, result: downloadRes });
    return { status: "success", data: downloadRes };
  }

  return { status: "error", error: "Job processing failed" };
}

export async function handleCovariateJob(
  job: Job<SdmJobData, SdmJobResult>,
  client: PlumberClient,
  _userId: string | undefined,
): Promise<SdmJobResult> {
  const { payload } = job.data;

  await job.updateProgress(10);
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: 10 });

  const downloadRes = await client.downloadCovariateBg(payload);
  const covJobId = downloadRes.job_id as string | undefined;

  await job.updateProgress(20);
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: 20 });

  if (covJobId) {
    let status: Record<string, unknown> = {};
    let completed = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 60;
    const POLL_INTERVAL_MS = 5000;

    while (!completed && attempts < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      attempts++;

      try {
        status = await client.getJobStatus(covJobId);
        const runStatus = status.status as string | undefined;
        const logs = Array.isArray(status.progress_log) ? (status.progress_log as string[]) : [];

        if (runStatus === "running") {
          const pct = (() => {
            for (let i = logs.length - 1; i >= 0; i--) {
              const m = logs[i].match(/\[(\d+)%\]/);
              if (m) return Math.min(90, parseInt(m[1]));
            }
            return Math.min(90, 10 + Math.round(logs.length * 5));
          })();
          await job.updateProgress(pct);
          jobEventBus.emitJobStatus({ jobId: job.id!, state: "running", progress: pct, logs });
        }

        if (runStatus === "completed" || runStatus === "failed") {
          completed = true;
          const error = status.error as string | undefined;
          await job.updateProgress(100);
          jobEventBus.emitJobStatus({
            jobId: job.id!,
            state: runStatus,
            progress: 100,
            logs,
            result: status,
            failedReason: error,
          });
          return {
            status: runStatus === "completed" ? "success" : "error",
            data: status,
            error,
          };
        }
      } catch {
        // Poll failed — continue
      }
    }
  }

  await job.updateProgress(100);
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "completed", progress: 100, result: downloadRes });
  return { status: "success", data: downloadRes };
}
