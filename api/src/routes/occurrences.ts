import { Hono } from "hono";
import { mkdirSync, existsSync, statSync, writeFileSync, readFileSync, rmSync, accessSync, constants, promises as fs } from "fs";
import { join, resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { randomUUID, createDecipheriv } from "crypto";
import { plumberClient } from "../services/plumber.js";
import { db } from "../db/index.js";
import { species, occurrences, users, uploadedFiles, uploads } from "../db/schema.js";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import type { AppEnv } from "../middleware/auth.js";
import { encrypt, decrypt } from "../services/encryption.js";
import { setUploadDir, saveUploadEncrypted, decryptToUploads, resolveFilePath, pollPlumberJob } from "../services/upload-utils.js";
import type { PlumberUploadResponse } from "@sdm/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");
setUploadDir(UPLOAD_DIR);

async function saveUpload(buffer: Buffer, originalName: string): Promise<string> {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const destPath = join(UPLOAD_DIR, `${ts}_${safeName}`);
  await fs.writeFile(destPath, buffer);
  return destPath;
}

export const dataRoutes = new Hono<AppEnv>();

dataRoutes.use("*", authMiddleware);
dataRoutes.use("*", defaultRateLimit);

dataRoutes.get("/occurrences/uploads", async (c) => {
  try {
    const limit = c.req.query("limit") || "50";
    const user = c.get("user");
    const result = await plumberClient.withUser(user.id).getUploads(parseInt(limit, 10));
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list uploads";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.get("/occurrences/job/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!jobId) return c.json({ error: "jobId is required" }, 400);
  try {
    const status = await plumberClient.getJobStatus(jobId);
    if (status.status === "completed") {
      if (status.result && typeof status.result === "object") {
        return c.json({ status: "completed", result: status.result });
      }
      return c.json({ error: "Job completed but no result data" }, 502);
    }
    if (status.status === "failed" || status.status === "error") {
      return c.json({ error: (status.error as string) || "Job failed" }, 502);
    }
    return c.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get job status";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.get("/occurrences/clean/result", async (c) => {
  try {
    const fileId = c.req.query("file_id");
    const cleanedFileId = c.req.query("cleaned_file_id");
    if (!fileId && !cleanedFileId) return c.json({ error: "file_id or cleaned_file_id is required" }, 400);

    if (cleanedFileId) {
      const resolved = resolveFilePath(cleanedFileId);
      const result = readCleanResultFromFile(resolved.path);
      if (result) {
        return c.json({
          cleaned_records: result.records,
          source_counts: result.sourceCounts,
          cc_log: result.ccLog,
          valid_records: result.totalRecords,
          original_rows: result.totalRecords,
        });
      }
    }

    if (fileId) {
      const resolved = resolveFilePath(fileId);
      try {
        const uploadsList = await plumberClient.withUser(c.get("user").id).getUploads(200);
        const match = uploadsList.uploads.find(u => String(u.file_path || "") === resolved.path || String(u.file_id || "") === resolved.path);
        if (match) {
          const cleanedPath = (match.cleaned_file_path as string) || (match.cleaned_file_id as string);
          if (cleanedPath) {
            const result = readCleanResultFromFile(cleanedPath);
            if (result) {
              return c.json({
                cleaned_records: result.records,
                source_counts: result.sourceCounts,
                cc_log: result.ccLog,
                valid_records: result.totalRecords,
                original_rows: (match.cleaned_original_rows as number) || result.totalRecords,
              });
            }
          }
          return c.json({
            cleaned_records: [],
            source_counts: {},
            cc_log: [],
            valid_records: (match.cleaned_valid_records as number) || 0,
            original_rows: (match.cleaned_original_rows as number) || (match.n_rows as number) || 0,
          });
        }
      } catch {
      }

      const result = readCleanResultFromFile(resolved.path);
      if (result) {
        return c.json({
          cleaned_records: result.records,
          source_counts: result.sourceCounts,
          cc_log: result.ccLog,
          valid_records: result.totalRecords,
          original_rows: result.totalRecords,
        });
      }
    }

    return c.json({
      cleaned_records: [],
      source_counts: {},
      cc_log: [],
      valid_records: 0,
      original_rows: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get cleaning result";
    return c.json({ error: message }, 502);
  }
});

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

    const user = c.get("user");

    const [quota] = await db
      .select({ used: users.storageUsedBytes, quota: users.storageQuotaBytes })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (quota && quota.used !== null && quota.quota !== null && quota.used + file.size > quota.quota) {
      return c.json({
        error: "Storage quota exceeded",
        used: quota.used,
        quota: quota.quota,
        fileSize: file.size,
      }, 413);
    }

    const allowedTypes = ["text/csv", "text/tab-separated-values", "application/zip", "text/plain", "application/json"];
    if (!allowedTypes.includes(file.type) && !file.name.endsWith(".csv") && !file.name.endsWith(".tsv") && !file.name.endsWith(".txt") && !file.name.endsWith(".zip") && !file.name.endsWith(".geojson")) {
      return c.json({ error: `Unsupported file type: ${file.type}. Accepted: CSV, TSV, TXT, ZIP, GeoJSON.` }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const destPath = await saveUpload(buffer, file.name);

    const result = await plumberClient.withUser(user.id).uploadOccurrence(destPath, file.name);

    if (result && typeof result === "object" && "error" in result) {
      const error = String(result.error || "Upload failed");
      return c.json({ error }, 400);
    }

    const fileId = result.file_id || result.file_path;
    const normalizedResult = {
      ...result,
      file_id: fileId,
      file_path: result.file_path || fileId,
    };

    await db
      .update(users)
      .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${buffer.length}` })
      .where(eq(users.id, user.id));

    return c.json(normalizedResult);
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

    const fileId = body.file_id || body.fileId;
    if (fileId) {
      const resolved = resolveFilePath(fileId);
      body.file_id = resolved.path;
    }

    const maxCoordinateUncertainty = body.max_coordinate_uncertainty ?? body.maxCoordinateUncertainty;
    if (maxCoordinateUncertainty !== undefined) {
      body.max_coordinate_uncertainty = maxCoordinateUncertainty;
    }

    const initial = await plumberClient.withUser(user.id).cleanOccurrences(body);

    if (initial && typeof initial === "object" && "error" in initial) {
      return c.json(initial, 502);
    }

    const jobId = (initial?.job_id || initial?.jobId) as string | undefined;

    if (body.async && jobId) {
      return c.json({ job_id: jobId, status: "running" } as Record<string, unknown>);
    }

    if (jobId) {
      const result = await pollPlumberJob(jobId, 600000);
      const cleanResult = (result && typeof result === "object" ? result.result : null) || result;
      if (body.file_id && cleanResult && typeof cleanResult === "object" && (cleanResult as Record<string, unknown>).cleaned_file_id) {
        const fp = body.file_id;
        const r = cleanResult as Record<string, unknown>;
        try {
          await db.update(uploads).set({
            isCleaned: true,
            cleanedFilePath: r.cleaned_file_id as string,
            cleanedValidRecords: (r.valid_records ?? null) as number | null,
            cleanedOriginalRows: (r.original_rows ?? null) as number | null,
            cleaningCcLog: (r.cc_log ?? null) as string[] | null,
            cleaningSourceCounts: (r.source_counts ?? null) as Record<string, number> | null,
          }).where(eq(uploads.filePath, fp));
        } catch (e: unknown) {
          console.warn("[clean] Failed to update uploads table:", e instanceof Error ? e.message : e);
        }
      }
      return c.json(result);
    }

    if (body.file_id && initial && typeof initial === "object" && (initial as Record<string, unknown>).cleaned_file_id) {
      const fp = body.file_id;
      const r = initial as Record<string, unknown>;
      try {
        await db.update(uploads).set({
          isCleaned: true,
          cleanedFilePath: r.cleaned_file_id as string,
          cleanedValidRecords: (r.valid_records ?? null) as number | null,
          cleanedOriginalRows: (r.original_rows ?? null) as number | null,
          cleaningCcLog: (r.cc_log ?? null) as string[] | null,
          cleaningSourceCounts: (r.source_counts ?? null) as Record<string, number> | null,
        }).where(eq(uploads.filePath, fp));
      } catch (e: unknown) {
        console.warn("[clean] Failed to update uploads table:", e instanceof Error ? e.message : e);
      }
    }

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean failed";
    return c.json({ error: message }, 502);
  }
});

const PLUMBER_MAGIC = Buffer.from([0x53, 0x44, 0x4d, 0x45, 0x4e, 0x43, 0x31, 0x0a]);

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function decryptPlumberFile(encPath: string): string | null {
  if (!existsSync(encPath)) return null;
  try {
    const encrypted = readFileSync(encPath);
    if (encrypted.length < PLUMBER_MAGIC.length + 12 + 1 || !PLUMBER_MAGIC.equals(encrypted.subarray(0, PLUMBER_MAGIC.length))) {
      return null;
    }
    const keyHex = process.env.DATA_ENCRYPTION_KEY || process.env.SDM_ENCRYPTION_KEY || "";
    if (!keyHex) return null;
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) return null;

    const iv = encrypted.subarray(PLUMBER_MAGIC.length, PLUMBER_MAGIC.length + 12);
    const payload = encrypted.subarray(PLUMBER_MAGIC.length + 12);
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(0, payload.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plainPath = encPath + ".decrypted";
    writeFileSync(plainPath, decrypted);
    return plainPath;
  } catch {
    return null;
  }
}

function looksLikeCsv(content: string): boolean {
  const firstNewline = content.indexOf("\n");
  if (firstNewline < 1) return false;
  const firstLine = content.slice(0, firstNewline);
  return firstLine.includes(",") || firstLine.includes("\t");
}

function tryReadFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readCleanResultFromFile(cleanedPath: string): {
  records: Record<string, unknown>[];
  sourceCounts: Record<string, number>;
  ccLog: string[];
  totalRecords: number;
} | null {
  let dataPath = cleanedPath;

  if (cleanedPath.endsWith(".enc")) {
    const decrypted = decryptToUploads(cleanedPath);
    if (decrypted) dataPath = decrypted;
  }

  if (!existsSync(dataPath) && dataPath.startsWith("/app/")) {
    const localPath = dataPath.replace(/^\/app\//, join(PROJECT_ROOT, "/"));
    if (existsSync(localPath)) dataPath = localPath;
  }

  if (!existsSync(dataPath)) return null;

  let content = tryReadFile(dataPath);
  if (content !== null && !looksLikeCsv(content)) {
    content = null;
  }

  if (content === null) {
    const plainPath = decryptPlumberFile(dataPath);
    if (plainPath) {
      content = tryReadFile(plainPath);
      if (content) dataPath = plainPath;
    }
  }

  if (content === null || content.trim().length === 0) return null;

  const lines = content.trim().split("\n");
  if (lines.length < 2) return { records: [], sourceCounts: {}, ccLog: [], totalRecords: 0 };

  const stripQuotes = (s: string) => s.replace(/^"|"$/g, "").trim();
  const headers = lines[0].split(",").map(h => stripQuotes(h));
  const records: Record<string, unknown>[] = [];
  const sourceCounts: Record<string, number> = {};

  for (let i = 1; i < Math.min(lines.length, 101); i++) {
    const values = splitCsvLine(lines[i]).map(v => stripQuotes(v));
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const val = values[idx];
      const num = Number(val);
      row[h] = isNaN(num) ? (val || null) : num;
    });
    records.push(row);
    const src = String(row.source || row["source"] || "unknown");
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }

  const ccLog: string[] = [];
  const totalRecords = lines.length - 1;
  ccLog.push("CoordinateCleaner Results:");
  ccLog.push(`  Total records: ${totalRecords.toLocaleString()}`);

  const ccTestNames: Record<string, string> = {
    cc_test_sea: "Sea coordinates",
    cc_test_capitals: "Capital cities",
    cc_test_centroids: "Country centroids",
    cc_test_institutions: "Biodiversity institutions",
    cc_test_urban: "Urban areas",
    cc_test_zero: "Zero coordinates",
  };

  let totalFlagged = 0;
  for (const [col, label] of Object.entries(ccTestNames)) {
    const colIdx = headers.indexOf(col);
    if (colIdx === -1) continue;
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = splitCsvLine(lines[i]);
      const v = stripQuotes(vals[colIdx] || "");
      if (v === "true" || v === "TRUE" || v === "1") count++;
    }
    totalFlagged += count;
    ccLog.push(`    ${label}: ${count.toLocaleString()}`);
  }

  if (totalFlagged > 0) {
    ccLog.splice(1, 0, `  Flagged: ${totalFlagged.toLocaleString()} (${(100 * totalFlagged / totalRecords).toFixed(1)}%)`);
  }

  return { records, sourceCounts, ccLog, totalRecords };
}

dataRoutes.get("/species", async (c) => {
  try {
    const limitVal = Math.min(parseInt(c.req.query("limit") || "200", 10), 500);
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);
    if (projectIds && projectIds.length === 0) {
      return c.json({ species: [], hasMore: false });
    }

    const speciesQuery = db.select({
      id: species.id,
      name: species.name,
      occurrenceCount: species.occurrenceCount,
      createdAt: species.createdAt,
      updatedAt: species.updatedAt,
    }).from(species);
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
      .select({
        id: occurrences.id,
        longitude: occurrences.longitude,
        latitude: occurrences.latitude,
        source: occurrences.source,
        flagged: occurrences.flagged,
        flagReason: occurrences.flagReason,
        cleaned: occurrences.cleaned,
        createdAt: occurrences.createdAt,
      })
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

    interface UploadFileUpdate {
      cleaned?: boolean;
      cleanedFilePath?: string;
    }
    const updateData: UploadFileUpdate = {};
    if (typeof body.cleaned === "boolean") updateData.cleaned = body.cleaned;
    if (typeof body.cleaned_file_path === "string") updateData.cleanedFilePath = body.cleaned_file_path;

    await db
      .update(uploadedFiles)
      .set(updateData)
      .where(and(
        eq(uploadedFiles.filePath, fileId),
        projectIds ? inArray(uploadedFiles.projectId, projectIds) : undefined,
      ));

    if (typeof body.cleaned === "boolean" || typeof body.cleaned_file_path === "string") {
      interface UploadUpdate {
        isCleaned?: boolean;
        cleanedFilePath?: string | null;
        cleanedValidRecords?: number | null;
        cleanedOriginalRows?: number | null;
      }
      const uploadUpdate: UploadUpdate = {};
      if (typeof body.cleaned === "boolean") {
        uploadUpdate.isCleaned = body.cleaned;
        uploadUpdate.cleanedFilePath = body.cleaned_file_path || null;
        uploadUpdate.cleanedValidRecords = typeof body.cleaned_valid_records === "number" ? body.cleaned_valid_records : null;
        uploadUpdate.cleanedOriginalRows = typeof body.cleaned_original_rows === "number" ? body.cleaned_original_rows : null;
      }
      await db
        .update(uploads)
        .set(uploadUpdate)
        .where(eq(uploads.filePath, fileId));
    }

    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update upload";
    return c.json({ error: message }, 500);
  }
});

async function deleteFilesFromDisk(filePath: string | null, cleanedFilePath: string | null) {
  if (filePath) {
    if (existsSync(filePath)) rmSync(filePath, { force: true });
    const plain = filePath.replace(/\.enc$/, "");
    if (plain !== filePath && existsSync(plain)) rmSync(plain, { force: true });
  }
  if (cleanedFilePath) {
    if (existsSync(cleanedFilePath)) rmSync(cleanedFilePath, { force: true });
    const cleanedPlain = cleanedFilePath.replace(/\.enc$/, "");
    if (cleanedPlain !== cleanedFilePath && existsSync(cleanedPlain)) rmSync(cleanedPlain, { force: true });
  }
}

dataRoutes.delete("/uploads/:fileId", async (c) => {
  try {
    const fileId = decodeURIComponent(c.req.param("fileId"));
    const user = c.get("user");
    const projectIds = await getUserProjectIds(user);

    const [ufRecord] = await db
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

    if (ufRecord) {
      await deleteFilesFromDisk(ufRecord.filePath, ufRecord.cleanedFilePath);
      await db.delete(uploadedFiles).where(eq(uploadedFiles.id, ufRecord.id));
      await db.delete(uploads).where(eq(uploads.filePath, fileId));
      await db
        .update(users)
        .set({ storageUsedBytes: sql`greatest(0, ${users.storageUsedBytes} - ${ufRecord.fileSize})` })
        .where(eq(users.id, user.id));
      return c.json({ ok: true, message: "Upload deleted" });
    }

    const [upRecord] = await db
      .select({
        filePath: uploads.filePath,
        cleanedFilePath: uploads.cleanedFilePath,
      })
      .from(uploads)
      .where(eq(uploads.filePath, fileId))
      .limit(1);

    if (!upRecord) {
      return c.json({ error: "Upload not found" }, 404);
    }

    await deleteFilesFromDisk(upRecord.filePath, upRecord.cleanedFilePath);
    await db.delete(uploads).where(eq(uploads.filePath, fileId));

    return c.json({ ok: true, message: "Upload deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete upload";
    return c.json({ error: message }, 500);
  }
});

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
    return c.json(data, res.status as 200 | 400 | 404 | 500 | 502);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get job status";
    return c.json({ error: message }, 502);
  }
});

// Generate synthetic multi-species occurrence data for stress testing
dataRoutes.post("/occurrences/synthetic", async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");
    const plumberUrl = process.env.PLUMBER_URL || "http://localhost:8000";
    const internalKey = process.env.PLUMBER_INTERNAL_KEY || "";
    const res = await fetch(`${plumberUrl}/api/v1/occurrences/synthetic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalKey ? { "X-Hono-Internal": internalKey } : {}),
        "X-Forwarded-User": user.id,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return c.json(data, res.status as 200 | 400 | 500 | 502);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Synthetic data generation failed";
    return c.json({ error: message }, 502);
  }
});
