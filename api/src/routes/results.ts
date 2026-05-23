import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { db } from "../db/index.js";
import { runs, projectMembers } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { optionalAuth, type AppEnv } from "../middleware/auth.js";

export const resultsRoutes = new Hono<AppEnv>();

resultsRoutes.use("*", optionalAuth);

const appDir = process.cwd();

resultsRoutes.get("/file/:filePath", async (c) => {
  const filePath = decodeURIComponent(c.req.param("filePath"));
  const fullPath = resolve(join(appDir, filePath));

  if (!fullPath.startsWith(resolve(appDir))) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  if (!existsSync(fullPath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = filePath.split(".").pop()?.toLowerCase();
  const contentType = ext === "tif" || ext === "tiff" ? "image/tiff" :
                      ext === "png" ? "image/png" :
                      ext === "txt" ? "text/plain" :
                      ext === "csv" ? "text/csv" :
                      "application/octet-stream";

  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);

  const buffer = readFileSync(fullPath);
  return c.body(buffer);
});

resultsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const conditions = [eq(runs.id, id)];
  if (user) {
    const userProjects = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, user.id));
    const projectIds = userProjects.map((p) => p.projectId);
    if (projectIds.length > 0) {
      conditions.push(inArray(runs.projectId, projectIds));
    }
  }

  const [run] = await db
    .select()
    .from(runs)
    .where(and(...conditions))
    .limit(1);

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json({
    id: run.id,
    status: run.status,
    species: run.speciesName,
    model_id: run.modelId,
    started_at: run.startedAt?.toISOString() ?? null,
    completed_at: run.completedAt?.toISOString() ?? null,
    error: run.error ?? null,
    metrics: run.metrics ?? null,
    output_files: run.outputFiles ?? null,
    progress_log: [],
  });
});

resultsRoutes.get("/:id/report.txt", async (c) => {
  const id = c.req.param("id");

  const [run] = await db
    .select({ resultPath: runs.resultPath })
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1);

  const reportPath = run?.resultPath
    ? join(appDir, run.resultPath, "report.txt")
    : join(appDir, "outputs", "jobs", id, "report.txt");

  if (!existsSync(reportPath)) {
    return c.json({ error: "Report not found" }, 404);
  }

  c.header("Content-Type", "text/plain");
  return c.body(readFileSync(reportPath, "utf-8"));
});

resultsRoutes.get("/:id/script", async (c) => {
  const id = c.req.param("id");

  try {
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const res = await fetch(`${plumberUrl}/api/v1/output/script/${id}`);
    const data = await res.json();

    if (!res.ok) {
      return c.json(data, res.status as any);
    }

    const scriptPath = (data as any).script_path;
    if (!scriptPath || !existsSync(scriptPath)) {
      return c.json({ error: "Script not generated" }, 500);
    }

    c.header("Content-Type", "text/x-r-source");
    c.header("Content-Disposition", `attachment; filename="reproducible_run.R"`);
    return c.body(readFileSync(scriptPath, "utf-8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script export failed";
    return c.json({ error: message }, 502);
  }
});

resultsRoutes.get("/:id/manifest", async (c) => {
  const id = c.req.param("id");

  try {
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const res = await fetch(`${plumberUrl}/api/v1/output/manifest/${id}`);
    const data = await res.json();

    if (!res.ok) {
      return c.json(data, res.status as any);
    }

    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Manifest generation failed";
    return c.json({ error: message }, 502);
  }
});