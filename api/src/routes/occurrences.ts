import { Hono } from "hono";
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, accessSync, constants, promises as fs } from "fs";
import { isAbsolute, join, resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { randomUUID, createDecipheriv } from "crypto";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { db } from "../db/index.js";
import { species, occurrences, users, uploadedFiles, uploads, userSettings } from "../db/schema.js";
import { and, count, eq, inArray, desc, sql } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import type { AppEnv } from "../middleware/auth.js";
import { encrypt, decrypt, isEncrypted } from "../services/encryption.js";
import type { PlumberUploadResponse } from "@sdm/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");

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

function saveUploadEncrypted(buffer: Buffer, originalName: string): { encPath: string; pipelineRunId: string } {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
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

function resolveFilePath(fileId: string): { path: string } {
  if (isAbsolute(fileId) && !fileId.endsWith(".enc")) {
    return { path: fileId };
  }
  const encPath = join(UPLOAD_DIR, fileId);
  if (encPath.endsWith(".enc")) {
    const decrypted = decryptToUploads(encPath);
    return { path: decrypted ?? encPath };
  }
  return { path: encPath };
}

async function pollPlumberJob(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
  const deadline = timeout ? Date.now() + timeout : Infinity;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const status = await plumberClient.getJobStatus(jobId);
      if (status?.status === "completed" || status?.status === "success") {
        return status as Record<string, unknown>;
      }
      if (status?.status === "failed" || status?.status === "error") {
        return { error: status.error || "Job failed" };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw lastError || new Error("Polling timed out");
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

    const user = c.get("user");

    // Check storage quota before accepting the file
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
      const error = String((result as Record<string, unknown>).error || "Upload failed");
      return c.json({ error }, 400);
    }

    const fileId = result.file_id || result.file_path;
    const normalizedResult = {
      ...result,
      file_id: fileId,
      file_path: result.file_path || fileId,
    };

    // Track storage usage on success
    await db
      .update(users)
      .set({ storageUsedBytes: (quota?.used ?? 0) + buffer.length })
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

    // Forward max coordinate uncertainty if provided
    const maxCoordinateUncertainty = (body.max_coordinate_uncertainty ?? body.maxCoordinateUncertainty) as number | undefined;
    if (maxCoordinateUncertainty !== undefined) {
      body.max_coordinate_uncertainty = maxCoordinateUncertainty;
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
      // Plumber returns { available: true, status: "completed", result: { ... } }
      const cleanResult = (result && typeof result === "object" ? (result as any).result : null) || result;
      if (body.file_id && cleanResult && typeof cleanResult === "object" && (cleanResult as any).cleaned_file_id) {
        const fp = body.file_id;
        const r = cleanResult as Record<string, unknown>;
        db.update(uploads).set({
          isCleaned: true,
          cleanedFilePath: r.cleaned_file_id as string,
          cleanedValidRecords: (r.valid_records ?? null) as number | null,
          cleanedOriginalRows: (r.original_rows ?? null) as number | null,
          cleaningCcLog: (r.cc_log ?? null) as string[] | null,
          cleaningSourceCounts: (r.source_counts ?? null) as Record<string, number> | null,
        }).where(eq(uploads.filePath, fp)).catch((e: unknown) => console.warn("[clean] Failed to update uploads table:", e instanceof Error ? e.message : e));
      }
      return c.json(result);
    }

    // Sync clean (no job ID at all) — update uploads table
    if (body.file_id && initial && typeof initial === "object" && (initial as any).cleaned_file_id) {
      const fp = body.file_id;
      const r = initial as Record<string, unknown>;
      db.update(uploads).set({
        isCleaned: true,
        cleanedFilePath: r.cleaned_file_id as string,
        cleanedValidRecords: (r.valid_records ?? null) as number | null,
        cleanedOriginalRows: (r.original_rows ?? null) as number | null,
        cleaningCcLog: (r.cc_log ?? null) as string[] | null,
        cleaningSourceCounts: (r.source_counts ?? null) as Record<string, number> | null,
      }).where(eq(uploads.filePath, fp)).catch((e: unknown) => console.warn("[clean] Failed to update uploads table:", e instanceof Error ? e.message : e));
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

  // Handle .enc files (Hono/API convention)
  if (cleanedPath.endsWith(".enc")) {
    const decrypted = decryptToUploads(cleanedPath);
    if (decrypted) dataPath = decrypted;
  }

  // Remap Docker paths to local paths (Docker mounts ./data -> /app/data)
  if (!existsSync(dataPath) && dataPath.startsWith("/app/")) {
    const localPath = dataPath.replace(/^\/app\//, join(PROJECT_ROOT, "/"));
    if (existsSync(localPath)) dataPath = localPath;
  }

  if (!existsSync(dataPath)) return null;

  // Try reading as text, validate it's actually CSV
  let content = tryReadFile(dataPath);
  if (content !== null && !looksLikeCsv(content)) {
    content = null; // binary/garbled — not CSV
  }

  // If not readable as CSV, try Plumber-encrypted format (magic bytes, no .enc)
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

  // Derive CC log from per-test columns
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

dataRoutes.get("/occurrences/clean/result", async (c) => {
  try {
    const fileId = c.req.query("file_id");
    const cleanedFileId = c.req.query("cleaned_file_id");
    if (!fileId && !cleanedFileId) return c.json({ error: "file_id or cleaned_file_id is required" }, 400);

    // Primary path: resolve the cleaned file directly
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

    // Fallback: look up the Plumber upload listing to find the cleaned file path
    if (fileId) {
      const resolved = resolveFilePath(fileId);
      try {
        const uploadsList = await plumberClient.withUser(c.get("user").id).getUploads(200);
        const uploadsArray = (uploadsList as any)?.uploads as Array<Record<string, unknown>> | undefined;
        if (uploadsArray) {
          const match = uploadsArray.find(u => String(u.file_path || "") === resolved.path || String(u.file_id || "") === resolved.path);
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
            // File was cleaned but cleaned file not on disk — return summary
            return c.json({
              cleaned_records: [],
              source_counts: {},
              cc_log: [],
              valid_records: (match.cleaned_valid_records as number) || 0,
              original_rows: (match.cleaned_original_rows as number) || (match.n_rows as number) || 0,
            });
          }
        }
      } catch {
        // Plumber lookup failed, continue to minimal response
      }

      // Last resort: try reading the original file as cleaned file
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

    // Return empty summary rather than 404 so the frontend always gets valid JSON
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

dataRoutes.post("/occurrences/gbif/search", gbifRateLimit, async (c) => {
  try {
    const body = await c.req.json();

    // Inject saved GBIF credentials from user settings when use_auth is true
    // and inline credentials are not provided
    if (body.use_auth && !body.gbif_user && !body.gbif_pwd && !body.gbif_email) {
      try {
        const user = c.get("user");
        const [settings] = await db
          .select({ gbifUsername: userSettings.gbifUsername, gbifPassword: userSettings.gbifPassword, gbifEmail: userSettings.gbifEmail })
          .from(userSettings)
          .where(eq(userSettings.userId, user.id))
          .limit(1);
        if (settings) {
          if (settings.gbifUsername) body.gbif_user = settings.gbifUsername;
          if (settings.gbifPassword) {
            try {
              const { decryptString, isEncryptionKeyConfigured } = await import("../services/encryption.js");
              if (isEncryptionKeyConfigured()) body.gbif_pwd = decryptString(settings.gbifPassword);
            } catch { /* decryption failed — skip */ }
          }
          if (settings.gbifEmail) body.gbif_email = settings.gbifEmail;
        }
      } catch { /* failed to look up settings — continue without injection */ }
    }

    const initial = await plumberClient.searchGbif(body);

    const jobId = initial?.job_id as string | undefined;
    if (jobId) return c.json({ job_id: jobId, status: "running" });

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GBIF search failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/gbif/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const filePath = body.file_path as string | undefined;

    // If a cached file_path is provided, skip re-running the search
    if (filePath) {
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
        details: { source: "gbif", file_path: filePath, pipelineRunId },
      });
      return c.json({
        file_path: filePath,
        file_id: filePath,
        n_rows: 0,
        filename: filePath.split("/").pop() || "gbif_records.csv",
        pipelineRunId,
      });
    }

    const taxon = body.taxon as string;
    const country = body.country as string | undefined;
    const maxRecords = (body.max_records as number) || 100;

    if (!taxon) {
      return c.json({ error: "taxon is required" }, 400);
    }

    const initial = await plumberClient.searchGbif({ taxon, country, max_records: maxRecords });

    const jobId = initial?.job_id as string | undefined;
    let searchResult: Record<string, unknown>;
    if (jobId) {
      const polled = await pollPlumberJob(jobId, 120_000);
      searchResult = (polled.status === "completed" && polled.result && typeof polled.result === "object")
        ? (polled.result as Record<string, unknown>)
        : polled;
    } else {
      searchResult = initial;
    }
    const resultFilePath = searchResult.file_path as string | undefined;
    const nRecords = (searchResult.n_records as number) || 0;

    if (!resultFilePath || nRecords === 0) {
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
      file_path: resultFilePath,
      file_id: resultFilePath,
      n_rows: nRecords,
      filename: resultFilePath.split("/").pop() || "gbif_records.csv",
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save GBIF records";
    return c.json({ error: message }, 502);
  }
});

// ── ALA Search ─────────────────────────────────────────────
dataRoutes.post("/occurrences/ala/search", defaultRateLimit, async (c) => {
  try {
    const body = await c.req.json();

    // Inject saved ALA API key from user settings if not provided inline
    if (!body.api_key) {
      try {
        const user = c.get("user");
        const [settings] = await db
          .select({ alaApiKey: userSettings.alaApiKey })
          .from(userSettings)
          .where(eq(userSettings.userId, user.id))
          .limit(1);
        if (settings?.alaApiKey) {
          try {
            const { decryptString, isEncryptionKeyConfigured } = await import("../services/encryption.js");
            if (isEncryptionKeyConfigured()) body.api_key = decryptString(settings.alaApiKey);
          } catch { /* decryption failed — skip */ }
        }
      } catch { /* failed to look up settings — continue without injection */ }
    }

    const initial = await plumberClient.searchAla(body);

    const jobId = initial?.job_id as string | undefined;
    if (jobId) return c.json({ job_id: jobId, status: "running" });

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ALA search failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/ala/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const filePath = body.file_path as string | undefined;

    if (filePath) {
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
        details: { source: "ala", file_path: filePath, pipelineRunId },
      });
      return c.json({
        file_path: filePath,
        file_id: filePath,
        n_rows: 0,
        filename: filePath.split("/").pop() || "ala_records.csv",
        pipelineRunId,
      });
    }

    const taxon = body.taxon as string;
    const country = body.country as string | undefined;
    const maxRecords = (body.max_records as number) || 1000;

    if (!taxon) {
      return c.json({ error: "taxon is required" }, 400);
    }

    const initial = await plumberClient.searchAla({ taxon, country, max_records: maxRecords });

    const jobId = initial?.job_id as string | undefined;
    let searchResult: Record<string, unknown>;
    if (jobId) {
      const polled = await pollPlumberJob(jobId, 120_000);
      searchResult = (polled.status === "completed" && polled.result && typeof polled.result === "object")
        ? (polled.result as Record<string, unknown>)
        : polled;
    } else {
      searchResult = initial;
    }
    const resultFilePath = searchResult.file_path as string | undefined;
    const nRecords = (searchResult.n_records as number) || 0;

    if (!resultFilePath || nRecords === 0) {
      return c.json({ error: "No ALA records found" }, 404);
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
      details: { source: "ala", taxon, country, n_rows: nRecords, pipelineRunId },
    });

    return c.json({
      file_path: resultFilePath,
      file_id: resultFilePath,
      n_rows: nRecords,
      filename: resultFilePath.split("/").pop() || "ala_records.csv",
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save ALA records";
    return c.json({ error: message }, 502);
  }
});

// ── Data job status (polled by frontend after async submission) ──
dataRoutes.get("/occurrences/job/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!jobId) return c.json({ error: "jobId is required" }, 400);
  try {
    const status = await plumberClient.getJobStatus(jobId);
    if (status.status === "completed") {
      if (status.result && typeof status.result === "object") {
        return c.json(status.result);
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

    // Update the Hono-side uploaded_files table
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

    // Also update the Plumber-side uploads table (used by upload history listing)
    if (typeof body.cleaned === "boolean" || typeof body.cleaned_file_path === "string") {
      const uploadUpdate: Record<string, unknown> = {};
      if (typeof body.cleaned === "boolean") {
        uploadUpdate.isCleaned = body.cleaned;
        uploadUpdate.cleanedFilePath = body.cleaned_file_path || null;
        uploadUpdate.cleanedValidRecords = typeof body.cleaned_valid_records === "number" ? body.cleaned_valid_records : null;
        uploadUpdate.cleanedOriginalRows = typeof body.cleaned_original_rows === "number" ? body.cleaned_original_rows : null;
      }
      await db
        .update(uploads)
        .set(uploadUpdate as any)
        .where(eq(uploads.filePath, fileId));
    }

    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update upload";
    return c.json({ error: message }, 500);
  }
});

// Delete an uploaded occurrence file and reclaim storage
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

    // Try uploadedFiles table first (Hono-managed)
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

    // Fallback to uploads table (Plumber-managed)
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

// ── Boundary endpoints ──────────────────────────────────────────────────────

// Enhanced default boundary with resolution/type/country params
dataRoutes.get("/boundary/default", async (c) => {
  try {
    const user = c.get("user");
    const resolution = c.req.query("resolution");
    const type = c.req.query("type");
    const country = c.req.query("country");
    const body: Record<string, unknown> = {};
    if (resolution) body.resolution = resolution;
    if (type) body.type = type;
    if (country) body.country = country;
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/default", body);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch boundary";
    return c.json({ error: message }, 502);
  }
});

// Upload custom boundary
dataRoutes.post("/boundary/upload", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/upload", {
      file_name: file.name,
      file_content: base64,
    });
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Boundary upload failed";
    return c.json({ error: message }, 502);
  }
});

// List custom boundaries
dataRoutes.get("/boundary/list", async (c) => {
  try {
    const user = c.get("user");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/list", {});
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list boundaries";
    return c.json({ error: message }, 502);
  }
});

// Delete custom boundary
dataRoutes.delete("/boundary/delete/:id", async (c) => {
  try {
    const user = c.get("user");
    const filePath = c.req.param("id");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/delete", { file_path: filePath });
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete boundary";
    return c.json({ error: message }, 502);
  }
});

// List country names from Admin 0 boundary
dataRoutes.get("/boundary/countries", async (c) => {
  try {
    const user = c.get("user");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/countries", {});
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch countries";
    return c.json({ error: message }, 502);
  }
});

// Compute bounding box extent of a boundary file
dataRoutes.get("/boundary/extent", async (c) => {
  try {
    const user = c.get("user");
    const filePath = c.req.query("file_path");
    const type = c.req.query("type");
    const resolution = c.req.query("resolution");
    const country = c.req.query("country");
    const bufferDeg = c.req.query("buffer_deg") || "2";
    const body: Record<string, unknown> = { buffer_deg: Number(bufferDeg) };
    if (filePath) body.file_path = filePath;
    if (type) body.type = type;
    if (resolution) body.resolution = resolution;
    if (country) body.country = country;
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/extent", body);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute extent";
    return c.json({ error: message }, 502);
  }
});

// Download NE boundary to custom directory for model use
dataRoutes.post("/boundary/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const [status, data] = await plumberClient.withUser(user.id).postRaw("/api/v1/data/boundary/download", body);
    return c.json(data, status >= 400 ? (status as 400 | 404 | 500) : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download boundary";
    return c.json({ status: "error", message }, 502);
  }
});
