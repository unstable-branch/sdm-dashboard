import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createServer } from "http";
import { plumberClient } from "./services/plumber";
import { ensureBuckets } from "./services/storage";
import { sdmQueue, sdmWorker, getJobStatus } from "./services/queue";
import { setupWebSocket } from "./services/websocket";
import { mediumCache, longCache } from "./middleware/cache";
import { csrfMiddleware } from "./middleware/csrf";
import { sdmRoutes } from "./routes/sdm";
import { dataRoutes } from "./routes/occurrences";
import { resultsRoutes } from "./routes/results";
import { climateRoutes } from "./routes/climate";
import { ecologyRoutes } from "./routes/ecology";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import jobsRoutes from "./routes/jobs";

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
    const client = sdmQueue.client;
    const redisClient = await client;
    await redisClient.ping();
    redisStatus = "connected";
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
app.route("/api/v1/jobs", jobsRoutes);

const port = parseInt(process.env.PORT || "4000", 10);

console.log(`SDM API server running on http://0.0.0.0:${port}`);

// Initialize Garage S3 buckets
ensureBuckets().catch((err) => {
  console.error("[Garage] Bucket initialization failed:", err);
});

const server = createServer(app.fetch);

// Set up WebSocket for real-time job progress
const ws = setupWebSocket(server);

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${port}/ws`);
});

process.on("unhandledRejection", (reason) => {
  console.error("[API] Unhandled rejection:", reason);
});

export { ws };
