import { Hono } from "hono";

export const jobsRoutes = new Hono();

jobsRoutes.get("/", async (c) => {
  return c.json([]);
});

jobsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  return c.json({
    jobId: id,
    status: "running",
    progress: 0.5,
    progressLabel: "Fitting model",
    logs: ["Cleaning occurrence data...", "Loading covariates..."],
  });
});

jobsRoutes.get("/:id/stream", async (c) => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(`data: ${JSON.stringify({ type: "progress", pct: 0.5 })}\n\n`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

jobsRoutes.delete("/:id", async (c) => {
  return c.json({ ok: true });
});
