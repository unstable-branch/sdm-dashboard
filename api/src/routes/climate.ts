import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { climateRateLimit } from "../middleware/rate-limit.js";
import { longCache } from "../middleware/cache.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import { getUserProjectIds } from "../services/access.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";

export const climateRoutes = new Hono<AppEnv>();

climateRoutes.use("*", climateRateLimit);
climateRoutes.use("/download", authMiddleware);
climateRoutes.use("/delete/*", authMiddleware);
climateRoutes.use("*", optionalAuth);

climateRoutes.get("/scenarios", longCache, async (c) => {
  try {
    const scenarios = await plumberClient.getClimateScenarios();
    return c.json(scenarios);
  } catch (e) {
    console.warn("[climate]", e instanceof Error ? e.message : String(e));
    return c.json({ scenarios: [], message: "Plumber unavailable" });
  }
});

climateRoutes.get("/check", async (c) => {
  try {
    const source = c.req.query("source") || "worldclim";
    const resolution = c.req.query("resolution") || c.req.query("res") || "10";
    const biovars = c.req.query("biovars") || "";
    const gcm = c.req.query("gcm") || "";
    const ssp = c.req.query("ssp") || "";
    const period = c.req.query("period") || "";

    const result = await plumberClient.getClimateCheck({ source, resolution, biovars, gcm, ssp, period });
    return c.json(result);
  } catch (e) {
    console.warn("[climate]", e instanceof Error ? e.message : String(e));
    return c.json({ available: [], missing: [] });
  }
});

climateRoutes.post("/download", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const type = (body.type as string) || "cmip6";
    const user = c.get("user");

    if (!["cmip6", "cmip6_average", "worldclim", "chelsa"].includes(type)) {
      return c.json({ error: "Invalid download type. Must be: cmip6, cmip6_average, worldclim, chelsa" }, 400);
    }

    // Validate resolution per type
    const res = body.res !== undefined ? Number(body.res) : undefined;
    const validResolutions: Record<string, number[]> = {
      worldclim: [2.5, 5, 10],
      chelsa: [0.5],
      cmip6: [2.5, 5, 10],
      cmip6_average: [2.5, 5, 10],
    };
    if (res !== undefined && !validResolutions[type]?.includes(res)) {
      return c.json({
        error: `Invalid resolution '${body.res}' for type '${type}'. Valid: ${validResolutions[type].join(", ")}`,
      }, 400);
    }

    if (type === "cmip6_average" && (!Array.isArray(body.gcm_list) || body.gcm_list.length < 2)) {
      return c.json({ error: "Multi-GCM averaging requires at least 2 GCMs in gcm_list" }, 400);
    }

    const plumberData = await plumberClient.withUser(user.id).downloadClimate(body as Record<string, unknown>);

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "climate_download_started",
      entity: "climate",
      entityId: (plumberData as Record<string, unknown>).job_id as string ?? null,
      ...client,
      details: { type: body.type, resolution: body.res, source: body.source },
    });

    return c.json({ jobId: (plumberData as Record<string, unknown>).job_id, status: "queued" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Climate download failed";
    return c.json({ error: message }, 502);
  }
});

climateRoutes.post("/delete/:scenarioId", async (c) => {
  try {
    const scenarioId = c.req.param("scenarioId");
    const user = c.get("user");

    if (user.role !== "admin") {
      const projectIds = await getUserProjectIds(user);
      const ownedRun = await db
        .select({ id: runs.id })
        .from(runs)
        .where(
          projectIds && projectIds.length > 0
            ? and(
                eq(runs.jobId, scenarioId),
                inArray(runs.projectId, projectIds)
              )
            : eq(runs.id, "__never_match__")
        )
        .limit(1);
      if (!ownedRun) {
        return c.json({ error: "Scenario not found" }, 404);
      }
    }

    const result = await plumberClient.deleteClimateScenario(scenarioId);

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "climate_scenario_deleted",
      entity: "climate",
      entityId: scenarioId,
      ...client,
    });

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return c.json({ error: message }, 502);
  }
});

climateRoutes.post("/cancel/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const user = c.get("user");

    if (user.role !== "admin") {
      const projectIds = await getUserProjectIds(user);
      const [ownedRun] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(
          projectIds && projectIds.length > 0
            ? and(
                eq(runs.jobId, jobId),
                inArray(runs.projectId, projectIds)
              )
            : eq(runs.id, "__never_match__")
        )
        .limit(1);
      if (!ownedRun) {
        return c.json({ error: "Job not found" }, 404);
      }
    }

    const result = await plumberClient.post(`/api/v1/climate/cancel/${jobId}`, {});

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "climate_download_cancelled",
      entity: "climate",
      entityId: jobId,
      ...client,
    });

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    return c.json({ error: message }, 502);
  }
});

// Climate progress is tracked via SSE (/api/v1/jobs/sse) and BullMQ job status
// The dedicated status endpoint exists on Plumber but is not proxied through Hono:
//   GET /api/v1/climate/status/:jobId  →  plumber GET /api/v1/climate/status/{job_id}
climateRoutes.get("/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const result = await plumberClient.getClimateStatus(jobId);
    return c.json(result);
  } catch {
    return c.json({ status: "unknown" }, 502);
  }
});
