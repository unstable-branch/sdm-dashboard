import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sdmRoutes } from "./routes/sdm";
import { dataRoutes } from "./routes/occurrences";
import { resultsRoutes } from "./routes/results";
import { jobsRoutes } from "./routes/jobs";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.route("/api/v1/sdm", sdmRoutes);
app.route("/api/v1/data", dataRoutes);
app.route("/api/v1/results", resultsRoutes);
app.route("/api/v1/jobs", jobsRoutes);

const port = parseInt(process.env.PORT || "4000", 10);

console.log(`SDM API server running on http://0.0.0.0:${port}`);

serve({ fetch: app.fetch, port });
