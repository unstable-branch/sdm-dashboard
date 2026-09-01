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

interface DiagEndpoint {
  errorMsg: string;
  fetch: (jobId: string) => Promise<unknown>;
}

const DIAG_ENDPOINTS: Record<string, DiagEndpoint> = {
  vif:               { errorMsg: "VIF diagnostics unavailable",           fetch: (j) => plumberClient.getDiagnosticsVif(j) },
  ale:               { errorMsg: "ALE data unavailable",                 fetch: (j) => plumberClient.getDiagnosticsAle(j) },
  "climate-drivers": { errorMsg: "Climate driver data unavailable",       fetch: (j) => plumberClient.getDiagnosticsClimateDrivers(j) },
  "response-curves":  { errorMsg: "Response curves unavailable",           fetch: (j) => plumberClient.getDiagnosticsResponseCurves(j) },
  importance:         { errorMsg: "Variable importance unavailable",        fetch: (j) => plumberClient.getDiagnosticsImportance(j) },
  cbi:               { errorMsg: "CBI diagnostics unavailable",             fetch: (j) => plumberClient.getDiagnosticsCbi(j) },
  mess:              { errorMsg: "MESS diagnostics unavailable",             fetch: (j) => plumberClient.getDiagnosticsMess(j) },
  roc:               { errorMsg: "ROC data unavailable",                    fetch: (j) => plumberClient.getDiagnosticsRoc(j) },
  calibration:        { errorMsg: "Calibration data unavailable",            fetch: (j) => plumberClient.getDiagnosticsCalibration(j) },
  "cv-folds":        { errorMsg: "CV folds data unavailable",             fetch: (j) => plumberClient.getDiagnosticsCvFolds(j) },
  threshold:         { errorMsg: "Threshold data unavailable",             fetch: (j) => plumberClient.getDiagnosticsThreshold(j) },
  density:           { errorMsg: "Density data unavailable",               fetch: (j) => plumberClient.getDiagnosticsDensity(j) },
  summary:           { errorMsg: "Diagnostics summary unavailable",       fetch: (j) => plumberClient.getDiagnosticsSummary(j) },
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
      return c.json(await fetch(jobId));
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
