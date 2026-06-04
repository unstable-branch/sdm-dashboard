import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";

export const covariatesRoutes = new Hono<AppEnv>();

covariatesRoutes.use("*", authMiddleware);

// Existing sync download — kept for backward compatibility (direct Plumber proxy)
covariatesRoutes.post("/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const [status, result] = await plumberClient.withUser(user.id).postRaw("/api/v1/covariates/download", body);
    return c.json(result, status >= 400 ? (status as 400 | 500) : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Covariate download failed";
    return c.json({ status: "error", message }, 502);
  }
});

// Background download with progress tracking — returns a job_id for WebSocket progress
covariatesRoutes.post("/download_bg", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const user = c.get("user");

    const jobId = await enqueueSdmJob(
      { type: "covariate_download", payload: body },
      user.id
    ).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Redis unavailable")) {
        return null;
      }
      throw err;
    });

    if (jobId === null) {
      const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
      return c.json({
        error: "Covariate download queuing requires Redis.",
        detail: `Cannot connect to ${redisUrl}. Check that Redis is running, or set REDIS_URL to the correct address.`,
        tip: "Run 'docker compose up -d redis' to start Redis.",
      }, 503);
    }

    return c.json({ jobId, status: "queued" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start covariate download";
    return c.json({ error: message }, 502);
  }
});
