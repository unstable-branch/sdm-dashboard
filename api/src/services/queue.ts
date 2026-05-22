import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq } from "drizzle-orm";

let _connection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker<SdmJobData, SdmJobResult> | null = null;
let _redisDisabled = false;

function getConnection(): IORedis | null {
  if (_redisDisabled) return null;
  if (_connection) {
    if (_connection.status === "close" || _connection.status === "end") {
      _redisDisabled = true;
      return null;
    }
    return _connection;
  }
  _connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    },
    lazyConnect: true,
    enableReadyCheck: true,
  });
  _connection.on("error", () => {});
  _connection.connect().catch(() => {
    _redisDisabled = true;
  });
  return _connection;
}

function getQueue(): Queue | null {
  if (_redisDisabled) return null;
  if (!_queue) {
    const conn = getConnection();
    if (!conn) return null;
    _queue = new Queue("sdm-jobs", {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: { age: 86400, count: 100 },
        removeOnFail: { age: 604800 },
      },
    });
  }
  return _queue;
}

export function ensureWorker(): Worker<SdmJobData, SdmJobResult> | null {
  if (_worker) return _worker;
  if (_redisDisabled) return null;
  const conn = getConnection();
  if (!conn) return null;
  _worker = new Worker<SdmJobData, SdmJobResult>(
    "sdm-jobs",
    async (job: Job<SdmJobData, SdmJobResult>) => {
      const { type, payload, userId } = job.data;
      const client = new PlumberClient(process.env.PLUMBER_URL || "http://localhost:8000");
      if (userId) {
        client.withUser(userId);
      }

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
    { connection: conn }
  );
  return _worker;
}

export function getJobQueue(): Queue | null {
  return getQueue();
}

export function getQueueClient(): IORedis | null {
  if (_redisDisabled) return null;
  return getConnection();
}

export interface SdmJobData {
  type: "clean" | "model" | "climate_download";
  payload: Record<string, unknown>;
  userId?: string;
}

export interface SdmJobResult {
  status: "success" | "error";
  data?: Record<string, unknown>;
  error?: string;
}

export async function enqueueSdmJob(data: SdmJobData, userId?: string): Promise<string> {
  const q = getQueue();
  if (!q) throw new Error("Redis unavailable — cannot enqueue job");
  const jobData: SdmJobData = userId ? { ...data, userId } : data;
  const job = await q.add("sdm-task", jobData, {
    attempts: 2,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
  return job.id ?? "";
}

export async function getJobStatus(jobId: string) {
  const q = getQueue();
  if (!q) return null;
  const job = await q.getJob(jobId);
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
