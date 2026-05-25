import { Hono, type Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { plumberClient } from "../services/plumber.js";
import { defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";

export const diagnosticsRoutes = new Hono<AppEnv>();

diagnosticsRoutes.use("*", defaultRateLimit);
diagnosticsRoutes.use("*", authMiddleware);

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

async function requireRunAccess(c: Context<AppEnv>, runId: string) {
  const user = c.get("user");
  if (!(await canAccessRun(user, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }

  return null;
}

diagnosticsRoutes.get("/vif/:runId", async (c) => {
  const runId = c.req.param("runId");
  const accessDenied = await requireRunAccess(c, runId);
  if (accessDenied) return accessDenied;

  try {
    const data = await plumberClient.getDiagnosticsVif(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "VIF diagnostics unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/response-curves/:runId", async (c) => {
  const runId = c.req.param("runId");
  const accessDenied = await requireRunAccess(c, runId);
  if (accessDenied) return accessDenied;

  try {
    const data = await plumberClient.getDiagnosticsResponseCurves(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Response curves unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/importance/:runId", async (c) => {
  const runId = c.req.param("runId");
  const accessDenied = await requireRunAccess(c, runId);
  if (accessDenied) return accessDenied;

  try {
    const data = await plumberClient.getDiagnosticsImportance(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Variable importance unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/cbi/:runId", async (c) => {
  const runId = c.req.param("runId");
  const accessDenied = await requireRunAccess(c, runId);
  if (accessDenied) return accessDenied;

  try {
    const data = await plumberClient.getDiagnosticsCbi(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CBI diagnostics unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/mess/:runId", async (c) => {
  const runId = c.req.param("runId");
  const accessDenied = await requireRunAccess(c, runId);
  if (accessDenied) return accessDenied;

  try {
    const data = await plumberClient.getDiagnosticsMess(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "MESS diagnostics unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/summary/:runId", async (c) => {
  const runId = c.req.param("runId");
  const accessDenied = await requireRunAccess(c, runId);
  if (accessDenied) return accessDenied;

  try {
    const data = await plumberClient.getDiagnosticsSummary(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Diagnostics summary unavailable";
    return c.json({ error: message }, 502);
  }
});
