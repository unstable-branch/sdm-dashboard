import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { climateRateLimit } from "../middleware/rate-limit.js";
import { longCache } from "../middleware/cache.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";

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

    const params = new URLSearchParams({ source, resolution, biovars, gcm, ssp, period });
    const result = await fetch(`${process.env.PLUMBER_URL || "http://localhost:8000"}/api/v1/climate/check?${params}`);
    if (!result.ok) {
      return c.json({ available: [], missing: [] });
    }
    return c.json(await result.json());
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

    if (type === "cmip6_average" && (!Array.isArray(body.gcm_list) || body.gcm_list.length < 2)) {
      return c.json({ error: "Multi-GCM averaging requires at least 2 GCMs in gcm_list" }, 400);
    }

    const jobId = await enqueueSdmJob(
      {
        type: "climate_download",
        payload: body,
      },
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
        error: "Climate download queuing requires Redis.",
        detail: `Cannot connect to ${redisUrl}. Check that Redis is running, or set REDIS_URL to the correct address.`,
        tip: "Run 'docker compose up -d redis' to start Redis.",
      }, 503);
    }

    return c.json({ jobId, status: "queued" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Climate download failed";
    return c.json({ error: message }, 502);
  }
});

climateRoutes.post("/delete/:scenarioId", async (c) => {
  try {
    const scenarioId = c.req.param("scenarioId");
    const result = await plumberClient.deleteClimateScenario(scenarioId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return c.json({ error: message }, 502);
  }
});

climateRoutes.post("/cancel/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const result = await plumberClient.post(`/api/v1/climate/cancel/${jobId}`, {});
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    return c.json({ error: message }, 502);
  }
});

// Climate progress is tracked via SSE (/api/v1/jobs/sse) and BullMQ job status
// No separate HTTP endpoint needed
