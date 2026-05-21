import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { plumberClient } from "./services/plumber";
import { ensureBuckets } from "./services/storage";
import { sdmQueue, sdmWorker, getJobStatus } from "./services/queue";
import { sdmRoutes } from "./routes/sdm";
import { dataRoutes } from "./routes/occurrences";
import { resultsRoutes } from "./routes/results";
import { climateRoutes } from "./routes/climate";
import jobsRoutes from "./routes/jobs";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

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

app.route("/api/v1/sdm", sdmRoutes);
app.route("/api/v1/data", dataRoutes);
app.route("/api/v1/results", resultsRoutes);
app.route("/api/v1/climate", climateRoutes);
app.route("/api/v1/jobs", jobsRoutes);

const port = parseInt(process.env.PORT || "4000", 10);

console.log(`SDM API server running on http://0.0.0.0:${port}`);

// Initialize Garage S3 buckets
ensureBuckets().catch((err) => {
  console.error("[Garage] Bucket initialization failed:", err);
});

const server = serve({ fetch: app.fetch, port });

process.on("unhandledRejection", (reason) => {
  console.error("[API] Unhandled rejection:", reason);
});
