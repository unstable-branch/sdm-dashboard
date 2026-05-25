import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { climateRateLimit } from "../middleware/rate-limit.js";
import { longCache } from "../middleware/cache.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  getIdempotencyKeyFromHeaders,
  getIdempotentRouteDecision,
} from "../services/idempotency.js";
import type { AppEnv } from "../middleware/auth.js";

export const climateRoutes = new Hono<AppEnv>();

climateRoutes.use("*", climateRateLimit);
climateRoutes.use("/download", authMiddleware);
climateRoutes.use("/delete/*", authMiddleware);
climateRoutes.use("/status/*", authMiddleware);
climateRoutes.use("*", optionalAuth);

climateRoutes.get("/scenarios", longCache, async (c) => {
  try {
    const scenarios = await plumberClient.getClimateScenarios();
    return c.json(scenarios);
  } catch {
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
  } catch {
    return c.json({ available: [], missing: [] });
  }
});

climateRoutes.post("/download", async (c) => {
  let idempotencyEntryId: string | null = null;
  try {
    const body = await c.req.json();
    const type = (body.type as string) || "cmip6";
    const user = c.get("user");

    if (!["cmip6", "cmip6_average", "worldclim", "chelsa"].includes(type)) {
      return c.json({ error: "Invalid download type. Must be: cmip6, cmip6_average, worldclim, chelsa" }, 400);
    }

    if (type === "cmip6_average" && (!Array.isArray(body.gcm_list) || body.gcm_list.length < 2)) {
      return c.json({ error: "Multi-GCM averaging requires at least 2 GCMs in gcm_list" }, 400);
    }

    const idempotencyKey = getIdempotencyKeyFromHeaders(c.req.raw.headers);
    if (idempotencyKey) {
      const idempotency = await beginIdempotentRequest({
        projectId: null,
        userId: user.id,
        method: "POST",
        route: "/api/v1/climate/download",
        idempotencyKey,
        requestBody: body,
      });
      const decision = getIdempotentRouteDecision(idempotency);
      if (decision.action === "respond") {
        return c.json(decision.body, decision.statusCode);
      }
      idempotencyEntryId = decision.entry.id;
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
      const response = {
        error: "Climate download queuing requires Redis.",
        detail: `Cannot connect to ${redisUrl}. Check that Redis is running, or set REDIS_URL to the correct address.`,
        tip: "Run 'docker compose up -d redis' to start Redis.",
      };
      if (idempotencyEntryId) {
        await failIdempotentRequest({
          id: idempotencyEntryId,
          statusCode: 503,
          responseBody: response,
        }).catch(() => {});
      }
      return c.json(response, 503);
    }

    const response = { jobId, status: "queued" };
    if (idempotencyEntryId) {
      await completeIdempotentRequest({
        id: idempotencyEntryId,
        statusCode: 200,
        responseBody: response,
        resourceType: "climate_download",
        resourceId: jobId,
      });
    }
    return c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Climate download failed";
    if (idempotencyEntryId) {
      await failIdempotentRequest({
        id: idempotencyEntryId,
        statusCode: 502,
        responseBody: { error: message },
      }).catch(() => {});
    }
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

climateRoutes.get("/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const status = await plumberClient.getClimateStatus(jobId);
    return c.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Status check failed";
    return c.json({ error: message }, 502);
  }
});
