import { Hono } from "hono";
import { targetsRunRequestSchema } from "@sdm/shared";
import { plumberClient } from "../services/plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, desc, count, and, inArray } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { getUserProjectIds, canAccessRun } from "../services/access.js";
import { projectSafeScienceConfig, publicConfigValidationError, UnsafeExecutionConfigError } from "../services/execution-config.js";

const MAX_RUNS_LIMIT = 500;

export const TARGETS_DURABLE_EXECUTION_UNAVAILABLE = {
  error: "Targets computation unavailable",
  code: "TARGETS_DURABLE_EXECUTION_UNAVAILABLE",
  message: "New Targets and Targets-backed batch computations are unavailable until durable execution ownership exists.",
} as const;

export const sdmTargetsRoutes = new Hono<AppEnv>();

sdmTargetsRoutes.use("/targets/run", authMiddleware);
sdmTargetsRoutes.use("/targets/status/*", authMiddleware);
sdmTargetsRoutes.use("/targets/results/*", authMiddleware);
sdmTargetsRoutes.use("/runs", authMiddleware);

sdmTargetsRoutes.post("/targets/run", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const parsed = targetsRunRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(publicConfigValidationError(), 400);
    try {
      parsed.data.configs.forEach((config) => projectSafeScienceConfig(config));
    } catch (err) {
      if (err instanceof UnsafeExecutionConfigError) return c.json(publicConfigValidationError(), 400);
      throw err;
    }
    return c.json(TARGETS_DURABLE_EXECUTION_UNAVAILABLE, 503);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Targets run failed";
    return c.json({ error: message }, 502);
  }
});

sdmTargetsRoutes.get("/targets/status/:jobId", async (c) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("jobId");
    if (!(await canAccessRun(user.id, user.role, jobId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const result = await plumberClient.withUser(user.id).withRole(user.role).targetsStatus(jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Targets status failed";
    return c.json({ error: message }, 502);
  }
});

sdmTargetsRoutes.get("/targets/results/:jobId", async (c) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("jobId");
    if (!(await canAccessRun(user.id, user.role, jobId))) {
      return c.json({ error: "Run not found" }, 404);
    }
    const result = await plumberClient.withUser(user.id).withRole(user.role).targetsResults(jobId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Targets results failed";
    return c.json({ error: message }, 502);
  }
});

sdmTargetsRoutes.get("/runs", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1", 10);
    const limitVal = Math.min(parseInt(c.req.query("limit") || "20", 10), MAX_RUNS_LIMIT);
    const statusFilter = c.req.query("status");
    const fields = c.req.query("fields");
    const offset = (page - 1) * limitVal;
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);

    const conditions = [];
    if (projectIds && projectIds.length === 0) {
      return c.json({
        runs: [],
        pagination: { page, limit: limitVal, total: 0, totalPages: 0 },
      });
    }
    if (projectIds) {
      conditions.push(inArray(runs.projectId, projectIds));
    }

    if (statusFilter === "active") {
      conditions.push(inArray(runs.status, ["queued", "running"]));
    } else if (statusFilter && ["queued", "running", "completed", "failed", "cancelled"].includes(statusFilter)) {
      conditions.push(eq(runs.status, statusFilter as "queued" | "running" | "completed" | "failed" | "cancelled"));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [allRuns, [{ total }]] = await Promise.all([
      db
        .select({
          id: runs.id,
          species: runs.speciesName,
          model_id: runs.modelId,
          status: runs.status,
          started_at: runs.startedAt,
          completed_at: runs.completedAt,
          last_stage: runs.lastStage,
          metrics: runs.metrics,
          outputFiles: runs.outputFiles,
          error: runs.error,
          error_code: runs.errorCode,
          error_hint: runs.errorHint,
        })
        .from(runs)
        .where(whereClause)
        .orderBy(desc(runs.createdAt))
        .limit(limitVal)
        .offset(offset),
      db
        .select({ total: count() })
        .from(runs)
        .where(whereClause),
    ]);

    const formatted = allRuns.map((r) => ({
      id: r.id,
      species: r.species ?? null,
      model_id: r.model_id ?? null,
      status: r.status ?? "queued",
      started_at: r.started_at,
      completed_at: r.completed_at,
      last_stage: r.last_stage ?? null,
      metrics: r.metrics ?? null,
      output_files: r.outputFiles ?? null,
      error: r.error ?? null,
      error_code: r.error_code ?? null,
      error_hint: r.error_hint ?? null,
    }));

    return c.json({
      runs: formatted,
      pagination: {
        page,
        limit: limitVal,
        total,
        totalPages: Math.ceil(total / limitVal),
      },
    });
  } catch (err) {
    console.error("[sdm-runs] Failed to fetch runs:", err);
    return c.json({
      runs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      warning: "Database unavailable — run history is temporarily inaccessible",
    }, 503);
  }
});
