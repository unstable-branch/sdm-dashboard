import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJobStatus, sdmQueue } from "../services/queue";

const app = new Hono();

app.get("/sse", (c) => {
  return streamSSE(c, async (stream) => {
    while (true) {
      const jobs = await sdmQueue.getJobs(["active", "waiting", "completed", "failed"]);

      for (const job of jobs) {
        const state = await job.getState();
        const progress = job.progress || 0;

        await stream.writeSSE({
          event: "job-update",
          data: JSON.stringify({
            id: job.id,
            state,
            progress,
            type: job.data?.type,
            result: job.returnvalue,
            failedReason: job.failedReason,
          }),
        });
      }

      await stream.sleep(2000);
    }
  });
});

app.get("/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const status = await getJobStatus(jobId);

  if (!status) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json(status);
});

app.post("/:jobId/cancel", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await sdmQueue.getJob(jobId);

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
