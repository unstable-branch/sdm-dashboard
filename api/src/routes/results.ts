import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { stat, readFile } from "fs/promises";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";

export const resultsRoutes = new Hono<AppEnv>();

resultsRoutes.use("*", authMiddleware);

const appDir = process.env.SDM_PROJECT_ROOT || resolve(process.cwd(), "..");
const resultRoot = resolve(appDir, "outputs", "jobs");

function resolveResultFilePath(filePath: string): { fullPath: string; runId: string } | null {
  const hostPath = filePath.startsWith("/app/") ? join(appDir, filePath.slice(5)) : filePath;
  const requested = isAbsolute(hostPath) ? hostPath : join(appDir, hostPath);
  const fullPath = resolve(requested);
  const rel = relative(resultRoot, fullPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }

  const [runId] = rel.split(/[\\/]/);
  if (!runId) {
    return null;
  }

  return { fullPath, runId };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

async function canAccessRun(userId: string, role: string, runId: string): Promise<boolean> {
  const idMatch = isUuid(runId) ? eq(runs.id, runId) : eq(runs.jobId, runId);

  if (role === "admin") {
    const [run] = await db.select({ id: runs.id }).from(runs).where(idMatch).limit(1);
    return Boolean(run);
  }

  const projectIds = await getUserProjectIds({ id: userId, email: "", role });
  if (!projectIds || projectIds.length === 0) {
    return false;
  }

  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(idMatch, inArray(runs.projectId, projectIds)))
    .limit(1);

  return Boolean(run);
}

resultsRoutes.get("/file/:filePath", async (c) => {
  const filePath = decodeURIComponent(c.req.param("filePath"));
  const resolved = resolveResultFilePath(filePath);

  if (!resolved) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, resolved.runId))) {
    return c.json({ error: "File not found" }, 404);
  }

  const { fullPath } = resolved;
  if (!existsSync(fullPath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = filePath.split(".").pop()?.toLowerCase();
  const contentType = ext === "tif" || ext === "tiff" ? "image/tiff" :
                      ext === "png" ? "image/png" :
                      ext === "txt" ? "text/plain" :
                      ext === "csv" ? "text/csv" :
                      "application/octet-stream";

  const fileStats = await stat(fullPath);
  const etag = `W/"${fileStats.size}-${fileStats.mtimeMs}"`;

  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=3600");

  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304);
  }

  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);

  const buffer = await readFile(fullPath);
  return c.body(buffer);
});

resultsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const projectIds = await getUserProjectIds(user);
  if (projectIds && projectIds.length === 0) {
    return c.json({ error: "Run not found" }, 404);
  }

  const conditions = [eq(runs.id, id)];
  if (projectIds) {
    conditions.push(inArray(runs.projectId, projectIds));
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
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, id))) {
    return c.json({ error: "Report not found" }, 404);
  }

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
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, id))) {
    return c.json({ error: "Script not found" }, 404);
  }

  try {
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
    const res = await fetch(`${plumberUrl}/api/v1/output/script/${id}`, {
      headers: {
        ...(internalKey ? { "X-Hono-Internal": internalKey } : {}),
        "X-Forwarded-User": user.id,
      },
    });
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
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, id))) {
    return c.json({ error: "Manifest not found" }, 404);
  }

  try {
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
    const res = await fetch(`${plumberUrl}/api/v1/output/manifest/${id}`, {
      headers: {
        ...(internalKey ? { "X-Hono-Internal": internalKey } : {}),
        "X-Forwarded-User": user.id,
      },
    });
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
