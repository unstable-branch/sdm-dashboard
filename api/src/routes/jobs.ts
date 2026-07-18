import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJobStatus, getJobQueue } from "../services/queue.js";
import { jobEventBus } from "../services/job-events.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";

const app = new Hono<AppEnv>();

const MAX_SSE_CLIENTS = 500;
let activeSseClients = 0;

app.use("/sse", authMiddleware);

app.get("/sse", async (c) => {
  const user = c.get("user");

  if (activeSseClients >= MAX_SSE_CLIENTS) {
    return c.json({ error: "Too many connections. Try again later." }, 503);
  }
  activeSseClients++;
  const cleanup = () => { activeSseClients = Math.max(0, activeSseClients - 1); };

  // Get user's project IDs once (admin = null = all)
  const myProjectIds = await getUserProjectIds(user);

  return streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
      cleanup();
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
      } catch (e) {
        console.warn("[jobs]", e instanceof Error ? e.message : String(e));
        return false;
      }
    };

    // Listen to real-time events from plumber-sync and queue worker
    // Use a promise chain to process events sequentially (avoids pile-up from async handlers)
    let eventQueue = Promise.resolve();
    const handler = (event: { jobId: string; state: string; progress: number; logs?: string[]; result?: Record<string, unknown>; failedReason?: string; error_code?: string | null; error_hint?: string | null; currentStage?: string | null; progressJson?: unknown }) => {
      eventQueue = eventQueue.then(async () => {
        try {
          if (!(await isMyRun(event.jobId))) return;
          await stream.writeSSE({
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
              currentStage: event.currentStage ?? null,
              progressJson: event.progressJson ?? null,
            }),
          });
        } catch (err) {
          console.error("[jobs] SSE write failed:", err instanceof Error ? err.message : String(err));
          aborted = true;
        }
      });
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
        }).catch((err) => console.warn("[jobs] SSE write failed for initial active-run event:", err instanceof Error ? err.message : String(err)));
      }
    } catch (err) {
      console.warn("[jobs] Failed to fetch initial active runs:", err instanceof Error ? err.message : String(err));
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
  let myProjectIds: string[] | null;
  try {
    myProjectIds = await getUserProjectIds(user);
  } catch (err) {
    console.warn("[jobs] Failed to resolve job access:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Job status temporarily unavailable" }, 503);
  }
  const isAsyncDataJob = jobId.startsWith("climate_") || jobId.startsWith("data-");

  let persistedRun: {
    id: string;
    jobId: string | null;
    status: string;
    error: string | null;
    errorCode: string | null;
    errorHint: string | null;
    progressLog: unknown;
  } | undefined;

  if (!isAsyncDataJob) {
    try {
      const ownership = myProjectIds === null
        ? eq(runs.id, jobId)
        : and(eq(runs.id, jobId), inArray(runs.projectId, myProjectIds));
      [persistedRun] = await db
        .select({
          id: runs.id,
          jobId: runs.jobId,
          status: runs.status,
          error: runs.error,
          errorCode: runs.errorCode,
          errorHint: runs.errorHint,
          progressLog: runs.progressLog,
        })
        .from(runs)
        .where(ownership)
        .limit(1);
      if (!persistedRun) return c.json({ error: "Job not found" }, 404);
    } catch (err) {
      console.warn("[jobs] Failed to read persisted job status:", err instanceof Error ? err.message : String(err));
      return c.json({ error: "Job status temporarily unavailable" }, 503);
    }
  } else {
    if (myProjectIds !== null && myProjectIds.length === 0) {
      return c.json({ error: "Job not found" }, 404);
    }
    if (user.role !== "admin") {
      const ownedProjectIds = myProjectIds ?? [];
      const [projectRun] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(and(
          eq(runs.jobId, jobId),
          inArray(runs.projectId, ownedProjectIds)
        ))
        .limit(1);
      if (!projectRun) return c.json({ error: "Job not found" }, 404);
    }
  }

  // BullMQ has the most detailed live state while its retention window is active.
  const status = await getJobStatus(jobId).catch(() => null);
  if (status) return c.json(status);

  // Plumber uses its own job ID, which differs from the persisted run UUID.
  const plumberJobId = persistedRun?.jobId || jobId;
  const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
  const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
  try {
    const plumberStatusPath = persistedRun
      ? "models/status"
      : jobId.startsWith("climate_") ? "climate/status" : "jobs/status";
    const res = await fetch(`${plumberUrl}/api/v1/${plumberStatusPath}/${plumberJobId}`, {
      headers: {
        ...(internalKey ? { "X-Hono-Internal": internalKey } : {}),
        "X-Forwarded-User": user.id,
      },
    });
    if (res.ok) {
      const plumberStatus = await res.json() as Record<string, unknown>;
      return c.json({
        id: jobId,
        state: plumberStatus.status || "unknown",
        progress: plumberStatus.progress ?? 0,
        type: plumberStatus.type || "data_job",
        logs: plumberStatus.progress_log || [],
        result: plumberStatus.result || null,
        failedReason: plumberStatus.error || null,
        error_code: plumberStatus.error_code || null,
        error_hint: plumberStatus.error_hint || null,
      });
    }
  } catch {
    // Fall through to the durable DB status for model runs.
  }

  if (persistedRun) {
    return c.json({
      id: persistedRun.id,
      state: persistedRun.status,
      progress: persistedRun.status === "completed" ? 100 : 0,
      type: "sdm_model",
      logs: Array.isArray(persistedRun.progressLog) ? persistedRun.progressLog : [],
      result: null,
      failedReason: persistedRun.error,
      error_code: persistedRun.errorCode,
      error_hint: persistedRun.errorHint,
    });
  }

  return c.json({ error: "Job not found" }, 404);
});

export default app;
