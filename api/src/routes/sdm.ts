import { Hono } from "hono";
import { z } from "zod";

export const sdmRoutes = new Hono();

const runModelSchema = z.object({
  species: z.string(),
  modelId: z.string(),
  biovars: z.array(z.number()).min(2),
  projectionExtent: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  backgroundN: z.number().min(500).max(100000).default(10000),
  cvFolds: z.number().min(0).max(10).default(3),
  cvStrategy: z.enum(["random", "spatial_blocks"]).default("random"),
  threshold: z.number().min(0.05).max(0.95).default(0.5),
  includeQuadratic: z.boolean().default(true),
  nCores: z.number().min(1).max(64).default(1),
  seed: z.number().default(42),
});

sdmRoutes.post("/run", async (c) => {
  const body = await c.req.json();
  const parsed = runModelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const jobId = `job-${Date.now()}`;

  return c.json({
    jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
  }, 202);
});

sdmRoutes.get("/models", (c) => {
  return c.json([
    { id: "glm", label: "GLM / Logistic regression", maturity: "stable" },
    { id: "gam", label: "GAM / Smooth response curves", maturity: "stable" },
    { id: "maxnet", label: "MaxEnt", maturity: "stable" },
    { id: "rf", label: "Random Forest", maturity: "stable" },
    { id: "xgboost", label: "XGBoost", maturity: "experimental" },
    { id: "rangebag", label: "Rangebagging", maturity: "experimental" },
  ]);
});

sdmRoutes.get("/config/defaults", (c) => {
  return c.json({
    biovars: [1, 4, 6, 12, 15, 18],
    backgroundN: 10000,
    cvFolds: 3,
    cvStrategy: "random",
    threshold: 0.5,
    nCores: 1,
    seed: 42,
    extentPresets: {
      aus_full: [112, 154, -44, -10],
      world: [-180, 180, -90, 90],
    },
  });
});
