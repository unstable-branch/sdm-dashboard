import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { stat, readFile } from "fs/promises";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { getErrorHttpStatus } from "@sdm/shared";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import { decrypt } from "../services/encryption.js";

export const resultsRoutes = new Hono<AppEnv>();

resultsRoutes.use("*", authMiddleware);

const appDir = process.env.SDM_PROJECT_ROOT || resolve(process.cwd(), "..");
const resultRoot = resolve(appDir, "outputs", "jobs");

/**
 * Map a stored file path (possibly a container-absolute path like
 * /app/outputs/jobs/...) to the host filesystem and validate it is
 * within the allowed resultRoot directory.
 */
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

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  if (start >= fileSize || start > end) return null;
  return { start, end: Math.min(end, fileSize - 1) };
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

/**
 * Resolve the Plumber job ID from a run UUID.
 * Falls back to the UUID itself if no jobId is stored.
 */
async function plumberJobId(runId: string): Promise<string> {
  const [run] = await db
    .select({ jobId: runs.jobId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return run?.jobId ?? runId;
}

async function serveFile(c: any, filePath: string) {
  const resolved = resolveResultFilePath(filePath);

  if (!resolved) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  const user = c.get("user");
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
  let stats;
  try {
    stats = await stat(fullPath);
  } catch {
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
}

resultsRoutes.get("/tiles/:runId/:z/:x/:y", async (c) => {
  const { runId, z, x, y } = c.req.param();

  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return c.json({ error: "Invalid tile coordinates" }, 400);
  }

  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Tile not found" }, 404);
  }

  const [run] = await db
    .select({ jobId: runs.jobId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const jobDir = resolve(resultRoot, runId);

  const tilePath = resolve(jobDir, "map_tiles", "suitability", z, x, `${y}.png`);
  const rel = relative(resultRoot, tilePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return c.json({ error: "Invalid tile path" }, 400);
  }

  if (!existsSync(tilePath)) {
    return c.body(null, 204);
  }

  const buffer = await readFile(tilePath);
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(buffer);
});

// Shared file serving logic used by both /file/* and /file/download routes
async function serveFileFromPath(c: any, filePath: string) {
  const resolved = resolveResultFilePath(filePath);
  if (!resolved) return c.json({ error: "Invalid file path" }, 400);

  const user = c.get("user");
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

  // Check for encrypted (.enc) sibling file
  const encPath = fullPath + ".enc";
  const isEncrypted = existsSync(encPath);
  const servePath = isEncrypted ? encPath : fullPath;

  let stats;
  try {
    stats = await stat(servePath);
  } catch {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = filePath.split(".").pop()?.toLowerCase();
  const contentType = ext === "tif" || ext === "tiff" ? "image/tiff" :
                      ext === "png" ? "image/png" :
                      ext === "txt" ? "text/plain" :
                      ext === "csv" ? "text/csv" :
                      "application/octet-stream";

  // Read and optionally decrypt
  const raw = await readFile(servePath);
  const buffer = isEncrypted ? decrypt(raw) : raw;

  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, buffer.length);
    if (range) {
      const { start, end } = range;
      const length = end - start + 1;

      c.status(206);
      c.header("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
      c.header("Content-Length", String(length));
      c.header("Content-Type", contentType);
      c.header("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);
      return c.body(buffer.subarray(start, end + 1));
    }
    c.status(416);
    c.header("Content-Range", `bytes */${buffer.length}`);
    return c.body("Range Not Satisfiable");
  }

  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);

  return c.body(buffer);
}

// Query-parameter based file serving — avoids Next.js %2F redirect issue
resultsRoutes.get("/file/download", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath || typeof filePath !== "string") {
    return c.json({ error: "path query parameter required" }, 400);
  }
  return serveFileFromPath(c, filePath);
});

// Path-encoded file serving (legacy, subject to Next.js %2F redirect)
resultsRoutes.get("/file/*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const filePrefix = "/file/";
  const idx = pathname.indexOf(filePrefix);
  if (idx === -1) return c.json({ error: "Invalid file path" }, 400);

  const filePath = decodeURIComponent(pathname.slice(idx + filePrefix.length));
  return serveFileFromPath(c, filePath);
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

  const httpStatus = run.status === "failed" ? getErrorHttpStatus(errCode) : 200;

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
  }, httpStatus as any);
});

resultsRoutes.get("/:id/report.txt", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, id))) {
    return c.json({ error: "Report not found" }, 404);
  }

  const [run] = await db
    .select({ outputFiles: runs.outputFiles })
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1);

  let reportPath: string;
  if (run?.outputFiles && typeof run.outputFiles === "object" && "report" in (run.outputFiles as object)) {
    const containerPath = (run.outputFiles as Record<string, string>).report;
    reportPath = containerPath.startsWith("/app/")
      ? join(PROJECT_ROOT, containerPath.slice(5))
      : join(PROJECT_ROOT, containerPath);
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

  const jobId = await plumberJobId(id);
  try {
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
    const res = await fetch(`${plumberUrl}/api/v1/output/script/${jobId}`, {
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

  const jobId = await plumberJobId(id);
  try {
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
    const res = await fetch(`${plumberUrl}/api/v1/output/manifest/${jobId}`, {
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
