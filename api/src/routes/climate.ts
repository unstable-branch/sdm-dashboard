import { Hono } from "hono";
import { plumberClient } from "../services/plumber";
import { enqueueSdmJob } from "../services/queue";
import { climateRateLimit } from "../middleware/rate-limit";

export const climateRoutes = new Hono();

climateRoutes.use("*", climateRateLimit);

climateRoutes.post("/download", async (c) => {
  try {
    const body = await c.req.json();
    const type = (body.type as string) || "cmip6";

    if (!["cmip6", "cmip6_average", "worldclim", "chelsa"].includes(type)) {
      return c.json({ error: "Invalid download type. Must be: cmip6, cmip6_average, worldclim, chelsa" }, 400);
    }

    if (type === "cmip6_average" && (!Array.isArray(body.gcm_list) || body.gcm_list.length < 2)) {
      return c.json({ error: "Multi-GCM averaging requires at least 2 GCMs in gcm_list" }, 400);
    }

    const jobId = await enqueueSdmJob({
      type: "climate_download",
      payload: body,
    });

    return c.json({ jobId, status: "queued" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Climate download failed";
    return c.json({ error: message }, 502);
  }
});

climateRoutes.get("/scenarios", async (c) => {
  try {
    const scenarios = await plumberClient.getClimateScenarios();
    return c.json(scenarios);
  } catch {
    return c.json({ scenarios: [], message: "Plumber unavailable" });
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
