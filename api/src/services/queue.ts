import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs, species, occurrences, projectMembers } from "../db/schema.js";
import { eq, and, or, inArray } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import { syncOutputsToS3 } from "./storage.js";
import { join } from "path";

let _connection: IORedis | null = null;
let _bullmqConnection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker<SdmJobData, SdmJobResult> | null = null;
let _redisDisabled = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _failCount = 0;

function getReconnectDelay(): number {
  const delays = [10000, 30000, 60000, 120000, 300000];
  return delays[Math.min(_failCount, delays.length - 1)];
}

const CLIMATE_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.CLIMATE_DOWNLOAD_TIMEOUT_MS || "1800000", 10);
const CLIMATE_DOWNLOAD_POLL_INTERVAL_MS = parseInt(process.env.CLIMATE_DOWNLOAD_POLL_INTERVAL_MS || "3000", 10);
const CLIMATE_DOWNLOAD_MAX_ATTEMPTS = Math.floor(CLIMATE_DOWNLOAD_TIMEOUT_MS / CLIMATE_DOWNLOAD_POLL_INTERVAL_MS);

const MODEL_RUN_TIMEOUT_MS = parseInt(process.env.MODEL_RUN_TIMEOUT_MS || "7200000", 10);
const MODEL_RUN_POLL_INTERVAL_MS = parseInt(process.env.MODEL_RUN_POLL_INTERVAL_MS || "5000", 10);
const MODEL_RUN_MAX_ATTEMPTS = Math.floor(MODEL_RUN_TIMEOUT_MS / MODEL_RUN_POLL_INTERVAL_MS);

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

      // Track resource usage for model runs
      let cpuStart: NodeJS.CpuUsage | undefined;
      let wallStart: number | undefined;
      if (type === "model") {
        cpuStart = process.cpuUsage();
        wallStart = Date.now();
      }

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
              pipelineRunId: (payload.pipelineRunId as string) || null,
            });

            const cleanJobId = (cleanRes as any).job_id as string | undefined;

            if (cleanJobId) {
              let cleanStatus: Record<string, unknown> = {};
              let cleanCompleted = false;
              let cleanAttempts = 0;

              while (!cleanCompleted && cleanAttempts < CLIMATE_DOWNLOAD_MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, CLIMATE_DOWNLOAD_POLL_INTERVAL_MS));
                cleanAttempts++;

                try {
                  cleanStatus = await client.getJobStatus(cleanJobId);
                  const runStatus = (cleanStatus as any).status as string;

                  if (runStatus === "running") {
                    const pct = Math.min(90, 20 + Math.round(cleanAttempts * 2));
                    await job.updateProgress(pct);
                    jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: pct });
                  }

                  if (runStatus === "completed") {
                    cleanCompleted = true;
                    const cleanResult = (cleanStatus as any).result as Record<string, unknown> | undefined;

                    if (cleanResult) {
                      const speciesName = (payload.species as string) || "Untitled species";
                      const pipelineRunId = (payload.pipelineRunId as string) || null;

                      if (userId) {
                        const [membership] = await db
                          .select({ projectId: projectMembers.projectId })
                          .from(projectMembers)
                          .where(eq(projectMembers.userId, userId))
                          .limit(1);

                        const projectId = membership?.projectId;

                        if (projectId) {
                          let [sp] = await db
                            .select()
                            .from(species)
                            .where(and(eq(species.name, speciesName), eq(species.projectId, projectId)))
                            .limit(1);

                          if (!sp) {
                            [sp] = await db
                              .insert(species)
                              .values({ name: speciesName, projectId, occurrenceCount: 0, userId })
                              .returning();
                          }

                          const cleanedRecords = cleanResult.cleaned_records as Array<Record<string, unknown>> | undefined;
                          const validRecords = (cleanedRecords || []).filter(
                            (r) => typeof r.longitude === "number" && typeof r.latitude === "number" && isFinite(r.longitude) && isFinite(r.latitude)
                          );

                          if (validRecords.length > 0) {
                            const recordsToInsert = validRecords.map((row) => ({
                              speciesId: sp.id,
                              projectId,
                              userId,
                              filePath: cleanResult.cleaned_file_id as string || null,
                              pipelineRunId,
                              longitude: Number(row.longitude),
                              latitude: Number(row.latitude),
                              source: (row.source as string) || null,
                              flagged: Boolean((row as any).flagged || (row as any).cc_flag),
                              cleaned: true,
                              raw: row,
                            }));

                            const BATCH_SIZE = 500;
                            for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
                              const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
                              await db.insert(occurrences).values(batch);
                            }

                            await db
                              .update(species)
                              .set({ occurrenceCount: (sp.occurrenceCount || 0) + recordsToInsert.length })
                              .where(eq(species.id, sp.id));
                          }
                        }
                      }
                    }

                    await job.updateProgress(100);
                    jobEventBus.emitJobStatus({
                      jobId: job.id!,
                      state: "completed",
                      progress: 100,
                      result: cleanResult || cleanStatus,
                    });
                    result = { status: "success", data: cleanResult || cleanStatus };
                  } else if (runStatus === "failed") {
                    cleanCompleted = true;
                    const cleanError = (cleanStatus as any).error as string || "Clean job failed";
                    const cleanErrCode = (cleanStatus as any).error_code as string | undefined;
                    const cleanErrHint = (cleanStatus as any).error_hint as string | undefined;
                    result = { status: "error", error: cleanError, error_code: cleanErrCode ?? null, error_hint: cleanErrHint ?? null };
                    await job.updateProgress(100);
                    jobEventBus.emitJobStatus({
                      jobId: job.id!,
                      state: "failed",
                      progress: 100,
                      failedReason: cleanError,
                    });
                  }
                } catch (pollErr) {
                  const pollMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
                  console.warn(`[queue] Polling error for clean job ${job.id}: ${pollMsg}`);
                }
              }

              if (!cleanCompleted) {
                result = { status: "error", error: "Polling timeout: clean job did not complete in time" };
                jobEventBus.emitJobStatus({
                  jobId: job.id!,
                  state: "failed",
                  progress: 0,
                  failedReason: "Polling timeout: clean job did not complete in time",
                });
              }
            } else {
              result = { status: "error", error: "Clean job submission returned no job_id" };
              await job.updateProgress(100);
              jobEventBus.emitJobStatus({
                jobId: job.id!,
                state: "failed",
                progress: 100,
                failedReason: "Clean job submission returned no job_id",
              });
            }

            break;
          }
          case "model": {
            await job.updateProgress(10);
            const runId = payload.runId as string;

            if (runId) {
              await db
                .update(runs)
                .set({ status: "running", startedAt: new Date(), bullmqId: job.id! })
                .where(and(eq(runs.id, runId), or(eq(runs.status, "queued"), eq(runs.status, "failed"))));
            }

            const modelRes = await client.runModel(payload);
            const plumberJobId = (modelRes as any).job_id as string | undefined;

            if (runId) {
              const cpuDelta = cpuStart ? process.cpuUsage(cpuStart) : undefined;
              await db
                .update(runs)
                .set({
                  jobId: plumberJobId ?? null,
                  bullmqId: job.id!,
                  rCpuTimeMs: cpuDelta ? (cpuDelta.user + cpuDelta.system) / 1000 : null,
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
                  const pollState = (modelStatus as any).status as string;
                  const logs = Array.isArray((modelStatus as any).progress_log)
                    ? (modelStatus as any).progress_log as string[]
                    : [];
                  const pollProgressJson = (modelStatus as any).progress_json as unknown;
                  const pollCurrentStage = (modelStatus as any).last_stage as string | undefined;

                  // Extract real progress from progress_json entries (percent is 0-1) or progress_log lines [XX%]
                  const pollProgress = (() => {
                    if (Array.isArray(pollProgressJson) && pollProgressJson.length > 0) {
                      const last = pollProgressJson[pollProgressJson.length - 1] as any;
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
                    await job.updateProgress(pollProgress ?? Math.min(90, 35 + Math.round(modelAttempts * 0.5)));
                    jobEventBus.emitJobStatus({
                      jobId: runId ?? job.id!,
                      state: "active",
                      progress: pollProgress ?? Math.min(90, 35 + Math.round(modelAttempts * 0.5)),
                      logs,
                      currentStage: pollCurrentStage ?? null,
                      progressJson: pollProgressJson ?? null,
                    });
                  }

                  if (pollState === "completed") {
                    modelCompleted = true;
                    const metrics = (modelStatus as any).metrics as Record<string, unknown> | undefined;

                    if (runId) {
                      // Guard against plumber-sync having already written a terminal state
                      const [currentRun] = await db
                        .select({ status: runs.status })
                        .from(runs)
                        .where(eq(runs.id, runId))
                        .limit(1);
                      if (currentRun && currentRun.status !== "running") { modelCompleted = true; break; }

                      await db
                        .update(runs)
                        .set({
                          status: "completed",
                          completedAt: new Date(),
                          error: null,
                          metrics: metrics as any,
                        })
                        .where(and(eq(runs.id, runId), inArray(runs.status, ["running", "queued"])));
                    }

                    // Upload output files to S3 in background
                    const outputFiles = (modelStatus as any).output_files as Record<string, string> | undefined;
                    if (outputFiles && runId) {
                      const jobDir = join("outputs", "jobs", runId);
                      syncOutputsToS3(jobDir, runId, outputFiles).catch((err) => {
                        console.warn(`[S3] Background sync failed for run ${runId}:`, err);
                      });
                    }

                    await job.updateProgress(100);
                    jobEventBus.emitJobStatus({
                      jobId: runId ?? job.id!,
                      state: "completed",
                      progress: 100,
                      logs: logs.concat(["Model run completed."]),
                      currentStage: null,
                      result: modelStatus as Record<string, unknown>,
                      error_code: (modelStatus as any).error_code ?? null,
                      error_hint: (modelStatus as any).error_hint ?? null,
                      progressJson: pollProgressJson ?? null,
                    });
                    result = { status: "success", data: modelStatus };
                  } else if (pollState === "cancelled") {
                    modelCompleted = true;
                    if (runId) {
                      await db
                        .update(runs)
                        .set({ status: "cancelled", completedAt: new Date() })
                        .where(and(eq(runs.id, runId), inArray(runs.status, ["running", "queued"])));
                    }
                    await job.updateProgress(100);
                    jobEventBus.emitJobStatus({
                      jobId: runId ?? job.id!,
                      state: "cancelled",
                      progress: 100,
                      currentStage: null,
                      failedReason: "Model run cancelled by user",
                      error_code: "CANCELLED",
                      error_hint: null,
                      progressJson: pollProgressJson ?? null,
                    });
                    result = { status: "error", error: "Cancelled", error_code: "CANCELLED" };
                  } else if (pollState === "failed" || pollState === "error") {
                    modelCompleted = true;
                    const errMsg = (modelStatus as any).error as string || "Model run failed";
                    const errCode = (modelStatus as any).error_code as string | undefined;
                    const errHint = (modelStatus as any).error_hint as string | undefined;
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
                    await job.updateProgress(100);
                    jobEventBus.emitJobStatus({
                      jobId: runId ?? job.id!,
                      state: "failed",
                      progress: 100,
                      currentStage: null,
                      failedReason: errMsg,
                      error_code: errCode ?? null,
                      error_hint: errHint ?? null,
                      progressJson: pollProgressJson ?? null,
                    });
                    result = { status: "error", error: errMsg, error_code: errCode ?? null, error_hint: errHint ?? null };
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
                result = { status: "error", error: timeoutMsg, error_code: "PLUMBER_TIMEOUT" };
                jobEventBus.emitJobStatus({
                  jobId: runId ?? job.id!,
                  state: "failed",
                  progress: 0,
                  failedReason: timeoutMsg,
                });
              }
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
                  status = await client.getClimateStatus(climateJobId) as unknown as Record<string, unknown>;
                  const runStatus = (status as any).status as string;
                  const logs = Array.isArray((status as any).progress_log) ? (status as any).progress_log as string[] : [];

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
        const errorDetails = err instanceof Error && 'response' in err ? String((err as any).response) : null;
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

        // Use run UUID for model jobs (for SSE event routing), fall back to BullMQ job ID
        const jobIdForEvent = type === "model" ? (payload.runId as string || job.id!) : job.id!;
        jobEventBus.emitJobStatus({
          jobId: jobIdForEvent,
          state: "failed",
          progress: 0,
          failedReason: finalError,
        });

        // Re-throw for retryable errors so BullMQ's retry mechanism works
        if (finalError.includes("timeout") || finalError.includes("ECONNREFUSED") || finalError.includes("ETIMEDOUT") || finalError.includes("500") || finalError.includes("502") || finalError.includes("503")) {
          throw err;
        }

        return {
          status: "error",
          error: finalError,
          error_code: "INTERNAL_ERROR",
          error_hint: "Check the Plumber logs for detailed error information",
        };
      }
    },
    { connection: conn, concurrency: 3 }
  );

  // Handle stalled jobs — BullMQ marks jobs as stalled when a worker crashes mid-processing
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

/** Shared Redis connection for cache and rate-limit modules (avoids creating extra connections) */
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
    available: !_redisDisabled && (_connection?.status === "ready" || _bullmqConnection?.status === "ready"),
    disabled: _redisDisabled,
    failCount: _failCount,
    reconnectDelayMs: _reconnectTimer ? getReconnectDelay() : 0,
    permanentOffline: false,
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
