import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { handleModelJob } from "./queue-model-worker.js";
import { handleCleanJob } from "./queue-clean-worker.js";
import { handleClimateJob, handleCovariateJob } from "./queue-climate-worker.js";

let _connection: IORedis | null = null;
let _bullmqConnection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker<SdmJobData, SdmJobResult> | null = null;
let _redisDisabled = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _failCount = 0;

function getReconnectDelay(): number {
  const delays = [10000, 30000, 60000, 120000, 300000];
  return delays[Math.min(Math.max(0, _failCount - 1), delays.length - 1)];
}

export const CLIMATE_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.CLIMATE_DOWNLOAD_TIMEOUT_MS || "1800000", 10);
export const CLIMATE_DOWNLOAD_POLL_INTERVAL_MS = parseInt(process.env.CLIMATE_DOWNLOAD_POLL_INTERVAL_MS || "3000", 10);
export const CLIMATE_DOWNLOAD_MAX_ATTEMPTS = Math.floor(CLIMATE_DOWNLOAD_TIMEOUT_MS / CLIMATE_DOWNLOAD_POLL_INTERVAL_MS);

export const MODEL_RUN_TIMEOUT_MS = parseInt(process.env.MODEL_RUN_TIMEOUT_MS || "7200000", 10);
export const MODEL_RUN_POLL_INTERVAL_MS = parseInt(process.env.MODEL_RUN_POLL_INTERVAL_MS || "5000", 10);
export const MODEL_RUN_MAX_ATTEMPTS = Math.floor(MODEL_RUN_TIMEOUT_MS / MODEL_RUN_POLL_INTERVAL_MS);

export const REDIS_UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET",
  "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
]);

export function isRedisUnavailableError(err: unknown): boolean {
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
  _worker?.close();
  _worker = null;
  _connection = null;
  _bullmqConnection = null;
  _queue = null;

  _failCount++;
  const delay = getReconnectDelay();
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  console.warn(`[Redis] Unavailable at ${redisUrl} (attempt ${_failCount}). Retrying in ${delay / 1000}s.`);
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _redisDisabled = false;
    console.log(`[Redis] Reconnect timer fired; reinitializing connections.`);
    ensureWorker();
  }, delay);
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
  _connection = null;
  _bullmqConnection = null;
  _queue = null;
  _worker = null;
  _redisDisabled = true;
}

function getConnection(): IORedis | null {
  return getBullMqConnection();
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

      let cpuStart: NodeJS.CpuUsage | undefined;
      if (type === "model") {
        cpuStart = process.cpuUsage();
      }

      try {
        switch (type) {
          case "clean":
            result = await handleCleanJob(job, client, userId);
            break;
          case "model":
            result = await handleModelJob(job, client, userId, cpuStart);
            break;
          case "climate_download":
            result = await handleClimateJob(job, client, userId);
            break;
          case "covariate_download":
            result = await handleCovariateJob(job, client, userId);
            break;
          default:
            throw new Error(`Unknown job type: ${type}`);
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        const errorDetails = err instanceof Error && 'response' in err ? String((err as { response: unknown }).response) : null;
        const finalError = errorDetails || errorMsg;

        if (type === "model") {
          const runId = payload.runId as string;
          if (runId) {
            const cpuDelta = cpuStart ? process.cpuUsage(cpuStart) : undefined;
            await db
              .update(runs)
              .set({
                status: "failed",
                error: finalError,
                completedAt: new Date(),
                rCpuTimeMs: cpuDelta ? (cpuDelta.user + cpuDelta.system) / 1000 : null,
                peakMemoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
              })
              .where(eq(runs.id, runId));
          }
        }

        const jobIdForEvent = type === "model" ? (payload.runId as string || job.id!) : job.id!;
        jobEventBus.emitJobStatus({
          jobId: jobIdForEvent,
          state: "failed",
          progress: 0,
          failedReason: finalError,
        });

        if (finalError.includes("timeout") || finalError.includes("ECONNREFUSED") || finalError.includes("ETIMEDOUT") || finalError.includes("500") || finalError.includes("502") || finalError.includes("503")) {
          throw err;
        }

        return {
          status: "error",
          error: finalError,
          error_code: "INTERNAL_ERROR",
          error_hint: "Check the Plumber logs for detailed error information",
        } satisfies SdmJobResult;
      }
    },
    // Concurrency=2: R model fitting is memory/CPU intensive; 3 could exhaust RAM with large covariates
    { connection: conn, concurrency: 2 }
  );

  _worker.on("stalled", (jobId: string) => {
    console.warn(`[Worker] Job stalled: ${jobId}`);
  });
  _worker.on("failed", (job: Job | undefined, err: Error) => {
    if (job) console.warn(`[Worker] Job ${job.id} failed after retries: ${err.message}`);
  });

  return _worker;
}

export function getJobQueue(): Queue | null {
  return getQueue();
}

export function getQueueClient(): IORedis | null {
  if (_redisDisabled) return null;
  return getConnection();
}

export function getSharedRedis(): IORedis | null {
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
    available: !_redisDisabled && (_bullmqConnection?.status === "ready"),
    disabled: _redisDisabled,
    failCount: _failCount,
    reconnectDelayMs: _reconnectTimer ? getReconnectDelay() : 0,
    permanentOffline: false,
  };
}

export interface SdmJobData {
  type: "clean" | "model" | "climate_download" | "covariate_download";
  payload: Record<string, unknown>;
  userId?: string;
}

export interface SdmJobResult {
  status: "success" | "error";
  data?: Record<string, unknown>;
  error?: string;
  error_code?: string | null;
  error_hint?: string | null;
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
