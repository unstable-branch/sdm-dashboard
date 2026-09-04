import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { climateRateLimit } from "../middleware/rate-limit.js";
import { logAction, extractClientInfo } from "../services/audit.js";

export const downloadsRoutes = new Hono<AppEnv>();

downloadsRoutes.use("*", climateRateLimit);
downloadsRoutes.use("*", authMiddleware);

const CLIMATE_JOB_PREFIX = "climate_";

function isClimateJobId(jobId: string): boolean {
  return jobId.startsWith(CLIMATE_JOB_PREFIX);
}

function safeJobId(jobId: string): string {
  const decoded = decodeURIComponent(jobId);
  if (!/^[a-zA-Z0-9_-]+$/.test(decoded)) return "";
  return decoded;
}

downloadsRoutes.get("/status/:jobId", async (c) => {
  const raw = c.req.param("jobId");
  const jobId = safeJobId(raw);
  if (!jobId) return c.json({ error: "Invalid job ID" }, 400);

  try {
    const result = isClimateJobId(jobId)
      ? await plumberClient.getClimateStatus(jobId)
      : await plumberClient.get(`/api/v1/jobs/status/${jobId}`);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get status";
    const status = (err as { status?: number }).status ?? 502;
    return c.json({ error: message, status: "unknown" }, status as 400 | 401 | 403 | 404 | 500 | 502 | 503);
  }
});

downloadsRoutes.post("/cancel/:jobId", async (c) => {
  const raw = c.req.param("jobId");
  const jobId = safeJobId(raw);
  if (!jobId) return c.json({ error: "Invalid job ID" }, 400);

  const user = c.get("user");
  const path = isClimateJobId(jobId)
    ? `/api/v1/climate/cancel/${jobId}`
    : `/api/v1/jobs/cancel/${jobId}`;

  try {
    const result = await plumberClient.withUser(user.id).post(path, {});
    const client = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: isClimateJobId(jobId) ? "climate_download_cancelled" : "covariate_download_cancelled",
      entity: isClimateJobId(jobId) ? "climate" : "covariates",
      entityId: jobId,
      ...client,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    const status = (err as { status?: number }).status ?? 502;
    return c.json({ error: message }, status as 502 | 403 | 404 | 500);
  }
});
