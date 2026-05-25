import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { plumberClient } from "../services/plumber.js";
import { getUserProjectIds } from "../services/access.js";

export const ecologyRoutes = new Hono<AppEnv>();

ecologyRoutes.use("*", authMiddleware);

async function canAccessRun(user: AppEnv["Variables"]["user"], runId: string): Promise<boolean> {
  const projectIds = await getUserProjectIds(user);
  if (projectIds && projectIds.length === 0) {
    return false;
  }

  const conditions = [eq(runs.id, runId)];
  if (projectIds) {
    conditions.push(inArray(runs.projectId, projectIds));
  }

  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(...conditions))
    .limit(1);

  return Boolean(run);
}

async function requireRunAccess(c: Context<AppEnv>, runId: string): Promise<Response | null> {
  const user = c.get("user");
  if (!(await canAccessRun(user, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }

  return null;
}

ecologyRoutes.get("/:runId", async (c) => {
  try {
    const runId = c.req.param("runId");
    const denied = await requireRunAccess(c, runId);
    if (denied) return denied;

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
    const denied = await requireRunAccess(c, runId);
    if (denied) return denied;

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
    const denied = await requireRunAccess(c, runId);
    if (denied) return denied;

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
    const denied = await requireRunAccess(c, runId);
    if (denied) return denied;

    const report = await plumberClient.getEcologyReport(runId);
    return c.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return c.json({ error: message }, 502);
  }
});
