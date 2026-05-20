import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PlumberClient } from "./plumber";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const sdmQueue = new Queue("sdm-jobs", { connection });

export interface SdmJobData {
  type: "clean" | "model" | "predict" | "report";
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

    let result: SdmJobResult;

    try {
      switch (type) {
        case "clean": {
          await job.updateProgress(20);
          const uploadRes = await client.uploadOccurrence(
            payload.file_path as string,
            payload.file_id as string
          );
          await job.updateProgress(50);
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
          const modelRes = await client.runModel(payload);
          const runJobId = (modelRes as any).job_id as string | undefined;
          if (runJobId) {
            await job.updateProgress(50);
            let status: Record<string, unknown> = {};
            try {
              status = await client.getModelStatus(runJobId);
            } catch {
              // Status check failed, continue
            }
            while ((status as any).status === "running") {
              await new Promise((resolve) => setTimeout(resolve, 3000));
              try {
                const updated = await client.getModelStatus(runJobId);
                const logLen = Array.isArray((updated as any).progress_log) ? (updated as any).progress_log.length : 0;
                await job.updateProgress(Math.min(95, 50 + Math.round(logLen * 0.5)));
                Object.assign(status, updated);
              } catch {
                break;
              }
            }
            const finalStatus = (status as any).status;
            result = { status: finalStatus === "completed" ? "success" : "error", data: status, error: (status as any).error as string | undefined };
          } else {
            result = { status: "success", data: modelRes };
          }
          await job.updateProgress(100);
          break;
        }
        case "predict": {
          await job.updateProgress(20);
          const predictRes = await client.predict(payload);
          await job.updateProgress(100);
          result = { status: "success", data: predictRes };
          break;
        }
        case "report": {
          await job.updateProgress(20);
          const reportRes = await client.generateReport(payload);
          await job.updateProgress(100);
          result = { status: "success", data: reportRes };
          break;
        }
        default:
          throw new Error(`Unknown job type: ${type}`);
      }

      return result;
    } catch (err) {
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
