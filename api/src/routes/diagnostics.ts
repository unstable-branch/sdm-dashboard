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
  if (!run || run.jobId == null) {
    throw new Error("Run has no Plumber job ID (not yet started): " + runId);
  }
  return run.jobId;
}

interface DiagEndpoint {
  errorMsg: string;
  fetch: (client: typeof plumberClient, jobId: string) => Promise<unknown>;
}

const DIAG_ENDPOINTS: Record<string, DiagEndpoint> = {
  vif:               { errorMsg: "VIF diagnostics unavailable",           fetch: (client, j) => client.getDiagnosticsVif(j) },
  ale:               { errorMsg: "ALE data unavailable",                 fetch: (client, j) => client.getDiagnosticsAle(j) },
  "climate-drivers": { errorMsg: "Climate driver data unavailable",       fetch: (client, j) => client.getDiagnosticsClimateDrivers(j) },
  "response-curves":  { errorMsg: "Response curves unavailable",           fetch: (client, j) => client.getDiagnosticsResponseCurves(j) },
  importance:         { errorMsg: "Variable importance unavailable",        fetch: (client, j) => client.getDiagnosticsImportance(j) },
  cbi:               { errorMsg: "CBI diagnostics unavailable",             fetch: (client, j) => client.getDiagnosticsCbi(j) },
  mess:              { errorMsg: "MESS diagnostics unavailable",             fetch: (client, j) => client.getDiagnosticsMess(j) },
  roc:               { errorMsg: "ROC data unavailable",                    fetch: (client, j) => client.getDiagnosticsRoc(j) },
  calibration:        { errorMsg: "Calibration data unavailable",            fetch: (client, j) => client.getDiagnosticsCalibration(j) },
  "cv-folds":        { errorMsg: "CV folds data unavailable",             fetch: (client, j) => client.getDiagnosticsCvFolds(j) },
  threshold:         { errorMsg: "Threshold data unavailable",             fetch: (client, j) => client.getDiagnosticsThreshold(j) },
  density:           { errorMsg: "Density data unavailable",               fetch: (client, j) => client.getDiagnosticsDensity(j) },
  summary:           { errorMsg: "Diagnostics summary unavailable",       fetch: (client, j) => client.getDiagnosticsSummary(j) },
};

for (const [path, { errorMsg, fetch }] of Object.entries(DIAG_ENDPOINTS)) {
  diagnosticsRoutes.get(`/${path}/:runId`, async (c) => {
    const runId = c.req.param("runId");
    const user = c.get("user");
    if (!(await canAccessRun(user.id, user.role, runId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    try {
      const jobId = await plumberJobId(runId);
      const client = plumberClient.withUser(user.id).withRole(user.role);
      return c.json(await fetch(client, jobId));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : errorMsg }, 502);
    }
  });
}

// On-demand ensemble statistics raster generation (multi-ensemble only)
diagnosticsRoutes.post("/ensemble-rasters/:runId", async (c) => {
  const runId = c.req.param("runId");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  try {
    const jobId = await plumberJobId(runId);
    const result = await plumberClient.withUser(user.id).withRole(user.role).generateEnsembleRasters(jobId);
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
    const data = await plumberClient.withUser(user.id).withRole(user.role).postDiagnosticsShapCell(jobId, longitude, latitude);
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
    const csvRes = await plumberClient.withUser(user.id).withRole(user.role).getDiagnosticDataCsv(jobId, type);
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
