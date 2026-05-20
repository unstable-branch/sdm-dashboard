import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { plumberClient } from "./services/plumber";
import { getGarageConfig, getBucketNames } from "./services/storage";
import { sdmRoutes } from "./routes/sdm";
import { dataRoutes } from "./routes/occurrences";
import { resultsRoutes } from "./routes/results";
import { jobsRoutes } from "./routes/jobs";

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

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      plumber: plumberStatus,
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
app.route("/api/v1/jobs", jobsRoutes);

async function initGarageBuckets(): Promise<void> {
  const config = getGarageConfig();
  const { rasters, exports } = getBucketNames();

  const s3 = new S3Client({
    endpoint: `http://${config.endPoint}:${config.port}`,
    region: "garage",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });

  const buckets = [rasters, exports];
  const maxRetries = 15;
  const retryDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      for (const bucket of buckets) {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: bucket }));
          console.log(`[Garage] Created bucket: ${bucket}`);
        } catch (err: unknown) {
          if (err instanceof Error && "name" in err && (err as { name: string }).name === "BucketAlreadyOwnedByYou") {
            console.log(`[Garage] Bucket already exists: ${bucket}`);
          } else {
            throw err;
          }
        }
      }
      console.log("[Garage] All buckets initialized");
      return;
    } catch (err) {
      if (attempt < maxRetries) {
        console.log(`[Garage] Not ready yet (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } else {
        console.error("[Garage] Failed to initialize buckets after", maxRetries, "attempts:", err);
      }
    }
  }
}

const port = parseInt(process.env.PORT || "4000", 10);

console.log(`SDM API server running on http://0.0.0.0:${port}`);

initGarageBuckets().catch((err) => {
  console.error("[Garage] Bucket initialization failed:", err);
});

serve({ fetch: app.fetch, port });
