import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { defaultRateLimit } from "../middleware/rate-limit.js";
import { optionalAuth } from "../middleware/auth.js";

export const diagnosticsRoutes = new Hono();

diagnosticsRoutes.use("*", defaultRateLimit);
diagnosticsRoutes.use("*", optionalAuth);

diagnosticsRoutes.get("/vif/:runId", async (c) => {
  const runId = c.req.param("runId");
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
  try {
    const data = await plumberClient.getDiagnosticsSummary(runId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Diagnostics summary unavailable";
    return c.json({ error: message }, 502);
  }
});
