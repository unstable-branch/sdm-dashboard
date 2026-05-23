import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";

let _connection: IORedis | null = null;
let _bullmqConnection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker<SdmJobData, SdmJobResult> | null = null;
let _redisDisabled = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _failCount = 0;
const MAX_REDIS_FAIL_COUNT = 5;

function getReconnectDelay(): number {
  const delays = [30000, 60000, 120000, 300000];
  return delays[Math.min(_failCount, delays.length - 1)];
}

function logPermanentOffline() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  console.error(
    `[Redis] Permanently offline after ${MAX_REDIS_FAIL_COUNT} consecutive failures at ${redisUrl}. ` +
    `Restart the API server to retry, or check that Redis is running.`
  );
}

const CLIMATE_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.CLIMATE_DOWNLOAD_TIMEOUT_MS || "1800000", 10);
const CLIMATE_DOWNLOAD_POLL_INTERVAL_MS = parseInt(process.env.CLIMATE_DOWNLOAD_POLL_INTERVAL_MS || "3000", 10);
const CLIMATE_DOWNLOAD_MAX_ATTEMPTS = Math.floor(CLIMATE_DOWNLOAD_TIMEOUT_MS / CLIMATE_DOWNLOAD_POLL_INTERVAL_MS);

const REDIS_UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET",
  "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
]);

function isRedisUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = (err as { message?: string }).message ?? "";
  if (REDIS_UNAVAILABLE_CODES.has(msg)) return true;
  return msg.includes("Connection is closed") || msg.includes("connect ECONNREFUSED");
}

function isMaxRetriesError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = (err as { message?: string }).message ?? "";
  return msg.includes("Reached the max retries per request limit");
}

function disableRedis() {
  if (_redisDisabled) return;
  _redisDisabled = true;
  _connection = null;
  _bullmqConnection = null;
  _queue = null;

  _failCount++;
  if (_failCount >= MAX_REDIS_FAIL_COUNT) {
    logPermanentOffline();
    return;
  }

  if (!_reconnectTimer) {
    const delay = getReconnectDelay();
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    console.warn(`[Redis] Unavailable at ${redisUrl} (attempt ${_failCount}/${MAX_REDIS_FAIL_COUNT}). Retrying in ${delay / 1000}s.`);
    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null;
      _redisDisabled = false;
      _worker = null;
      console.log(`[Redis] Reconnect timer fired; next request will retry connection.`);
    }, delay);
  }
}

export function resetRedis() {
  _redisDisabled = false;
  _failCount = 0;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _connection = null;
  _bullmqConnection = null;
  _queue = null;
  _worker = null;
  console.log("[Redis] Connection state reset by admin request.");
}

export function shutdownQueue() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _worker?.close();
  _queue?.close();
  _bullmqConnection?.disconnect(false);
  _connection?.disconnect(false);
  _connection = null;
  _bullmqConnection = null;
  _queue = null;
  _worker = null;
  _redisDisabled = true;
}

function getConnection(): IORedis | null {
  if (_redisDisabled) return null;
  if (_connection) {
    if (_connection.status === "close" || _connection.status === "end") {
      disableRedis();
      return null;
    }
    return _connection;
  }
  _connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 2) {
        disableRedis();
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });
  _connection.on("connect", () => {
    _failCount = 0;
  });
  _connection.on("error", (err) => {
    if (isRedisUnavailableError(err) || isMaxRetriesError(err)) {
      disableRedis();
      return;
    }
    console.error("[ioredis] unexpected error:", err);
  });
  return _connection;
}

function getBullMqConnection(): IORedis | null {
  if (_redisDisabled) return null;
  if (_bullmqConnection) {
    if (_bullmqConnection.status === "close" || _bullmqConnection.status === "end") {
      disableRedis();
      return null;
    }
    return _bullmqConnection;
  }
  _bullmqConnection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 2) {
        disableRedis();
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });
  _bullmqConnection.on("connect", () => {
    _failCount = 0;
  });
  _bullmqConnection.on("error", (err) => {
    if (isRedisUnavailableError(err) || isMaxRetriesError(err)) {
      disableRedis();
      return;
    }
    console.error("[ioredis] unexpected error:", err);
  });
  return _bullmqConnection;
}

function getQueue(): Queue | null {
  if (_redisDisabled) return null;
  if (!_queue) {
    const conn = getBullMqConnection();
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
    _queue.on("error", (err) => {
      if (isRedisUnavailableError(err) || isMaxRetriesError(err)) {
        disableRedis();
        return;
      }
      console.error("[queue] error:", err);
    });
  }
  return _queue;
}

export function ensureWorker(): Worker<SdmJobData, SdmJobResult> | null {
  if (_worker) return _worker;
  if (_redisDisabled) return null;
  const conn = getBullMqConnection();
  if (!conn) return null;
  _worker = new Worker<SdmJobData, SdmJobResult>(
    "sdm-jobs",
    async (job: Job<SdmJobData, SdmJobResult>) => {
      const { type, payload, userId } = job.data;
      let client = new PlumberClient(process.env.PLUMBER_URL || "http://localhost:8000");
      if (userId) {
        client = client.withUser(userId);
      }

      await job.updateProgress(10);

      let result: SdmJobResult = { status: "error", error: "Job processing failed" };

      try {
        switch (type) {
          case "clean": {
            await job.updateProgress(20);
            jobEventBus.emitJobStatus({
              jobId: job.id!,
              state: "active",
              progress: 20,
            });
            const cleanRes = await client.cleanOccurrences({
              file_id: payload.file_id as string,
              min_source_records: Number(payload.min_source_records) || 15,
              merge_small_sources: payload.merge_small_sources !== false,
              use_cc: Boolean(payload.use_cc),
              cc_tests: (payload.cc_tests as string) || "all",
            });
            await job.updateProgress(100);
            jobEventBus.emitJobStatus({
              jobId: job.id!,
              state: "completed",
              progress: 100,
              result: cleanRes as Record<string, unknown>,
            });
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
              // Fire-and-forget: Plumber runs in background, plumber-sync polls for status
              jobEventBus.emitJobStatus({
                jobId: runId ?? job.id!,
                state: "active",
                progress: 30,
                logs: ["Model run submitted to Plumber, awaiting results..."],
              });

              result = { status: "success", data: { job_id: plumberJobId, status: "running" } };
              await job.updateProgress(30);
            } else {
              result = { status: "success", data: modelRes };
              await job.updateProgress(100);
              const runIdElse = (payload as Record<string, unknown>)?.runId as string | undefined;
              jobEventBus.emitJobStatus({ jobId: runIdElse ?? job.id!, state: "completed", progress: 100, result: modelRes });
            }
            break;
          }
          case "climate_download": {
            await job.updateProgress(10);
            jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: 10 });

            const downloadRes = await client.downloadClimate(payload);
            const climateJobId = (downloadRes as any).job_id as string | undefined;

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
                  const runStatus = (status as any).status as string;
                  const logs = Array.isArray((status as any).progress_log) ? (status as any).progress_log as string[] : [];

                  if (runStatus === "running" || runStatus === "partial") {
                    const pct = (() => {
                      for (let i = logs.length - 1; i >= 0; i--) {
                        const m = logs[i].match(/\[(\d+)%\]/);
                        if (m) {
                          const val = parseInt(m[1], 10);
                          if (val >= 0 && val <= 100) return val;
                        }
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
                    const error = (status as any).error as string | undefined;
                    const failedVars = (status as any).failed_vars as number[] | undefined;

                    if (runStatus === "partial") {
                      result = {
                        status: "success",
                        data: status,
                        error: error || "Some layers failed to download",
                      };
                      await job.updateProgress(100);
                      jobEventBus.emitJobStatus({
                        jobId: job.id!,
                        state: "completed",
                        progress: 100,
                        logs,
                        result: status,
                        failedReason: error || undefined,
                      });
                    } else {
                      result = {
                        status: runStatus === "completed" ? "success" : "error",
                        data: status,
                        error,
                      };
                      await job.updateProgress(100);
                      jobEventBus.emitJobStatus({
                        jobId: job.id!,
                        state: runStatus,
                        progress: 100,
                        logs,
                        result: status,
                        failedReason: error,
                      });
                    }

                    if (failedVars && failedVars.length > 0) {
                      jobEventBus.emitJobStatus({
                        jobId: job.id!,
                        state: "warning",
                        progress: 100,
                        result: { ...status, failed_vars: failedVars },
                        failedReason: `Failed layers: ${failedVars.join(", ")}`,
                      });
                    }
                  }
                } catch (pollErr) {
                  const pollMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
                  console.warn(`[queue] Polling error for climate job ${job.id}: ${pollMsg}`);
                }
              }

              if (!completed) {
                result = { status: "error", error: "Polling timeout: climate download did not complete in time" };
                jobEventBus.emitJobStatus({
                  jobId: job.id!,
                  state: "failed",
                  progress: 0,
                  failedReason: "Polling timeout: download did not complete in time",
                });
              }
            } else {
              result = { status: "success", data: downloadRes };
              await job.updateProgress(100);
              jobEventBus.emitJobStatus({ jobId: job.id!, state: "completed", progress: 100, result: downloadRes });
            }
            break;
          }
          default:
            throw new Error(`Unknown job type: ${type}`);
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";

        if (type === "model") {
          const runId = payload.runId as string;
          if (runId) {
            await db
              .update(runs)
              .set({
                status: "failed",
                error: errorMsg,
                completedAt: new Date(),
              })
              .where(eq(runs.id, runId));
          }
        }

        jobEventBus.emitJobStatus({
          jobId: job.id!,
          state: "failed",
          progress: 0,
          failedReason: errorMsg,
        });

        return {
          status: "error",
          error: errorMsg,
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

export function getRedisStatus(): {
  available: boolean;
  disabled: boolean;
  failCount: number;
  reconnectDelayMs: number;
  permanentOffline: boolean;
} {
  return {
    available: !_redisDisabled && (_connection?.status === "ready" || _bullmqConnection?.status === "ready"),
    disabled: _redisDisabled,
    failCount: _failCount,
    reconnectDelayMs: _reconnectTimer ? getReconnectDelay() : 0,
    permanentOffline: _failCount >= MAX_REDIS_FAIL_COUNT,
  };
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
  if (_redisDisabled) throw new Error("Redis unavailable — cannot enqueue job");
  const q = getQueue();
  if (!q) throw new Error("Redis unavailable — cannot enqueue job");
  const jobData: SdmJobData = userId ? { ...data, userId } : data;
  try {
    const job = await q.add("sdm-task", jobData, {
      attempts: 2,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
    return job.id ?? "";
  } catch (err) {
    if (isRedisUnavailableError(err) || isMaxRetriesError(err)) {
      disableRedis();
      throw new Error("Redis unavailable — cannot enqueue job");
    }
    throw err;
  }
}

export async function getJobStatus(jobId: string) {
  if (_redisDisabled) return null;
  const q = getQueue();
  if (!q) return null;
  try {
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
  } catch (err) {
    if (isRedisUnavailableError(err) || isMaxRetriesError(err)) {
      disableRedis();
      return null;
    }
    throw err;
  }
}
