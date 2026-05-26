import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { canAccessRun } from "../services/access.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const diagnosticsRoutes = new Hono<AppEnv>();

diagnosticsRoutes.use("*", defaultRateLimit);
diagnosticsRoutes.use("*", authMiddleware);

async function plumberJobId(runId: string): Promise<string> {
  const [run] = await db
    .select({ jobId: runs.jobId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return run?.jobId ?? runId;
}

diagnosticsRoutes.get("/vif/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsVif(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "VIF diagnostics unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/response-curves/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsResponseCurves(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Response curves unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/importance/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsImportance(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Variable importance unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/cbi/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsCbi(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CBI diagnostics unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/mess/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsMess(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "MESS diagnostics unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/summary/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsSummary(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Diagnostics summary unavailable";
    return c.json({ error: message }, 502);
  }
});
