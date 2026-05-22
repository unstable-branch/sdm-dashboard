import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { plumberClient } from "./services/plumber.js";
import { ensureBuckets } from "./services/storage.js";
import { getQueueClient, ensureWorker, getJobStatus } from "./services/queue.js";
import { setupWebSocket } from "./services/websocket.js";
import { mediumCache, longCache } from "./middleware/cache.js";
import { csrfMiddleware } from "./middleware/csrf.js";
import { sdmRoutes } from "./routes/sdm.js";
import { dataRoutes } from "./routes/occurrences.js";
import { resultsRoutes } from "./routes/results.js";
import { climateRoutes } from "./routes/climate.js";
import { ecologyRoutes } from "./routes/ecology.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { diagnosticsRoutes } from "./routes/diagnostics.js";
import jobsRoutes from "./routes/jobs.js";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());
app.use("/api/v1/sdm/*", csrfMiddleware);
app.use("/api/v1/data/*", csrfMiddleware);
app.use("/api/v1/climate/*", csrfMiddleware);
app.use("/api/v1/ecology/*", csrfMiddleware);
app.use("/api/v1/projects/*", csrfMiddleware);

app.get("/health", async (c) => {
  let plumberStatus = "unknown";
  try {
    const health = await plumberClient.healthCheck();
    plumberStatus = health.status;
  } catch {
    plumberStatus = "unreachable";
  }

  let redisStatus = "unknown";
  try {
    const client = getQueueClient();
    await client?.ping();
    redisStatus = client ? "connected" : "disconnected";
  } catch {
    redisStatus = "disconnected";
  }

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      plumber: plumberStatus,
      redis: redisStatus,
    },
  });
});

app.get("/ready", async (c) => {
  const checks = {
    plumber: false,
    database: false,
    storage: false,
  };

  try {
    await plumberClient.healthCheck();
    checks.plumber = true;
  } catch {
    // Plumber is optional for readiness
  }

  const allOk = Object.values(checks).every(Boolean);
  const status = allOk ? "ready" : "degraded";

  return c.json({ status, checks }, allOk ? 200 : 503);
});

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/projects", projectRoutes);
app.route("/api/v1/sdm", sdmRoutes);
app.route("/api/v1/data", dataRoutes);
app.route("/api/v1/results", resultsRoutes);
app.route("/api/v1/climate", climateRoutes);
app.route("/api/v1/ecology", ecologyRoutes);
app.route("/api/v1/diagnostics", diagnosticsRoutes);
app.route("/api/v1/jobs", jobsRoutes);

const port = parseInt(process.env.PORT || "4000", 10);

// Initialize Garage S3 buckets (non-blocking, errors are logged)
(async () => {
  try {
    await ensureBuckets();
  } catch (err) {
    console.error("[Garage] Bucket initialization failed - continuing:", err instanceof Error ? err.message : String(err));
  }
})();

// Attempt to start background job worker (will no-op if Redis unavailable)
setTimeout(() => {
  const w = ensureWorker();
  if (!w) {
    console.log("[Worker] Redis unavailable; job worker deferred");
  } else {
    console.log("[Worker] BullMQ worker started");
  }
}, 1000);

// Set up HTTP server with WebSocket support
const server = serve(
  { fetch: app.fetch, port, hostname: "0.0.0.0" },
  (info) => {
    console.log(`SDM API server running on http://${info.address}:${info.port}`);
    console.log(`HTTP server listening on port ${info.port}`);
    console.log(`WebSocket available at ws://${info.address}:${info.port}/ws`);
  }
);

setupWebSocket(server);

process.on("unhandledRejection", (reason) => {
  console.error("[API] Unhandled rejection:", reason);
});
