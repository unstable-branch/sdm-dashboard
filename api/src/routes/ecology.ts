import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { canAccessRun } from "../services/access.js";

export const ecologyRoutes = new Hono<AppEnv>();

ecologyRoutes.use("*", authMiddleware);

async function resolveJobId(runId: string): Promise<string> {
  const [run] = await db
    .select({ jobId: runs.jobId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return run?.jobId || runId;
}

async function checkAccess(userId: string, userRole: string, runId: string): Promise<boolean> {
  return canAccessRun(userId, userRole, runId);
}

ecologyRoutes.post("/niche-overlap", async (c) => {
  try {
    const body = await c.req.json();
    const data = await plumberClient.postNicheOverlap(body);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Niche overlap computation failed";
    return c.json({ error: message }, 502);
  }
});

ecologyRoutes.get("/:runId", async (c) => {
  try {
    const runId = c.req.param("runId");
    const user = c.get("user");
    if (!(await checkAccess(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.getEcologyData(await resolveJobId(runId));
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
    if (!(await checkAccess(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.getEooAoo(await resolveJobId(runId));
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
    if (!(await checkAccess(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.getAoa(await resolveJobId(runId));
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
    if (!(await checkAccess(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const report = await plumberClient.getEcologyReport(await resolveJobId(runId));
    return c.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return c.json({ error: message }, 502);
  }
});
