import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { compress } from "hono/compress";
import { plumberClient } from "./services/plumber.js";
import { ensureBuckets } from "./services/storage.js";
import { getRedisStatus, ensureWorker, getJobStatus, shutdownQueue } from "./services/queue.js";
import { startPlumberSync, stopPlumberSync } from "./services/plumber-sync.js";
import { setupWebSocket, cleanupWebSocket } from "./services/websocket.js";
import { mediumCache, longCache, closeCache } from "./middleware/cache.js";
import { closeRateLimitRedis } from "./middleware/rate-limit.js";
import { csrfMiddleware } from "./middleware/csrf.js";
import { startMemoryMonitor, stopMemoryMonitor, memoryMonitorMiddleware } from "./middleware/memory-monitor.js";
import { db } from "./db/index.js";
import { sdmRoutes } from "./routes/sdm.js";
import { dataRoutes } from "./routes/occurrences.js";
import { resultsRoutes } from "./routes/results.js";
import { climateRoutes } from "./routes/climate.js";
import { covariatesRoutes } from "./routes/covariates.js";
import { ecologyRoutes } from "./routes/ecology.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { settingsRoutes } from "./routes/settings.js";
import { adminRoutes } from "./routes/admin.js";
import { diagnosticsRoutes } from "./routes/diagnostics.js";
import jobsRoutes from "./routes/jobs.js";

process.on("uncaughtException", (err) => {
  const msg = err?.message ?? "";
  if (
    msg.includes("ioredis") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ENOTFOUND")
  ) {
    return;
  }
  console.error("[FATAL] Uncaught exception (keeping process alive):", err);
});

const app = new Hono();

const frontendOrigin = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000";
const corsOrigins = frontendOrigin.split(",").map(s => s.trim()).filter(Boolean);
app.use("*", cors({
  origin: corsOrigins.length > 0 ? corsOrigins : ["http://localhost:3000"],
  credentials: true,
}));
app.use("*", compress());
app.use("*", logger());
app.use("*", memoryMonitorMiddleware);
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

  const rs = getRedisStatus();
  let redisStatus = "disconnected";
  if (rs.available) redisStatus = "connected";
  else if (rs.disabled) redisStatus = "disabled";

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
app.route("/api/v1/settings", settingsRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/sdm", sdmRoutes);
app.route("/api/v1/data", dataRoutes);
app.route("/api/v1/results", resultsRoutes);
app.route("/api/v1/climate", climateRoutes);
app.route("/api/v1/covariates", covariatesRoutes);
app.route("/api/v1/ecology", ecologyRoutes);
app.route("/api/v1/diagnostics", diagnosticsRoutes);
app.route("/api/v1/jobs", jobsRoutes);

app.onError((err, c) => {
  console.error("[API] Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

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
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    console.log(`[Worker] Redis unavailable at ${redisUrl}; job worker deferred. Climate downloads will return 503.`);
  } else {
    console.log("[Worker] BullMQ worker started");
  }
}, 1000);

// Start Plumber status sync — polls Plumber for running jobs and updates DB + SSE
setTimeout(() => {
  startPlumberSync(5000);
}, 2000);

// Start memory usage monitor — logs warnings if heap exceeds thresholds
setTimeout(() => {
  startMemoryMonitor(30000);
}, 3000);

// Flush stale cache after restart so old data from previous Plumber sessions
// (e.g. broken endpoints returning empty results) is not served to users
setTimeout(async () => {
  try {
    const { invalidateCache } = await import("./middleware/cache.js");
    await invalidateCache("long");
    await invalidateCache("medium");
    console.log("[Cache] Stale cache flushed on startup");
  } catch {
    // Cache flush is best-effort; Redis may be unavailable
  }
}, 2000);

// Graceful shutdown: close all connections so dev hot-reload (tsx) can kill the process cleanly
async function shutdown() {
  console.log("[Shutdown] Closing connections...");
  stopPlumberSync();
  stopMemoryMonitor();
  cleanupWebSocket();
  closeCache();
  closeRateLimitRedis();
  shutdownQueue();
  try {
    await db.$client.end();
    console.log("[Shutdown] PostgreSQL pool closed");
  } catch {
    // Pool shutdown is best-effort
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Set up HTTP server with WebSocket support
const server = serve(
  { fetch: app.fetch, port, hostname: process.env.HOST || "0.0.0.0" },
  (info) => {
    console.log(`SDM API server running on http://${info.address}:${info.port}`);
    console.log(`HTTP server listening on port ${info.port}`);
    const wsProto = process.env.NODE_ENV === "production" ? "wss" : "ws";
    console.log(`WebSocket available at ${wsProto}://${info.address}:${info.port}/ws`);
  }
);

setupWebSocket(server);

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason ?? "");
  if (
    msg.includes("ioredis") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("Connection is closed")
  ) {
    return;
  }
  console.error("[API] Unhandled rejection, shutting down:", reason);
  shutdown();
});
