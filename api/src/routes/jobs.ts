import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds, type AuthUser } from "../services/access.js";
import { getJobStatus, getJobQueue } from "../services/queue.js";
import { jobEventBus } from "../services/job-events.js";

const app = new Hono<AppEnv>();
app.use("*", authMiddleware);

type NormalizedJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";

type QueueJobStatus = Record<string, unknown> & {
  state?: unknown;
  progress?: unknown;
  result?: unknown;
  failedReason?: unknown;
};

type QueueJobData = Record<string, unknown> & {
  payload?: unknown;
  runId?: unknown;
  userId?: unknown;
};

const ACTIVE_POLL_AFTER_MS = 2000;

function normalizeQueueState(state: unknown): NormalizedJobStatus {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "active":
      return "running";
    case "waiting":
    case "waiting-children":
    case "delayed":
    case "prioritized":
    case "paused":
      return "queued";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function normalizeProgressPercent(progress: unknown): number | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, progress));
}

function getResultError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const error = (result as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getRunIdFromJobData(data: unknown): string | null {
  const jobData = asRecord(data) as QueueJobData | null;
  if (!jobData) return null;
  const payload = asRecord(jobData.payload);
  return asString(payload?.runId) ?? asString(jobData.runId);
}

function getUserIdFromJobData(data: unknown): string | null {
  const jobData = asRecord(data) as QueueJobData | null;
  if (!jobData) return null;
  const payload = asRecord(jobData.payload);
  return asString(jobData.userId) ?? asString(payload?.userId);
}

async function canAccessRun(user: AuthUser, runId: string): Promise<boolean> {
  if (user.role === "admin") {
    const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).limit(1);
    return Boolean(run);
  }

  const projectIds = await getUserProjectIds(user);
  if (!projectIds || projectIds.length === 0) {
    return false;
  }

  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), inArray(runs.projectId, projectIds)))
    .limit(1);

  return Boolean(run);
}

async function canAccessQueueJob(user: AuthUser, data: unknown): Promise<boolean> {
  const runId = getRunIdFromJobData(data);
  if (runId) {
    return canAccessRun(user, runId);
  }

  const userId = getUserIdFromJobData(data);
  return userId === user.id;
}

function withNormalizedJobStatus(status: QueueJobStatus) {
  const normalizedStatus = normalizeQueueState(status.state);
  const terminal = normalizedStatus === "completed" || normalizedStatus === "failed" || normalizedStatus === "cancelled";
  const failedReason = typeof status.failedReason === "string" && status.failedReason.length > 0
    ? status.failedReason
    : null;

  return {
    ...status,
    status: normalizedStatus,
    progress_percent: normalizeProgressPercent(status.progress),
    terminal,
    poll_after_ms: terminal ? null : ACTIVE_POLL_AFTER_MS,
    error: normalizedStatus === "failed" ? failedReason ?? getResultError(status.result) : null,
  };
}

app.get("/sse", (c) => {
  return streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    // Listen to real-time events from plumber-sync and queue worker
    const handler = async (event: { jobId: string; state: string; progress: number; logs?: string[]; result?: Record<string, unknown>; failedReason?: string }) => {
      try {
        const user = c.get("user");
        let allowed = await canAccessRun(user, event.jobId).catch(() => false);
        if (!allowed) {
          const q = getJobQueue();
          const job = await q?.getJob(event.jobId).catch(() => null);
          allowed = job ? await canAccessQueueJob(user, job.data).catch(() => false) : false;
        }
        if (!allowed) return;

        await stream.writeSSE({
          event: "job-update",
          data: JSON.stringify({
            id: event.jobId,
            state: event.state,
            progress: event.progress,
            logs: event.logs,
            result: event.result,
            failedReason: event.failedReason,
          }),
        });
      } catch {
        // Ignore individual event failures; the polling loop handles stream closure.
      }
    };
    jobEventBus.on("jobStatus", handler);

    try {
      while (!aborted && !stream.closed) {
        try {
          const q = getJobQueue();
          if (!q) {
            await stream.sleep(2000);
            continue;
          }
          const jobs = await q.getJobs(["active", "waiting"]).catch(() => []);

          for (const job of jobs) {
            const user = c.get("user");
            if (!(await canAccessQueueJob(user, job.data).catch(() => false))) {
              continue;
            }

            const state = await job.getState();
            const progress = job.progress || 0;

            const runIdStr = getRunIdFromJobData(job.data);

            const eventData = {
              id: runIdStr || job.id,
              state,
              progress,
              type: job.data?.type,
              result: job.returnvalue,
              failedReason: job.failedReason,
            };

            await stream.writeSSE({
              event: "job-update",
              data: JSON.stringify(eventData),
            });
          }

          await stream.sleep(2000);
        } catch {
          break;
        }
      }
    } finally {
      jobEventBus.off("jobStatus", handler);
    }
  });
});

app.get("/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const q = getJobQueue();
  if (!q) {
    return c.json({ error: "Job not found or queue unavailable" }, 404);
  }

  const job = await q.getJob(jobId).catch(() => null);
  if (!job) {
    return c.json({ error: "Job not found or queue unavailable" }, 404);
  }

  const user = c.get("user");
  if (!(await canAccessQueueJob(user, job.data).catch(() => false))) {
    return c.json({ error: "Job not found or queue unavailable" }, 404);
  }

  const status = await getJobStatus(jobId).catch(() => null) as QueueJobStatus | null;

  if (!status) {
    return c.json({ error: "Job not found or queue unavailable" }, 404);
  }

  return c.json(withNormalizedJobStatus(status));
});

app.post("/:jobId/cancel", async (c) => {
  const jobId = c.req.param("jobId");
  const q = getJobQueue();
  if (!q) return c.json({ error: "Queue unavailable" }, 503);
  const job = await q.getJob(jobId).catch(() => null);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const user = c.get("user");
  if (!(await canAccessQueueJob(user, job.data).catch(() => false))) {
    return c.json({ error: "Job not found" }, 404);
  }

  const state = await job.getState();
  if (state === "active" || state === "waiting") {
    await job.remove();
    return c.json({ ok: true, message: `Job ${state} and removed` });
  }

  return c.json({ ok: false, message: `Cannot cancel job in state: ${state}` }, 400);
});

export default app;
