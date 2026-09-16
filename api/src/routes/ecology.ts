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
    const body = await c.req.json() as Record<string, unknown>;
    const user = c.get("user");
    const runId1 = typeof body.run_id_1 === "string" ? body.run_id_1 : typeof body.runId1 === "string" ? body.runId1 : "";
    const runId2 = typeof body.run_id_2 === "string" ? body.run_id_2 : typeof body.runId2 === "string" ? body.runId2 : "";
    if (!runId1 || !runId2) {
      return c.json({ error: "Both source runs are required" }, 400);
    }
    const [canAccess1, canAccess2] = await Promise.all([
      checkAccess(user.id, user.role, runId1),
      checkAccess(user.id, user.role, runId2),
    ]);
    if (!canAccess1 || !canAccess2) {
      return c.json({ error: "Run not found" }, 404);
    }
    const data = await plumberClient.withUser(user.id).withRole(user.role).postNicheOverlap(body);
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
    const data = await plumberClient.withUser(user.id).withRole(user.role).getEcologyData(await resolveJobId(runId));
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
    const data = await plumberClient.withUser(user.id).withRole(user.role).getEooAoo(await resolveJobId(runId));
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
    const data = await plumberClient.withUser(user.id).withRole(user.role).getAoa(await resolveJobId(runId));
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
    const report = await plumberClient.withUser(user.id).withRole(user.role).getEcologyReport(await resolveJobId(runId));
    return c.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return c.json({ error: message }, 502);
  }
});
