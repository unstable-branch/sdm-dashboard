import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJobStatus, getJobQueue } from "../services/queue.js";
import { jobEventBus } from "../services/job-events.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray, or } from "drizzle-orm";

const app = new Hono<AppEnv>();

app.use("/sse", authMiddleware);

app.get("/sse", (c) => {
  const user = c.get("user");

  return streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    // Get user's project IDs once (admin = null = all)
    const myProjectIds = await getUserProjectIds(user);

    // Helper: check if a job's runId belongs to this user
    const isMyRun = async (runId: string | undefined | null): Promise<boolean> => {
      if (!runId) return false;
      if (myProjectIds === null) return true; // admin sees everything
      const [run] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, runId), inArray(runs.projectId, myProjectIds)))
        .limit(1);
      return Boolean(run);
    };

    // Listen to real-time events from plumber-sync and queue worker
    const handler = async (event: { jobId: string; state: string; progress: number; logs?: string[]; result?: Record<string, unknown>; failedReason?: string }) => {
      // Check if this event's jobId maps to a run the user can access
      if (!(await isMyRun(event.jobId))) return;

      stream.writeSSE({
        event: "job-update",
        data: JSON.stringify({
          id: event.jobId,
          type: "sdm_model",
          state: event.state,
          progress: event.progress,
          logs: event.logs,
          result: event.result,
          failedReason: event.failedReason,
        }),
      }).catch(() => {});
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
            const state = await job.getState();
            const progress = job.progress || 0;

            const jobData = job.data as Record<string, unknown> | undefined;
            const payload = jobData?.payload as Record<string, unknown> | undefined;
            const runId = (payload?.runId as string) || jobData?.runId as string | undefined;

            if (!(await isMyRun(runId))) continue;

            const eventData = {
              id: runId || job.id,
              state,
              progress,
              type: jobData?.type,
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

app.use("/:jobId", authMiddleware);

app.get("/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const user = c.get("user");
  const myProjectIds = await getUserProjectIds(user);

  // Verify the job's run belongs to this user
  if (myProjectIds !== null) {
    const [run] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        eq(runs.id, jobId),
        inArray(runs.projectId, myProjectIds)
      ))
      .limit(1);
    if (!run) {
      return c.json({ error: "Job not found" }, 404);
    }
  }

  const status = await getJobStatus(jobId).catch(() => null);

  if (!status) {
    return c.json({ error: "Job not found or queue unavailable" }, 404);
  }

  return c.json(status);
});

app.post("/:jobId/cancel", async (c) => {
  const jobId = c.req.param("jobId");
  const user = c.get("user");
  const myProjectIds = await getUserProjectIds(user);

  // Verify the job's run belongs to this user
  if (myProjectIds !== null) {
    const [run] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        eq(runs.id, jobId),
        inArray(runs.projectId, myProjectIds)
      ))
      .limit(1);
    if (!run) {
      return c.json({ error: "Job not found" }, 404);
    }
  }

  const q = getJobQueue();
  if (!q) return c.json({ error: "Queue unavailable" }, 503);
  const job = await q.getJob(jobId).catch(() => null);

  if (!job) {
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
