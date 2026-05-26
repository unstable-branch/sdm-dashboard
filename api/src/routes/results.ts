import { Hono } from "hono";
import { readFile, stat } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds, canAccessRun } from "../services/access.js";

export const resultsRoutes = new Hono<AppEnv>();

resultsRoutes.use("*", authMiddleware);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// api/src/routes/results.ts -> project root
const PROJECT_ROOT = resolve(__dirname, "../../..");
const resultRoot = resolve(PROJECT_ROOT, "outputs", "jobs");

/**
 * Map a stored file path (possibly a container-absolute path like
 * /app/outputs/jobs/...) to the host filesystem and validate it is
 * within the allowed resultRoot directory.
 */
function resolveResultFilePath(filePath: string): { fullPath: string; runId: string } | null {
  // Map container-internal paths (/app/outputs/jobs/run-id/file.ext) and
  // relative paths to the host filesystem under PROJECT_ROOT.
  let mappedPath = filePath;
  if (filePath.startsWith("/app/")) {
    mappedPath = join(PROJECT_ROOT, filePath.slice(5));
  } else if (!isAbsolute(filePath)) {
    mappedPath = join(PROJECT_ROOT, filePath);
  }

  const fullPath = resolve(mappedPath);
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

resultsRoutes.get("/file/*", async (c) => {
  // Hono's * wildcard matches the rest of the path, but we need to extract
  // the file portion from the original (still-encoded) URL to preserve %2F.
  const pathname = new URL(c.req.url).pathname;
  const filePrefix = "/file/";
  const idx = pathname.indexOf(filePrefix);
  if (idx === -1) return c.json({ error: "Invalid file path" }, 400);

  const filePath = decodeURIComponent(pathname.slice(idx + filePrefix.length));
  const resolved = resolveResultFilePath(filePath);

  if (!resolved) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  const user = c.get("user");
  // Directory names on disk (run-YYYYMMDDHHMMSS-NNNN) do not match the
  // UUID-based run id in the DB. Only enforce the DB access check when
  // the runId extracted from the path is itself a valid UUID.
  if (resolved.runId.length === 36 && resolved.runId.includes("-")) {
    try {
      if (!(await canAccessRun(user.id, user.role, resolved.runId))) {
        return c.json({ error: "File not found" }, 404);
      }
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  }

  const { fullPath } = resolved;
  try {
    await stat(fullPath);
  } catch {
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
    .select({
      id: runs.id,
      status: runs.status,
      speciesName: runs.speciesName,
      modelId: runs.modelId,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      error: runs.error,
      metrics: runs.metrics,
      outputFiles: runs.outputFiles,
      provenance: runs.provenance,
    })
    .from(runs)
    .where(and(...conditions))
    .limit(1);

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const errCode = run.provenance && typeof run.provenance === "object" && "error_code" in (run.provenance as object)
    ? (run.provenance as Record<string, unknown>).error_code as string
    : undefined;
  const errHint = run.provenance && typeof run.provenance === "object" && "error_hint" in (run.provenance as object)
    ? (run.provenance as Record<string, unknown>).error_hint as string
    : undefined;

  return c.json({
    id: run.id,
    status: run.status,
    species: run.speciesName,
    model_id: run.modelId,
    started_at: run.startedAt?.toISOString() ?? null,
    completed_at: run.completedAt?.toISOString() ?? null,
    error: run.error ?? null,
    error_code: errCode ?? null,
    error_hint: errHint ?? null,
    metrics: run.metrics ?? null,
    output_files: run.outputFiles ?? null,
    provenance: run.provenance ?? null,
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
    .select({ resultPath: runs.resultPath, outputFiles: runs.outputFiles })
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1);

  let reportPath: string;
  if (run?.outputFiles && typeof run.outputFiles === "object" && "report" in (run.outputFiles as object)) {
    const containerPath = (run.outputFiles as Record<string, string>).report;
    reportPath = containerPath.startsWith("/app/")
      ? join(PROJECT_ROOT, containerPath.slice(5))
      : join(PROJECT_ROOT, containerPath);
  } else if (run?.resultPath) {
    reportPath = join(PROJECT_ROOT, run.resultPath, "report.txt");
  } else {
    reportPath = join(PROJECT_ROOT, "outputs", "jobs", id, "report.txt");
  }

  try {
    await stat(reportPath);
  } catch {
    return c.json({ error: "Report not found" }, 404);
  }

  c.header("Content-Type", "text/plain");
  return c.body(await readFile(reportPath, "utf-8"));
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
    if (!scriptPath) {
      return c.json({ error: "Script not generated" }, 500);
    }
    try {
      await stat(scriptPath);
    } catch {
      return c.json({ error: "Script not generated" }, 500);
    }

    c.header("Content-Type", "text/x-r-source");
    c.header("Content-Disposition", `attachment; filename="reproducible_run.R"`);
    return c.body(await readFile(scriptPath, "utf-8"));
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
