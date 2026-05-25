import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { canAccessRun } from "../services/access.js";

export const ecologyRoutes = new Hono<AppEnv>();

ecologyRoutes.use("*", authMiddleware);

ecologyRoutes.get("/:runId", async (c) => {
  try {
    const runId = c.req.param("runId");
    const user = c.get("user");
    if (!(await canAccessRun(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.getEcologyData(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch ecology data";
    return c.json({ error: message }, 502);
  }
});

ecologyRoutes.get("/:runId/eoo-aoo", async (c) => {
  try {
    const runId = c.req.param("runId");
    const user = c.get("user");
    if (!(await canAccessRun(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.getEooAoo(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch EOO/AOO";
    return c.json({ error: message }, 502);
  }
});

ecologyRoutes.get("/:runId/aoa", async (c) => {
  try {
    const runId = c.req.param("runId");
    const user = c.get("user");
    if (!(await canAccessRun(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.getAoa(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch AOA";
    return c.json({ error: message }, 502);
  }
});

ecologyRoutes.get("/:runId/report", async (c) => {
  try {
    const runId = c.req.param("runId");
    const user = c.get("user");
    if (!(await canAccessRun(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const report = await plumberClient.getEcologyReport(runId);
    return c.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return c.json({ error: message }, 502);
  }
});
