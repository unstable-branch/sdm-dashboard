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
      try {
        const [run] = await db
          .select({ id: runs.id })
          .from(runs)
          .where(and(eq(runs.id, runId), inArray(runs.projectId, myProjectIds)))
          .limit(1);
        return Boolean(run);
      } catch {
        return false;
      }
    };

    // Listen to real-time events from plumber-sync and queue worker
    const handler = async (event: { jobId: string; state: string; progress: number; logs?: string[]; result?: Record<string, unknown>; failedReason?: string; error_code?: string | null; error_hint?: string | null }) => {
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
          error_code: event.error_code ?? null,
          error_hint: event.error_hint ?? null,
        }),
      }).catch(() => console.warn("[jobs] SSE write failed for job status event"));
    };
    jobEventBus.on("jobStatus", handler);

    // Send initial state: active runs from DB (catches jobs that missed early SSE events)
    try {
      const conditions = myProjectIds
        ? and(inArray(runs.projectId, myProjectIds), inArray(runs.status, ["queued", "running"]))
        : inArray(runs.status, ["queued", "running"]);
      const activeRuns = await db
        .select({ id: runs.id, status: runs.status })
        .from(runs)
        .where(conditions)
        .limit(20);

      for (const run of activeRuns) {
        stream.writeSSE({
          event: "job-update",
          data: JSON.stringify({
            id: run.id,
            type: "sdm_model",
            state: run.status,
            progress: 0,
            logs: ["Model run in progress..."],
          }),
        }).catch(() => console.warn("[jobs] SSE write failed for initial active-run event"));
      }
    } catch {
      // Best-effort — initial state is non-critical
    }

    try {
      // Keep connection open — jobEventBus handles all updates
      while (!aborted && !stream.closed) {
        await stream.sleep(5000);
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
    try {
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
    } catch {
      return c.json({ error: "Internal error" }, 500);
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
    try {
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
    } catch {
      return c.json({ error: "Internal error" }, 500);
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
