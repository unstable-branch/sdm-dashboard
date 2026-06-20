import { Hono } from "hono";
import { existsSync, createReadStream, readdirSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { stat, readFile } from "fs/promises";
import { Readable } from "stream";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { getErrorHttpStatus, StatusCode } from "@sdm/shared";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import { decrypt } from "../services/encryption.js";
import { plumberClient } from "../services/plumber.js";

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
  const projectRoot = process.env.SDM_PROJECT_ROOT || "/app";
  const containerPrefix = `${projectRoot}/`;
  const hostPath = filePath.startsWith(containerPrefix) ? join(appDir, filePath.slice(projectRoot.length + 1)) : filePath;
  const requested = isAbsolute(hostPath) ? hostPath : join(appDir, hostPath);
  const fullPath = resolve(requested);
  const rel = relative(resultRoot, fullPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  if (!fullPath.startsWith(resultRoot + "/") && fullPath !== resultRoot) {
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

resultsRoutes.get("/tiles/:runId/:z/:x/:y", async (c) => {
  const { runId, z, x, y } = c.req.param();
  const band = c.req.query("band") || "suitability";

  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return c.json({ error: "Invalid tile coordinates" }, 400);
  }

  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);
  if (zoom > 20) {
    return c.json({ error: "Zoom level too high" }, 400);
  }
  if (tileX < 0 || tileY < 0 || tileX >= 1 << zoom || tileY >= 1 << zoom) {
    return c.json({ error: "Tile coordinates out of range" }, 400);
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

  const jobDir = resolve(resultRoot, run.jobId ?? runId);

  const tilePath = resolve(jobDir, "map_tiles", band, String(zoom), String(tileX), `${tileY}.png`);
  const rel = relative(resultRoot, tilePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return c.json({ error: "Invalid tile path" }, 400);
  }

  if (existsSync(tilePath)) {
    const stats = await stat(tilePath);
    const etag = `W/"${stats.size}-${stats.mtimeMs}"`;
    c.header("ETag", etag);
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "private, max-age=86400");
    if (c.req.header("If-None-Match") === etag) {
      return c.body(null, 304);
    }
    const buffer = await readFile(tilePath);
    return c.body(buffer);
  }

  // Fallback: generate tile from COG on-the-fly via Plumber
  if (run.jobId) {
    try {
      const plumberRes = await plumberClient.withUser(user.id).getTileCog(
        run.jobId ?? runId, String(z), String(x), String(y), band
      );
      if (plumberRes.status === 204) {
        return c.body(null, 204);
      }
      if (plumberRes.ok) {
        const pngBuf = Buffer.from(await plumberRes.arrayBuffer());
        const etag = `W/"${pngBuf.length}-${z}-${x}-${y}"`;
        c.header("ETag", etag);
        if (c.req.header("If-None-Match") === etag) {
          return c.body(null, 304);
        }
        c.header("Content-Type", "image/png");
        c.header("Cache-Control", "private, max-age=86400");
        return c.body(pngBuf);
      }
      console.warn(`[tiles] Plumber tile error for ${runId}/${z}/${x}/${y}: ${plumberRes.status}`);
    } catch (e) {
      console.warn(`[tiles] Plumber tile proxy failed for ${runId}/${z}/${x}/${y}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return c.body(null, 204);
});

resultsRoutes.get("/tiles/:runId/info", async (c) => {
  const { runId } = c.req.param();
  const band = c.req.query("band") || "suitability";

  const user = c.get("user");
  if (!(await canAccessRun(user.id, user.role, runId))) {
    return c.json({ error: "Run not found" }, 404);
  }

  const [run] = await db
    .select({ jobId: runs.jobId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const jobDir = resolve(resultRoot, run.jobId ?? runId);
  const tilesDir = resolve(jobDir, "map_tiles", band);

  if (!existsSync(tilesDir)) {
    return c.json({ zoom_min: null, zoom_max: null, tile_count: 0, bounds: null });
  }

  try {
    const zooms = readdirSync(tilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => parseInt(d.name, 10))
      .filter((z) => !isNaN(z))
      .sort((a, b) => a - b);

    if (zooms.length === 0) {
      return c.json({ zoom_min: null, zoom_max: null, tile_count: 0, bounds: null });
    }

    let totalTiles = 0;
    for (const z of zooms) {
      const zDir = resolve(tilesDir, String(z));
      const xDirs = readdirSync(zDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const xDir of xDirs) {
        totalTiles += readdirSync(resolve(zDir, xDir.name)).filter((f) => f.endsWith(".png")).length;
      }
    }

    return c.json({
      zoom_min: zooms[0],
      zoom_max: zooms[zooms.length - 1],
      tile_count: totalTiles,
    });
  } catch {
    return c.json({ zoom_min: null, zoom_max: null, tile_count: 0, bounds: null });
  }
});

// Shared file serving logic used by both /file/* and /file/download routes
async function serveFileFromPath(c: any, filePath: string) {
  const resolved = resolveResultFilePath(filePath);
  if (!resolved) return c.json({ error: "Invalid file path" }, 400);

  const user = c.get("user");
  try {
    if (!(await canAccessRun(user.id, user.role, resolved.runId))) {
      return c.json({ error: "File not found" }, 404);
    }
  } catch {
    return c.json({ error: "File not found" }, 404);
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
  const disposition = (ext === "tif" || ext === "tiff" || ext === "png") ? "inline" : "attachment";

  const etag = `W/"${stats.size}-${stats.mtimeMs}"`;
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=3600");

  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304);
  }

  const rangeHeader = c.req.header("range");

  // Encrypted files must be fully read and decrypted in memory
  if (isEncrypted) {
    const raw = await readFile(servePath);
    const buffer = decrypt(raw);
    if (rangeHeader) {
      const range = parseRangeHeader(rangeHeader, buffer.length);
      if (range) {
        const { start, end } = range;
        c.status(206);
        c.header("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
        c.header("Content-Length", String(end - start + 1));
        c.header("Content-Type", contentType);
        c.header("Content-Disposition", `${disposition}; filename="${filePath.split("/").pop()}"`);
        return c.body(buffer.subarray(start, end + 1));
      }
      c.status(416);
      c.header("Content-Range", `bytes */${buffer.length}`);
      return c.body("Range Not Satisfiable");
    }
    c.header("Content-Type", contentType);
    c.header("Content-Disposition", `${disposition}; filename="${filePath.split("/").pop()}"`);
    return c.body(buffer);
  }

  // Non-encrypted: stream directly from disk
  const fileSize = stats.size;

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, fileSize);
    if (range) {
      const { start, end } = range;
      const length = end - start + 1;
      c.status(206);
      c.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      c.header("Content-Length", String(length));
      c.header("Content-Type", contentType);
      c.header("Content-Disposition", `${disposition}; filename="${filePath.split("/").pop()}"`);
      const stream = createReadStream(servePath, { start, end });
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return c.body(webStream);
    }
    c.status(416);
    c.header("Content-Range", `bytes */${fileSize}`);
    return c.body("Range Not Satisfiable");
  }

  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `${disposition}; filename="${filePath.split("/").pop()}"`);
  c.header("Content-Length", String(fileSize));
  const stream = createReadStream(servePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;
  return c.body(webStream);
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
      config: runs.config,
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
  }, httpStatus as StatusCode);
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
      ? join(appDir, containerPath.slice(5))
      : join(appDir, containerPath);
  } else {
    reportPath = join(resultRoot, id, "report.txt");
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
    const data = await plumberClient.withUser(user.id).getOutputScript(jobId);

    const scriptPath = data.script_path;
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
    const data = await plumberClient.withUser(user.id).getOutputManifest(jobId);
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Manifest generation failed";
    return c.json({ error: message }, 502);
  }
});
