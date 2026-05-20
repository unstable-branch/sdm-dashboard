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
          await job.updateProgress(20);
          const modelRes = await client.fitModel(payload);
          await job.updateProgress(100);
          result = { status: "success", data: modelRes };
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
