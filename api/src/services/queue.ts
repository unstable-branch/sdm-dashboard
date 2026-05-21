import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PlumberClient } from "./plumber";
import { db } from "../db";
import { runs } from "../db/schema";
import { eq } from "drizzle-orm";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const sdmQueue = new Queue("sdm-jobs", { connection });

export interface SdmJobData {
  type: "clean" | "model" | "climate_download";
  payload: Record<string, unknown>;
}

export interface SdmJobResult {
  status: "success" | "error";
  data?: Record<string, unknown>;
  error?: string;
}

export const sdmWorker = new Worker<SdmJobData, SdmJobResult>(
  "sdm-jobs",
  async (job: Job<SdmJobData, SdmJobResult>) => {
    const { type, payload } = job.data;
    const client = new PlumberClient(process.env.PLUMBER_URL || "http://localhost:8000");

    await job.updateProgress(10);

    let result: SdmJobResult = { status: "error", error: "Job processing failed" };

    try {
      switch (type) {
        case "clean": {
          await job.updateProgress(20);
          const cleanRes = await client.cleanOccurrences({
            file_id: payload.file_id as string,
            min_source_records: Number(payload.min_source_records) || 15,
            merge_small_sources: payload.merge_small_sources !== false,
            use_cc: Boolean(payload.use_cc),
            cc_tests: (payload.cc_tests as string) || "all",
          });
          await job.updateProgress(100);
          result = { status: "success", data: cleanRes };
          break;
        }
        case "model": {
          await job.updateProgress(10);
          const runId = payload.runId as string;

          if (runId) {
            await db
              .update(runs)
              .set({ status: "running", startedAt: new Date() })
              .where(eq(runs.id, runId));
          }

          const modelRes = await client.runModel(payload);
          const plumberJobId = (modelRes as any).job_id as string | undefined;

          if (runId) {
            await db
              .update(runs)
              .set({ jobId: plumberJobId ?? null })
              .where(eq(runs.id, runId));
          }

          await job.updateProgress(30);

          if (plumberJobId) {
            let status: Record<string, unknown> = {};
            let completed = false;
            let attempts = 0;

            while (!completed && attempts < 300) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
              attempts++;

              try {
                status = await client.getModelStatus(plumberJobId);
                const runStatus = (status as any).status;

                if (runStatus === "running") {
                  const logLen = Array.isArray((status as any).progress_log)
                    ? (status as any).progress_log.length
                    : 0;
                  await job.updateProgress(Math.min(95, 30 + Math.round(logLen * 0.5)));
                }

                if (runStatus === "completed" || runStatus === "failed") {
                  completed = true;

                  const metrics = (status as any).metrics;
                  const outputFiles = (status as any).output_files;
                  const progressLog = ((status as any).progress_log || []) as string[];
                  const error = (status as any).error;

                  const structuredLog = progressLog.map((line: string) => {
                    const match = line.match(/^(\d{2}:\d{2}:\d{2})\s*(?:\[([\d.]+%)\])?\s*(.*)/);
                    if (match) {
                      return { timestamp: match[1], level: match[2] || "info", message: match[3] };
                    }
                    return { timestamp: "", level: "info", message: line };
                  });

                  await db
                    .update(runs)
                    .set({
                      status: runStatus === "completed" ? "completed" : "failed",
                      metrics: metrics ?? null,
                      outputFiles: outputFiles ?? null,
                      progressLog: structuredLog,
                      error: error ?? null,
                      completedAt: runStatus === "completed" ? new Date() : null,
                    })
                    .where(eq(runs.id, runId));

                  result = {
                    status: runStatus === "completed" ? "success" : "error",
                    data: status,
                    error: error as string | undefined,
                  };
                }
              } catch {
                attempts++;
              }
            }

            if (!completed) {
              await db
                .update(runs)
                .set({ status: "failed", error: "Polling timeout", completedAt: new Date() })
                .where(eq(runs.id, runId));
              result = { status: "error", error: "Polling timeout: model did not complete in time" };
            }
          } else {
            result = { status: "success", data: modelRes };
          }

          await job.updateProgress(100);
          break;
        }
        case "climate_download": {
          await job.updateProgress(10);
          const downloadRes = await client.downloadClimate(payload);
          const climateJobId = (downloadRes as any).job_id as string | undefined;

          await job.updateProgress(20);

          if (climateJobId) {
            let status: Record<string, unknown> = {};
            let completed = false;
            let attempts = 0;

            while (!completed && attempts < 600) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
              attempts++;

              try {
                status = await client.getClimateStatus(climateJobId);
                const runStatus = (status as any).status;

                if (runStatus === "running") {
                  const logLen = Array.isArray((status as any).progress_log)
                    ? (status as any).progress_log.length
                    : 0;
                  await job.updateProgress(Math.min(95, 20 + Math.round(logLen * 0.5)));
                }

                if (runStatus === "completed" || runStatus === "failed") {
                  completed = true;
                  const progressLog = ((status as any).progress_log || []) as string[];
                  const error = (status as any).error;

                  result = {
                    status: runStatus === "completed" ? "success" : "error",
                    data: status,
                    error: error as string | undefined,
                  };
                }
              } catch {
                attempts++;
              }
            }

            if (!completed) {
              result = { status: "error", error: "Polling timeout: download did not complete in time" };
            }
          } else {
            result = { status: "success", data: downloadRes };
          }

          await job.updateProgress(100);
          break;
        }
        default:
          throw new Error(`Unknown job type: ${type}`);
      }

      return result;
    } catch (err) {
      if (type === "model") {
        const runId = payload.runId as string;
        if (runId) {
          await db
            .update(runs)
            .set({
              status: "failed",
              error: err instanceof Error ? err.message : "Unknown error",
              completedAt: new Date(),
            })
            .where(eq(runs.id, runId));
        }
      }

      return {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
  { connection }
);

export async function enqueueSdmJob(data: SdmJobData): Promise<string> {
  const job = await sdmQueue.add("sdm-task", data, {
    attempts: 2,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
  return job.id ?? "";
}

export async function getJobStatus(jobId: string) {
  const job = await sdmQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = job.progress;

  return {
    id: job.id,
    state,
    progress,
    result: job.returnvalue,
    failedReason: job.failedReason,
  };
}