import { Hono } from "hono";
import { mkdirSync, existsSync, accessSync, constants, readdirSync, statSync, readFileSync, writeFileSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join, resolve, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { db } from "../db/index.js";
import { species, occurrences, users, uploadedFiles } from "../db/schema.js";
import { and, count, eq, inArray, sql, desc } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import type { AppEnv } from "../middleware/auth.js";
import { encrypt, decrypt, isEncrypted } from "../services/encryption.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try { accessSync(dir, constants.W_OK); } catch {
    throw new Error(`Directory not writable: ${dir}`);
  }
}

function saveUploadEncrypted(buffer: Buffer, originalName: string): { encPath: string; pipelineRunId: string } {
  ensureDir(UPLOAD_DIR);
  const pipelineRunId = randomUUID();
  const uuid = randomUUID();
  const ext = extname(originalName) || ".csv";
  const encPath = join(UPLOAD_DIR, `${uuid}${ext}.enc`);
  const encrypted = encrypt(buffer);
  writeFileSync(encPath, encrypted);
  return { encPath, pipelineRunId };
}

function decryptToUploads(encPath: string): string | null {
  if (!existsSync(encPath)) {
    console.warn(`[encrypt] File not found: ${encPath}`);
    return null;
  }
  if (!encPath.endsWith(".enc")) return null;
  const plaintextPath = encPath.replace(/\.enc$/, "");
  if (existsSync(plaintextPath)) return plaintextPath;
  try {
    const ciphertext = readFileSync(encPath);
    const plaintext = decrypt(ciphertext);
    writeFileSync(plaintextPath, plaintext);
    const lineCount = plaintext.toString().split("\n").filter((l) => l.trim().length > 0).length - 1;
    console.log(`[encrypt] Decrypted ${encPath} → ${plaintextPath} (${lineCount} lines)`);
    return plaintextPath;
  } catch (err) {
    console.error(`[encrypt] Failed to decrypt ${encPath}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

function resolveFilePath(fileId: string): { path: string; cleanup: () => void } {
  if (fileId.endsWith(".enc")) {
    const decPath = decryptToUploads(fileId);
    if (decPath) {
      return {
        path: decPath,
        cleanup: () => { try { rmSync(decPath, { force: true }); } catch {} },
      };
    }
    // Should never happen: the .enc file was just written by saveUploadEncrypted
    console.error(`[encrypt] Failed to decrypt ${fileId} — DATA_ENCRYPTION_KEY may be missing or mismatched`);
  }
  return { path: fileId, cleanup: () => {} };
}

async function pollPlumberJob(jobId: string, timeoutMs = 240000): Promise<Record<string, unknown>> {
  const maxPolls = Math.floor(timeoutMs / 2000);
  for (let i = 0; i < maxPolls; i++) {
    const status = await plumberClient.getJobStatus(jobId);
    const s = status?.status as string;
    if (s === "completed") return (status?.result as Record<string, unknown>) || status;
    if (s === "failed") throw new Error((status?.error as string) || "Job failed");
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Job timed out");
}

export const dataRoutes = new Hono<AppEnv>();

dataRoutes.use("*", defaultRateLimit);
dataRoutes.use("*", authMiddleware);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB

dataRoutes.post("/occurrences/upload", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `File too large. Maximum ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Basic file type validation via magic bytes
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    const isCsv = file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".tsv") || file.name.toLowerCase().endsWith(".txt");
    const isZipExt = file.name.toLowerCase().endsWith(".zip");
    if (!isCsv && !isZipExt) {
      return c.json({ error: "Unsupported file type. Accepted: .csv, .tsv, .txt, .zip (Darwin Core Archive)" }, 400);
    }
    if (isZipExt && !isZip) {
      return c.json({ error: "File extension is .zip but file is not a valid ZIP archive" }, 400);
    }
    if (isCsv && isZip) {
      return c.json({ error: "File appears to be a ZIP archive but extension is not .zip" }, 400);
    }

    const user = c.get("user");

    // Quota check for non-admin users
    const adminRoles = ["admin", "superadmin"];
    if (!adminRoles.includes(user.role)) {
      const [quota] = await db
        .select({ quota: users.storageQuotaBytes, used: users.storageUsedBytes })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (quota && quota.quota != null && (Number(quota.used) + file.size) > Number(quota.quota)) {
        return c.json({
          error: `Upload would exceed storage quota (${(Number(quota.quota) / 1024 / 1024).toFixed(0)} MB). Used: ${(Number(quota.used) / 1024 / 1024).toFixed(1)} MB, File: ${(file.size / 1024 / 1024).toFixed(1)} MB. Delete old uploads or contact an admin.`,
        }, 413);
      }
    }

    // Save encrypted at rest
    const { encPath, pipelineRunId } = saveUploadEncrypted(buffer, file.name);
    const projectId = await ensureDefaultProject(user);

    // Decrypt to temp path for Plumber processing
    const resolved = resolveFilePath(encPath);
    console.log(`[upload] resolved.path: ${resolved.path}, endsWith .enc: ${resolved.path.endsWith(".enc")}`);
    let result: Record<string, unknown>;
    try {
      result = await plumberClient.withUser(user.id).uploadOccurrence(resolved.path, file.name);
      console.log(`[upload] Plumber response n_rows: ${result?.n_rows}, status: ${(result as any)?.status || "ok"}`);
    } catch (plumberErr) {
      resolved.cleanup();
      const pm = plumberErr instanceof Error ? plumberErr.message : "Unknown error";
      if (pm.includes("fetch failed") || pm.includes("ECONNREFUSED") || pm.includes("connect") || pm.includes("timeout")) {
        return c.json({
          error: "Upload saved to disk but Plumber backend is not responding. The occurrence file will be processed when Plumber is available.",
          filePath: encPath,
          pipelineRunId,
          plumberStatus: pm,
        }, 202);
      }
      throw plumberErr;
    }
    resolved.cleanup();
    const { ipAddress, userAgent } = extractClientInfo(c);
    logAction({
      userId: user.id,
      action: "occurrence_upload",
      entity: "occurrence",
      entityId: pipelineRunId,
      ipAddress,
      userAgent,
      details: { filename: file.name, fileSize: file.size, n_rows: result.n_rows, pipelineRunId },
    });

    // Record in uploaded_files table for per-user tracking
    try {
      await db.insert(uploadedFiles).values({
        userId: user.id,
        projectId,
        filePath: encPath,
        originalName: file.name,
        fileSize: buffer.length,
        nRows: (result.n_rows as number) ?? null,
      });
    } catch {}

    // Update storage usage
    if (!adminRoles.includes(user.role)) {
      await db
        .update(users)
        .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${buffer.length}` })
        .where(eq(users.id, user.id));
    }

    return c.json({ ...result, file_id: encPath, file_path: encPath, pipelineRunId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    const isPlumberDown = message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("connect");
    return c.json({
      error: isPlumberDown
        ? "Upload failed: Plumber backend is not running. Start it with: docker compose -f docker-compose.dev.yml --profile computation up -d"
        : message,
    }, isPlumberDown ? 503 : 502);
  }
});

dataRoutes.post("/occurrences/clean", async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    // Resolve encrypted file path to plaintext for Plumber async job
    // Note: cleanup is NOT called — the async Plumber job reads this file later
    const fileId = (body.file_id || body.fileId) as string | undefined;
    if (fileId) {
      const resolved = resolveFilePath(fileId);
      body.file_id = resolved.path;
    }

    const initial = await plumberClient.withUser(user.id).cleanOccurrences(body);

    if (initial && typeof initial === "object" && "error" in initial) {
      return c.json(initial, 502);
    }

    const jobId = (initial?.job_id || (initial as any)?.jobId) as string | undefined;

    // When async is requested, return immediately with the job_id for client polling
    if (body.async && jobId) {
      return c.json({ job_id: jobId, status: "running" } as Record<string, unknown>);
    }

    if (jobId) {
      const result = await pollPlumberJob(jobId, 600000);
      return c.json(result);
    }

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/gbif/search", gbifRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const initial = await plumberClient.searchGbif(body);

    const jobId = initial?.job_id as string | undefined;
    if (jobId) {
      const result = await pollPlumberJob(jobId);
      return c.json(result);
    }

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GBIF search failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/gbif/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const taxon = body.taxon as string;
    const country = body.country as string | undefined;
    const maxRecords = (body.max_records as number) || 100;

    if (!taxon) {
      return c.json({ error: "taxon is required" }, 400);
    }

    const initial = await plumberClient.searchGbif({ taxon, country, max_records: maxRecords });

    const jobId = initial?.job_id as string | undefined;
    const searchResult = jobId ? await pollPlumberJob(jobId) : initial;
    const filePath = searchResult.file_path as string | undefined;
    const nRecords = (searchResult.n_records as number) || 0;

    if (!filePath || nRecords === 0) {
      return c.json({ error: "No GBIF records found" }, 404);
    }

    const pipelineRunId = randomUUID();
    const user = c.get("user");
    const { ipAddress, userAgent } = extractClientInfo(c);
    logAction({
      userId: user.id,
      action: "occurrence_upload",
      entity: "occurrence",
      entityId: pipelineRunId,
      ipAddress,
      userAgent,
      details: { source: "gbif", taxon, country, n_rows: nRecords, pipelineRunId },
    });

    return c.json({
      file_path: filePath,
      file_id: filePath,
      n_rows: nRecords,
      filename: filePath.split("/").pop() || "gbif_records.csv",
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save GBIF records";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/dwca", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `File too large. Maximum ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const user = c.get("user");

    // Save encrypted at rest
    const { encPath, pipelineRunId } = saveUploadEncrypted(buffer, file.name);

    // Decrypt to temp for Plumber (no cleanup — async Plumber job reads this later)
    const resolved = resolveFilePath(encPath);
    const initial = await plumberClient.withUser(user.id).parseDwca({ file_id: resolved.path });

    const jobId = initial?.job_id as string | undefined;
    const result = jobId ? await pollPlumberJob(jobId) : initial;

    const { ipAddress, userAgent } = extractClientInfo(c);
    logAction({
      userId: user.id,
      action: "occurrence_upload",
      entity: "occurrence",
      entityId: pipelineRunId,
      ipAddress,
      userAgent,
      details: { filename: file.name, fileSize: file.size, source: "dwca", pipelineRunId },
    });
    return c.json({ ...result, file_id: encPath, file_path: encPath, pipelineRunId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DwCA parse failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.get("/species", async (c) => {
  try {
    const limitVal = Math.min(parseInt(c.req.query("limit") || "200", 10), 500);
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ species: [], hasMore: false });
    }

    const speciesQuery = db.select().from(species);
    const allSpecies = await (projectIds
      ? speciesQuery.where(inArray(species.projectId, projectIds)).orderBy(species.createdAt).limit(limitVal)
      : speciesQuery.orderBy(species.createdAt).limit(limitVal));

    return c.json({ species: allSpecies, hasMore: allSpecies.length >= limitVal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch species";
    return c.json({ error: message }, 500);
  }
});

dataRoutes.get("/species/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) return c.json({ error: "Species not found" }, 404);
    const [sp] = await db
      .select()
      .from(species)
      .where(projectIds ? and(eq(species.id, id), inArray(species.projectId, projectIds)) : eq(species.id, id))
      .limit(1);
    if (!sp) return c.json({ error: "Species not found" }, 404);
    return c.json(sp);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch species";
    return c.json({ error: message }, 500);
  }
});

dataRoutes.get("/species/:id/occurrences", async (c) => {
  try {
    const id = c.req.param("id");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const offset = (page - 1) * limit;
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ occurrences: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }

    const speciesConditions = projectIds
      ? and(eq(species.id, id), inArray(species.projectId, projectIds))
      : eq(species.id, id);
    const [sp] = await db.select({ id: species.id }).from(species).where(speciesConditions).limit(1);
    if (!sp) return c.json({ error: "Species not found" }, 404);

    const occConditions = projectIds
      ? and(eq(occurrences.speciesId, id), inArray(occurrences.projectId, projectIds))
      : eq(occurrences.speciesId, id);

    const recs = await db
      .select()
      .from(occurrences)
      .where(occConditions)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(occurrences)
      .where(occConditions);

    return c.json({
      occurrences: recs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch occurrences";
    return c.json({ error: message }, 500);
  }
});

dataRoutes.patch("/uploads/:fileId", async (c) => {
  try {
    const fileId = decodeURIComponent(c.req.param("fileId"));
    const body = await c.req.json();
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ error: "File not found" }, 404);
    }

    const updateData: Record<string, unknown> = {};
    if (typeof body.cleaned === "boolean") updateData.cleaned = body.cleaned;
    if (typeof body.cleaned_file_path === "string") updateData.cleanedFilePath = body.cleaned_file_path;

    await db
      .update(uploadedFiles)
      .set(updateData as any)
      .where(and(
        eq(uploadedFiles.filePath, fileId),
        projectIds ? inArray(uploadedFiles.projectId, projectIds) : undefined,
      ));

    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update upload";
    return c.json({ error: message }, 500);
  }
});

dataRoutes.get("/uploads", async (c) => {
  try {
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ uploads: [] });
    }

    const records = await db
      .select()
      .from(uploadedFiles)
      .where(projectIds ? inArray(uploadedFiles.projectId, projectIds) : undefined)
      .orderBy(desc(uploadedFiles.createdAt))
      .limit(100);

    const uploads = records.map((f) => ({
      file_id: f.filePath,
      file_name: f.originalName,
      file_size: f.fileSize,
      n_rows: f.nRows ?? 0,
      modified_at: f.createdAt.toISOString(),
      cleaned: f.cleaned,
      cleaned_file_id: f.cleanedFilePath,
    }));

    return c.json({ uploads });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list uploads";
    return c.json({ error: message }, 500);
  }
});

// Delete an uploaded occurrence file and reclaim storage
dataRoutes.delete("/uploads/:fileId", async (c) => {
  try {
    const fileId = decodeURIComponent(c.req.param("fileId"));
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);

    // Find the file record (scoped to user's projects)
    const [record] = await db
      .select({
        id: uploadedFiles.id,
        filePath: uploadedFiles.filePath,
        cleanedFilePath: uploadedFiles.cleanedFilePath,
        fileSize: uploadedFiles.fileSize,
      })
      .from(uploadedFiles)
      .where(projectIds
        ? and(eq(uploadedFiles.filePath, fileId), inArray(uploadedFiles.projectId, projectIds))
        : eq(uploadedFiles.filePath, fileId))
      .limit(1);

    if (!record) {
      return c.json({ error: "Upload not found" }, 404);
    }

    // Remove files from disk
    const encPath = record.filePath;
    if (encPath && existsSync(encPath)) {
      rmSync(encPath, { force: true });
    }
    // Remove decrypted version if exists
    const plainPath = encPath?.replace(/\.enc$/, "");
    if (plainPath && existsSync(plainPath)) {
      rmSync(plainPath, { force: true });
    }
    // Remove cleaned file if exists
    if (record.cleanedFilePath) {
      const cleanedEnc = record.cleanedFilePath;
      if (existsSync(cleanedEnc)) rmSync(cleanedEnc, { force: true });
      const cleanedPlain = cleanedEnc.replace(/\.enc$/, "");
      if (existsSync(cleanedPlain)) rmSync(cleanedPlain, { force: true });
    }

    // Delete DB record
    await db.delete(uploadedFiles).where(eq(uploadedFiles.id, record.id));

    // Update storage usage
    await db
      .update(users)
      .set({ storageUsedBytes: sql`greatest(0, ${users.storageUsedBytes} - ${record.fileSize})` })
      .where(eq(users.id, user.id));

    return c.json({ ok: true, message: "Upload deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete upload";
    return c.json({ error: message }, 500);
  }
});

// Get storage usage and quota for the current user
dataRoutes.get("/storage", async (c) => {
  try {
    const user = c.get("user");
    const [record] = await db
      .select({
        storageQuotaBytes: users.storageQuotaBytes,
        storageUsedBytes: users.storageUsedBytes,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!record) {
      return c.json({ error: "User not found" }, 404);
    }

    const quota = Number(record.storageQuotaBytes) || 500 * 1024 * 1024;
    const used = Number(record.storageUsedBytes) || 0;

    return c.json({
      quota_bytes: quota,
      used_bytes: used,
      available_bytes: Math.max(0, quota - used),
      quota_mb: Math.round(quota / (1024 * 1024)),
      used_mb: Math.round(used / (1024 * 1024)),
      available_mb: Math.round(Math.max(0, quota - used) / (1024 * 1024)),
      pct_used: quota > 0 ? Math.round((used / quota) * 100) : 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get storage info";
    return c.json({ error: message }, 500);
  }
});

// Proxy route for async data job status (clean/dwca/gbif jobs run by Plumber)
dataRoutes.get("/jobs/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
    const user = c.get("user");
    const res = await fetch(`${plumberUrl}/api/v1/jobs/status/${jobId}`, {
      headers: {
        ...(internalKey ? { "X-Hono-Internal": internalKey } : {}),
        "X-Forwarded-User": user.id,
      },
    });
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get job status";
    return c.json({ error: message }, 502);
  }
});
