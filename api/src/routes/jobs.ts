import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJobStatus, getJobQueue } from "../services/queue.js";
import { jobEventBus } from "../services/job-events.js";

const app = new Hono();

app.get("/sse", (c) => {
  return streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    // Listen to real-time events from plumber-sync and queue worker
    const handler = (event: { jobId: string; state: string; progress: number; logs?: string[]; result?: Record<string, unknown>; failedReason?: string }) => {
      stream.writeSSE({
        event: "job-update",
        data: JSON.stringify({
          id: event.jobId,
          state: event.state,
          progress: event.progress,
          logs: event.logs,
          result: event.result,
          failedReason: event.failedReason,
        }),
      }).catch(() => {});
    };
    jobEventBus.on("jobStatus", handler);

    while (!aborted && !stream.closed) {
      try {
        const q = getJobQueue();
        if (!q) {
          await stream.sleep(2000);
          continue;
        }
        const jobs = await q.getJobs(["active", "waiting", "completed", "failed"]).catch(() => []);

        for (const job of jobs) {
          const state = await job.getState();
          const progress = job.progress || 0;

          const runId = (job.data as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
          const runIdStr = (runId?.runId as string) || (job.data as Record<string, unknown>)?.runId as string;

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

    jobEventBus.off("jobStatus", handler);
  });
});

app.get("/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const status = await getJobStatus(jobId).catch(() => null);

  if (!status) {
    return c.json({ error: "Job not found or queue unavailable" }, 404);
  }

  return c.json(status);
});

app.post("/:jobId/cancel", async (c) => {
  const jobId = c.req.param("jobId");
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
