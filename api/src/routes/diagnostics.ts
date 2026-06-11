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

diagnosticsRoutes.get("/ale/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsAle(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ALE data unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/climate-drivers/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsClimateDrivers(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Climate driver data unavailable";
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

diagnosticsRoutes.get("/roc/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsRoc(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ROC data unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/calibration/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsCalibration(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calibration data unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/cv-folds/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsCvFolds(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CV folds data unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/threshold/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsThreshold(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Threshold data unavailable";
    return c.json({ error: message }, 502);
  }
});

diagnosticsRoutes.get("/density/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.getDiagnosticsDensity(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Density data unavailable";
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

// On-demand ensemble statistics raster generation (multi-ensemble only)
diagnosticsRoutes.post("/ensemble-rasters/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const result = await plumberClient.generateEnsembleRasters(jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ensemble raster generation failed";
    return c.json({ error: message }, 502);
  }
});

// On-demand diagnostic routes removed — plots are generated
// automatically during model run and served via file endpoints

// SHAP cell-level explanation for a specific coordinate
diagnosticsRoutes.post("/shap/cell", async (c) => {
  try {
    const body = await c.req.json();
    const runId = (body.run_id || body.runId || "") as string;
    const longitude = parseFloat(body.longitude as string);
    const latitude = parseFloat(body.latitude as string);
    if (!runId || isNaN(longitude) || isNaN(latitude)) {
      return c.json({ error: "run_id, longitude, and latitude required" }, 400);
    }
    const user = c.get("user");
    if (!(await canAccessRun(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const jobId = await plumberJobId(runId);
    const data = await plumberClient.postDiagnosticsShapCell(jobId, longitude, latitude);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SHAP cell explanation unavailable";
    return c.json({ error: message }, 502);
  }
});

// Diagnostic CSV data download
diagnosticsRoutes.get("/data/:runId/:type", async (c) => {
  const runId = c.req.param("runId");
  const type = c.req.param("type");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const csvRes = await plumberClient.getDiagnosticDataCsv(jobId, type);
    if (!csvRes.ok) {
      return c.json({ error: `Plumber returned ${csvRes.status}` }, 502);
    }
    const csvText = await csvRes.text();
    return c.newResponse(csvText, 200, {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${type}_${runId}.csv"`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Diagnostic data unavailable";
    return c.json({ error: message }, 502);
  }
});
