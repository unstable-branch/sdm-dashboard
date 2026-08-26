import { Job } from "bullmq";
import { PlumberClient } from "./plumber.js";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import {
  CLIMATE_DOWNLOAD_POLL_INTERVAL_MS,
  CLIMATE_DOWNLOAD_MAX_ATTEMPTS,
  CLIMATE_DOWNLOAD_MAX_CONSECUTIVE_POLL_ERRORS,
  SdmJobData,
  SdmJobResult,
} from "./queue.js";



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

  if (!covJobId) {
    const synchronousComplete = downloadRes.status === "completed";
    if (synchronousComplete) {
      await job.updateProgress(100);
      jobEventBus.emitJobStatus({ jobId: job.id!, state: "completed", progress: 100, result: downloadRes });
      return { status: "success", data: downloadRes };
    }
    const error = "Covariate download submission returned no job_id";
    jobEventBus.emitJobStatus({ jobId: job.id!, state: "failed", progress: 20, failedReason: error, result: downloadRes });
    return { status: "error", error, error_code: "PLUMBER_SUBMISSION_FAILED" };
  }

  let lastProgress = 20;
  let lastPollError: string | undefined;
  let pollErrors = 0;

  for (let attempts = 1; attempts <= CLIMATE_DOWNLOAD_MAX_ATTEMPTS; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, CLIMATE_DOWNLOAD_POLL_INTERVAL_MS));
    try {
      const status = await client.getJobStatus(covJobId);
      const runStatus = status.status as string | undefined;
      const logs = Array.isArray(status.progress_log) ? (status.progress_log as string[]) : [];

      if (runStatus === "running" || runStatus === "pending") {
        const reported = (() => {
          for (let i = logs.length - 1; i >= 0; i--) {
            const pct = extractProgressPercent(logs[i]);
            if (pct !== undefined) return pct;
          }
          return Math.min(90, 20 + Math.round(attempts * 0.5));
        })();
        lastProgress = Math.min(99, Math.max(lastProgress, reported));
        await job.updateProgress(lastProgress);
        jobEventBus.emitJobStatus({ jobId: job.id!, state: "running", progress: lastProgress, logs });
        continue;
      }

      if (runStatus === "completed") {
        await job.updateProgress(100);
        jobEventBus.emitJobStatus({ jobId: job.id!, state: "completed", progress: 100, logs, result: status });
        return { status: "success", data: status };
      }

      if (runStatus === "failed" || runStatus === "cancelled" || runStatus === "error") {
        const error = (status.error as string | undefined) || `Covariate download ${runStatus}`;
        jobEventBus.emitJobStatus({
          jobId: job.id!, state: runStatus === "cancelled" ? "cancelled" : "failed",
          progress: lastProgress, logs, result: status, failedReason: error,
        });
        return { status: "error", data: status, error };
      }
    } catch (pollErr) {
      pollErrors++;
      lastPollError = pollErr instanceof Error ? pollErr.message : String(pollErr);
      console.warn(`[queue] Polling error for covariate job ${job.id} (${pollErrors}/${CLIMATE_DOWNLOAD_MAX_ATTEMPTS}): ${lastPollError}`);
      if (pollErrors >= CLIMATE_DOWNLOAD_MAX_CONSECUTIVE_POLL_ERRORS) {
        const failMsg = `Polling failed ${pollErrors} times in a row: ${lastPollError}`;
        jobEventBus.emitJobStatus({
          jobId: job.id!,
          state: "failed",
          progress: lastProgress,
          failedReason: failMsg,
        });
        return { status: "error", error: failMsg, error_code: "PLUMBER_UNREACHABLE" };
      }
    }
  }

  const timeoutError = `Polling timeout: covariate download did not complete in time${lastPollError ? `; last poll error: ${lastPollError}` : ""}`;
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "failed", progress: lastProgress, failedReason: timeoutError });
  return { status: "error", error: timeoutError, error_code: "PLUMBER_TIMEOUT" };
}
