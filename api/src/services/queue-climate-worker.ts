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
    let pollErrors = 0;
    let lastPollError: string | undefined;
    let lastProgress = 20;

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
          lastProgress = Math.min(99, pct);
          await job.updateProgress(lastProgress);
          jobEventBus.emitJobStatus({
            jobId: job.id!,
            state: runStatus,
            progress: lastProgress,
            logs,
          });
        }

        if (runStatus === "completed" || runStatus === "failed" || runStatus === "partial") {
          completed = true;
          const error = status.error as string | undefined;
          const failedVars = status.failed_vars as number[] | undefined;

          if (runStatus === "partial") {
            const partialProgress = Math.min(99, Math.max(lastProgress, 90));
            await job.updateProgress(partialProgress);
            jobEventBus.emitJobStatus({
              jobId: job.id!,
              state: "completed",
              progress: partialProgress,
              logs,
              result: status,
              failedReason: error || undefined,
            });

            if (failedVars && failedVars.length > 0) {
              jobEventBus.emitJobStatus({
                jobId: job.id!,
                state: "warning",
                progress: partialProgress,
                result: { ...status, failed_vars: failedVars },
                failedReason: `Failed layers: ${failedVars.join(", ")}`,
              });
            }

            return { status: "success", data: status, error: error || "Some layers failed to download" };
          } else {
            const terminalProgress = runStatus === "completed" ? 100 : lastProgress;
            if (runStatus === "completed") await job.updateProgress(100);
            jobEventBus.emitJobStatus({
              jobId: job.id!,
              state: runStatus,
              progress: terminalProgress,
              logs,
              result: status,
              failedReason: error,
            });

            if (failedVars && failedVars.length > 0) {
              jobEventBus.emitJobStatus({
                jobId: job.id!,
                state: "warning",
                progress: terminalProgress,
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
        pollErrors++;
        lastPollError = pollMsg;
        console.warn(`[queue] Polling error for climate job ${job.id} (${pollErrors}/${CLIMATE_DOWNLOAD_MAX_ATTEMPTS}): ${pollMsg}`);
      }
    }

    if (!completed) {
      jobEventBus.emitJobStatus({
        jobId: job.id!,
        state: "failed",
        progress: lastProgress,
        failedReason: `Polling timeout: climate download did not complete in time${lastPollError ? `; last poll error: ${lastPollError}` : ""}`,
      });
      return {
        status: "error",
        error: `Polling timeout: climate download did not complete in time${lastPollError ? `; last poll error: ${lastPollError}` : ""}`,
        error_code: "PLUMBER_TIMEOUT",
      };
    }
  } else {
    const synchronousComplete = downloadRes.status === "completed";
    if (synchronousComplete) {
      await job.updateProgress(100);
      jobEventBus.emitJobStatus({ jobId: job.id!, state: "completed", progress: 100, result: downloadRes });
      return { status: "success", data: downloadRes };
    }
    const error = "Climate download submission returned no job_id";
    jobEventBus.emitJobStatus({ jobId: job.id!, state: "failed", progress: 20, failedReason: error, result: downloadRes });
    return { status: "error", error, error_code: "PLUMBER_SUBMISSION_FAILED" };
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
    }
  }

  const timeoutError = `Polling timeout: covariate download did not complete in time${lastPollError ? `; last poll error: ${lastPollError}` : ""}`;
  jobEventBus.emitJobStatus({ jobId: job.id!, state: "failed", progress: lastProgress, failedReason: timeoutError });
  return { status: "error", error: timeoutError, error_code: "PLUMBER_TIMEOUT" };
}
