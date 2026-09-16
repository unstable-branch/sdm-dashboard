import { Hono } from "hono";
import { mkdirSync, existsSync, writeFileSync, readFileSync, promises as fs } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "node:crypto";
import { plumberClient } from "../services/plumber.js";
import { writeAtomic } from "../services/storage.js";
import { db } from "../db/index.js";
import { species, occurrences, users, uploads, inputAssets, occurrenceCleanJobs } from "../db/schema.js";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import type { AppEnv } from "../middleware/auth.js";
import { decrypt } from "../services/encryption.js";
import { setUploadDir, decryptToUploads, pollPlumberJob } from "../services/upload-utils.js";
import {
  InputAssetRegistrationError,
  registerDerivedInputAssetFromServerPath,
  registerInputAssetFromServerPath,
  resolveInputAsset,
  updateInputAssetState,
  type InputAssetRow,
} from "../services/input-assets.js";
import { logAction, extractClientInfo } from "../services/audit.js";

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
  const destPath = join(UPLOAD_DIR, `${Date.now()}_${randomUUID()}_${safeName}`);
  await writeAtomic(destPath, buffer);
  return destPath;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_INPUT_KEYS = ["file_id", "fileId", "file_path", "filePath", "cleaned_file_path", "cleanedFilePath", "cleaned_file_id", "cleanedFileId"] as const;
const RAW_ASSET_KEYS = ["rawAssetId", "raw_asset_id", "occurrenceAssetId", "occurrence_asset_id"] as const;

function isAssetId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function getRawAssetId(body: Record<string, unknown>): string | null {
  for (const key of RAW_ASSET_KEYS) {
    if (body[key] !== undefined) return isAssetId(body[key]) ? body[key] : null;
  }
  return null;
}

function hasPathInput(body: Record<string, unknown>): boolean {
  return PATH_INPUT_KEYS.some((key) => body[key] !== undefined && body[key] !== null && body[key] !== "");
}

function pathInputError() {
  return { error: "Path-based occurrence inputs are no longer supported; use the opaque rawAssetId returned by upload." };
}

function unwrapJobResult(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.result;
  return nested && typeof nested === "object" ? nested as Record<string, unknown> : value;
}

async function removeOwnedFile(path: string): Promise<void> {
  const candidate = resolve(path);
  const root = resolve(UPLOAD_DIR);
  if (candidate === root || !candidate.startsWith(root + "/")) {
    throw new InputAssetRegistrationError("Asset storage is outside the owned upload root");
  }
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new InputAssetRegistrationError("Asset storage is unsafe");
  }
  await fs.unlink(candidate);
}

async function removeNewFile(path: string | null | undefined): Promise<void> {
  if (!path || typeof path !== "string") return;
  const candidate = resolve(path);
  const root = resolve(UPLOAD_DIR);
  if (candidate === root || !candidate.startsWith(root + "/")) return;
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    await fs.unlink(candidate);
  } catch {
    // Missing cleanup is reported by the caller without attempting to remove
    // an ambiguous or out-of-root file.
  }
}

async function registerRawOccurrenceAsset(
  user: { id: string },
  absolutePath: string,
  metadata: { filename?: string; fileSize?: number; format?: string; nRows?: number; species?: string | null },
): Promise<InputAssetRow> {
  const asset = await registerInputAssetFromServerPath({
    creatorUserId: user.id,
    scope: "private",
    kind: "raw_occurrence",
    absolutePath,
  });

  // Keep the legacy row as compatibility metadata for Plumber and existing
  // readers. It never supplies canonical identity or ownership.
  try {
    await db.insert(uploads).values({
      userId: user.id,
      filename: metadata.filename || "occurrence_upload",
      filePath: absolutePath,
      fileSize: metadata.fileSize || 0,
      format: metadata.format || "csv",
      nRows: metadata.nRows || 0,
      species: metadata.species || null,
      isCleaned: false,
    }).onConflictDoNothing();
  } catch {
    // The canonical asset is already durable and remains the authority. The
    // compatibility row is deliberately best-effort and cannot block a safe
    // asset response.
  }
  return asset;
}

async function resolveRawOccurrenceAsset(user: { id: string; role: string }, rawAssetId: string) {
  return resolveInputAsset({
    assetId: rawAssetId,
    principal: { id: user.id, role: user.role },
    action: "use",
    expectedKind: "raw_occurrence",
  });
}

async function registerCleanedOccurrenceAsset(
  user: { id: string; role: string },
  rawAssetId: string,
  result: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cleanedPath = result.cleaned_file_id;
  if (typeof cleanedPath !== "string" || !cleanedPath.startsWith("/")) {
    throw new InputAssetRegistrationError("Cleaner did not return a server-owned output");
  }
  const parent = await resolveRawOccurrenceAsset(user, rawAssetId);
  if (!parent.ok) throw new InputAssetRegistrationError("Raw occurrence asset is no longer available");

  let cleanedAsset: InputAssetRow;
  try {
    cleanedAsset = await registerDerivedInputAssetFromServerPath({
      creatorUserId: user.id,
      actorUserId: user.id,
      scope: parent.asset.scope === "project" ? "project" : "private",
      projectId: parent.asset.projectId,
      kind: "cleaned_occurrence",
      parentAssetId: rawAssetId,
      absolutePath: cleanedPath,
    });
  } catch (error) {
    throw error instanceof InputAssetRegistrationError
      ? error
      : new InputAssetRegistrationError("Cleaned occurrence registration failed");
  }

  // Legacy cleaned pointers are written only by this successful server-side
  // cleaner commit. PATCH never accepts or mutates this field.
  try {
    await db.update(uploads).set({
      isCleaned: true,
      cleanedFilePath: cleanedPath,
      cleanedValidRecords: typeof result.valid_records === "number" ? result.valid_records : null,
      cleanedOriginalRows: typeof result.original_rows === "number" ? result.original_rows : null,
      cleaningCcLog: (result.cc_log as string[] | undefined) || null,
      cleaningSourceCounts: (result.source_counts as Record<string, number> | undefined) || null,
    }).where(eq(uploads.filePath, parent.absolutePath));
  } catch {
    // Legacy metadata is non-authoritative; the canonical derivative remains.
  }

  const publicResult = { ...result };
  for (const key of PATH_INPUT_KEYS) delete publicResult[key];
  return {
    ...publicResult,
    cleanedAssetId: cleanedAsset.id,
    cleaned_asset_id: cleanedAsset.id,
  };
}

export const dataRoutes = new Hono<AppEnv>();

dataRoutes.use("*", authMiddleware);
dataRoutes.use("*", defaultRateLimit);

dataRoutes.get("/occurrences/uploads", async (c) => {
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);
    const user = c.get("user");
    const legacyUploads = await db.select().from(uploads)
      .where(eq(uploads.userId, user.id)).limit(limit * 4);

    const assets = await db.select({
      id: inputAssets.id,
      creatorUserId: inputAssets.creatorUserId,
      projectId: inputAssets.projectId,
      scope: inputAssets.scope,
      storageLocator: inputAssets.storageLocator,
      kind: inputAssets.kind,
      state: inputAssets.state,
      parentAssetId: inputAssets.parentAssetId,
      contentSize: inputAssets.contentSize,
      createdAt: inputAssets.createdAt,
    }).from(inputAssets).where(eq(inputAssets.creatorUserId, user.id)).limit(limit * 4);

    // Re-check authorization, lineage, storage realpath and content identity
    // against the current principal before exposing any canonical row.
    const resolvedAssets = (await Promise.all(assets.map(async (asset) => {
      if (asset.kind !== "raw_occurrence" || asset.state !== "ready") return null;
      const resolved = await resolveInputAsset({
        assetId: asset.id,
        principal: { id: user.id, role: user.role },
        action: "read",
        expectedKind: "raw_occurrence",
      });
      return resolved.ok ? { asset, absolutePath: resolved.absolutePath } : null;
    }))).filter((entry): entry is { asset: typeof assets[number]; absolutePath: string } => entry !== null);

    const cleanedByParent = new Map<string, string>();
    await Promise.all(assets.filter((asset) => asset.kind === "cleaned_occurrence" && asset.state === "ready" && asset.parentAssetId).map(async (asset) => {
      const resolved = await resolveInputAsset({
        assetId: asset.id,
        principal: { id: user.id, role: user.role },
        action: "read",
        expectedKind: "cleaned_occurrence",
        expectedParentAssetId: asset.parentAssetId,
      });
      if (resolved.ok && asset.parentAssetId) cleanedByParent.set(asset.parentAssetId, asset.id);
    }));

    const canonicalUploads = resolvedAssets.map(({ asset, absolutePath }) => {
      const basename = absolutePath.split("/").pop() || asset.id;
      const legacy = legacyUploads.find((upload) => upload.filePath === absolutePath);
      const cleanedId = cleanedByParent.get(asset.id);
      return {
        id: asset.id,
        filename: legacy?.filename || basename,
        file_size: legacy?.fileSize ?? asset.contentSize ?? 0,
        format: legacy?.format || null,
        n_rows: legacy?.nRows || 0,
        species: legacy?.species || null,
        modified_at: legacy?.createdAt || asset.createdAt,
        rawAssetId: asset.id,
        raw_asset_id: asset.id,
        cleanedAssetId: cleanedId,
        cleaned_asset_id: cleanedId,
      };
    });

    // Unmapped path-only legacy rows are intentionally omitted. They must be
    // re-uploaded before they can participate in canonical workflows.
    return c.json({ uploads: canonicalUploads.slice(0, limit) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list uploads";
    return c.json({ error: message }, 502);
  }
});
dataRoutes.get("/occurrences/job/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!jobId) return c.json({ error: "jobId is required" }, 400);
  try {
    const user = c.get("user");
    const status = await plumberClient.withUser(user.id).withRole(user.role).getJobStatus(jobId);
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
    const user = c.get("user");
    const rawAssetId = c.req.query("raw_asset_id") || c.req.query("rawAssetId") || c.req.query("occurrence_asset_id");
    const cleanedAssetId = c.req.query("cleaned_asset_id") || c.req.query("cleanedAssetId");
    if ([c.req.query("file_id"), c.req.query("cleaned_file_id"), c.req.query("file_path"), c.req.query("cleaned_file_path")].some(Boolean)) {
      return c.json(pathInputError(), 400);
    }
    if (!rawAssetId || !isAssetId(rawAssetId)) return c.json({ error: "rawAssetId is required" }, 400);
    if (cleanedAssetId !== undefined && !isAssetId(cleanedAssetId)) return c.json({ error: "Invalid cleanedAssetId" }, 400);

    const parent = await resolveRawOccurrenceAsset(user, rawAssetId);
    if (!parent.ok) return c.json({ error: parent.reason === "unavailable" ? "Asset service unavailable" : "Occurrence asset not found" }, parent.reason === "unavailable" ? 503 : 404);
    if (!cleanedAssetId) {
      return c.json({ cleaned_records: [], source_counts: {}, cc_log: [], valid_records: 0, original_rows: 0, rawAssetId: rawAssetId, raw_asset_id: rawAssetId });
    }

    const cleaned = await resolveInputAsset({
      assetId: cleanedAssetId,
      principal: { id: user.id, role: user.role },
      action: "read",
      expectedKind: "cleaned_occurrence",
      expectedParentAssetId: rawAssetId,
    });
    if (!cleaned.ok) return c.json({ error: cleaned.reason === "unavailable" ? "Asset service unavailable" : "Cleaned asset not found" }, cleaned.reason === "unavailable" ? 503 : 404);
    const result = readCleanResultFromFile(cleaned.absolutePath);
    if (!result) return c.json({ error: "Cleaned output is unavailable" }, 503);
    return c.json({
      cleaned_records: result.records,
      source_counts: result.sourceCounts,
      cc_log: result.ccLog,
      valid_records: result.totalRecords,
      original_rows: result.totalRecords,
      rawAssetId: rawAssetId,
      raw_asset_id: rawAssetId,
      cleanedAssetId: cleanedAssetId,
      cleaned_asset_id: cleanedAssetId,
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

    // Send bytes to Plumber. JSON file_path staging is intentionally not used
    // here, so a caller cannot make Plumber claim an existing path.
    const result = await plumberClient.withUser(user.id).withRole(user.role).uploadOccurrence(buffer, file.name);

    if (result && typeof result === "object" && "error" in result) {
      const error = String(result.error || "Upload failed");
      await removeNewFile(destPath);
      return c.json({ error }, 400);
    }

    let rawAsset: InputAssetRow;
    try {
      rawAsset = await registerRawOccurrenceAsset(user, destPath, {
        filename: file.name,
        fileSize: buffer.length,
        format: file.name.endsWith(".tsv") ? "tsv" : file.name.endsWith(".zip") ? "dwca" : "csv",
        nRows: typeof result.n_rows === "number" ? result.n_rows : 0,
        species: typeof result.species_detected === "string" ? result.species_detected : null,
      });
    } catch (error) {
      await Promise.all([
        removeNewFile(destPath),
        removeNewFile(typeof result.file_id === "string" ? result.file_id : null),
        removeNewFile(typeof result.file_path === "string" ? result.file_path : null),
      ]);
      throw error;
    }

    const publicResult: Record<string, unknown> = { ...result };
    for (const key of PATH_INPUT_KEYS) delete publicResult[key];
    const normalizedResult = {
      ...publicResult,
      file_id: rawAsset.id,
      rawAssetId: rawAsset.id,
      raw_asset_id: rawAsset.id,
    };

    try {
      await db
        .update(users)
        .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${buffer.length}` })
        .where(eq(users.id, user.id));
    } catch {
      // Do not return an opaque ID when the associated quota/accounting write
      // cannot commit. Quarantine is best-effort and remains fail-closed if
      // the database itself is unavailable.
      await updateInputAssetState(rawAsset.id, "quarantined");
      await Promise.all([
        removeNewFile(destPath),
        removeNewFile(typeof result.file_id === "string" ? result.file_id : null),
        removeNewFile(typeof result.file_path === "string" ? result.file_path : null),
      ]);
      throw new InputAssetRegistrationError("Upload accounting is unavailable");
    }

    return c.json(normalizedResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    if (err instanceof InputAssetRegistrationError) {
      return c.json({ error: message }, 503);
    }
    const isPlumberDown = message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("connect") || message.includes("ENOTFOUND") || message.includes("ETIMEDOUT") || message.includes("ECONNRESET");
    return c.json({
      error: isPlumberDown
        ? "Upload failed: Plumber backend is not running. Start it with: docker compose -f docker-compose.dev.yml --profile computation up -d"
        : message,
    }, isPlumberDown ? 503 : 502);
  }
});

dataRoutes.post("/occurrences/clean", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const user = c.get("user");

    if (hasPathInput(body)) return c.json(pathInputError(), 400);
    const rawAssetId = getRawAssetId(body);
    if (!rawAssetId) return c.json({ error: "rawAssetId is required" }, 400);
    const parent = await resolveRawOccurrenceAsset(user, rawAssetId);
    if (!parent.ok) {
      return c.json({ error: parent.reason === "unavailable" ? "Asset service unavailable" : "Occurrence asset not found" }, parent.reason === "unavailable" ? 503 : 404);
    }

    // The only path sent to Plumber is resolved from the canonical registry;
    // it is never accepted as a client identity or persisted as one.
    const plumberBody: Record<string, unknown> = { ...body, file_id: parent.absolutePath };
    for (const key of RAW_ASSET_KEYS) delete plumberBody[key];

    const maxCoordinateUncertainty = plumberBody.max_coordinate_uncertainty ?? plumberBody.maxCoordinateUncertainty;
    if (maxCoordinateUncertainty !== undefined) {
      plumberBody.max_coordinate_uncertainty = maxCoordinateUncertainty;
    }

    const client = plumberClient.withUser(user.id).withRole(user.role);
    const initial = await client.cleanOccurrences(plumberBody);

    const { ipAddress, userAgent } = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: "occurrence_cleaned",
      entity: "occurrences",
      entityId: null,
      ipAddress,
      userAgent,
      details: { rawAssetId, async: !!body.async },
    });

    if (initial && typeof initial === "object" && "error" in initial) {
      return c.json(initial, 502);
    }

    const jobId = (initial?.job_id || initial?.jobId) as string | undefined;

    if (body.async && jobId) {
      if (jobId.length > 255) throw new InputAssetRegistrationError("Cleaner returned an invalid job identity");
      await db.insert(occurrenceCleanJobs).values({ jobId, userId: user.id, rawAssetId })
        .onConflictDoNothing({ target: occurrenceCleanJobs.jobId });
      const [binding] = await db.select().from(occurrenceCleanJobs)
        .where(eq(occurrenceCleanJobs.jobId, jobId)).limit(1);
      if (!binding || binding.userId !== user.id || binding.rawAssetId !== rawAssetId) {
        throw new InputAssetRegistrationError("Clean job ownership could not be established");
      }
      return c.json({ job_id: jobId, status: "running", rawAssetId, raw_asset_id: rawAssetId } as Record<string, unknown>);
    }

    if (jobId) {
      const result = await pollPlumberJob(jobId, 600000, client);
      const cleanResult = unwrapJobResult(result);
      if (cleanResult.error) return c.json(result, 502);
      try {
        const finalized = await registerCleanedOccurrenceAsset(user, rawAssetId, cleanResult);
        return c.json({ ...result, ...finalized, result: finalized, rawAssetId, raw_asset_id: rawAssetId });
      } catch (error) {
        await removeNewFile(typeof cleanResult.cleaned_file_id === "string" ? cleanResult.cleaned_file_id : null);
        throw error;
      }
    }

    const cleanResult = unwrapJobResult(initial);
    if (!cleanResult.cleaned_file_id) return c.json({ error: "Cleaner returned no output" }, 502);
    try {
      const finalized = await registerCleanedOccurrenceAsset(user, rawAssetId, cleanResult);
      return c.json({ ...initial, ...finalized, result: finalized, rawAssetId, raw_asset_id: rawAssetId });
    } catch (error) {
      await removeNewFile(typeof cleanResult.cleaned_file_id === "string" ? cleanResult.cleaned_file_id : null);
      throw error;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean failed";
    if (err instanceof InputAssetRegistrationError) return c.json({ error: message }, 503);
    return c.json({ error: message }, 502);
  }
});
const PLUMBER_MAGIC = Buffer.from("SDMENC1\n", "utf-8");

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
    if (encrypted.length < PLUMBER_MAGIC.length + 12 + 16 ||
        !PLUMBER_MAGIC.equals(encrypted.subarray(0, PLUMBER_MAGIC.length))) {
      return null;
    }
    const decrypted = decrypt(encrypted);
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
    }
  }

  if (content === null || content.trim().length === 0) return null;

  const lines = content.trim().split("\n");
  if (lines.length < 2) return { records: [], sourceCounts: {}, ccLog: [], totalRecords: 0 };

  const stripQuotes = (s: string) => s.replace(/^"|"$/g, "").trim();
  const headers = lines[0].split(",").map(h => stripQuotes(h));
  const records: Record<string, unknown>[] = [];
  const sourceCounts: Record<string, number> = {};

  const ccTestNames: Record<string, string> = {
    cc_test_sea: "Sea coordinates",
    cc_test_capitals: "Capital cities",
    cc_test_centroids: "Country centroids",
    cc_test_institutions: "Biodiversity institutions",
    cc_test_urban: "Urban areas",
    cc_test_zero: "Zero coordinates",
  };
  const ccTests = Object.entries(ccTestNames).map(([col, label]) => ({
    colIdx: headers.indexOf(col),
    label,
  })).filter(t => t.colIdx !== -1);
  const ccCounts: Record<string, number> = {};
  for (const { label } of ccTests) ccCounts[label] = 0;
  const maxRecords = Math.min(lines.length - 1, 100);

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]).map(v => stripQuotes(v));

    for (const { colIdx, label } of ccTests) {
      const v = values[colIdx] || "";
      if (v === "true" || v === "TRUE" || v === "1") ccCounts[label]++;
    }

    if (i - 1 < maxRecords) {
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
  }

  const ccLog: string[] = [];
  const totalRecords = lines.length - 1;
  ccLog.push("CoordinateCleaner Results:");
  ccLog.push(`  Total records: ${totalRecords.toLocaleString()}`);

  let totalFlagged = 0;
  for (const { label } of ccTests) {
    const count = ccCounts[label];
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
  // Cleaning state and derivative pointers are immutable server-owned facts.
  // This compatibility endpoint intentionally accepts no client update shape.
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (hasPathInput(body) || typeof body.cleaned === "boolean" || Object.keys(body).length > 0) {
      return c.json({ error: "Upload cleaning metadata is server-owned; use the cleaning endpoint with rawAssetId." }, 400);
    }
    return c.json({ error: "Upload metadata updates are not supported" }, 400);
  } catch {
    return c.json({ error: "Upload metadata updates are not supported" }, 400);
  }
});
dataRoutes.delete("/uploads/:fileId", async (c) => {
  try {
    const assetId = decodeURIComponent(c.req.param("fileId"));
    const user = c.get("user");
    if (!isAssetId(assetId)) return c.json({ error: "Path-based upload deletion is no longer supported; use rawAssetId." }, 400);
    const resolved = await resolveRawOccurrenceAsset(user, assetId);
    if (!resolved.ok) return c.json({ error: resolved.reason === "unavailable" ? "Asset service unavailable" : "Upload not found" }, resolved.reason === "unavailable" ? 503 : 404);

    const childRows = await db.select().from(inputAssets)
      .where(eq(inputAssets.parentAssetId, assetId));
    const readyChildren = childRows.filter((asset) => asset.state === "ready");
    const resolvedChildren = await Promise.all(readyChildren.map(async (asset) => {
      const child = await resolveInputAsset({
        assetId: asset.id,
        principal: { id: user.id, role: user.role },
        action: "read",
        expectedKind: "cleaned_occurrence",
        expectedParentAssetId: assetId,
      });
      if (!child.ok) throw new InputAssetRegistrationError("Derived asset deletion is unavailable");
      return child;
    }));
    const assetIds = [assetId, ...readyChildren.map((asset) => asset.id)];
    const paths = [resolved.absolutePath, ...resolvedChildren.map((child) => child.absolutePath)];
    // Only raw uploads are charged to storageUsedBytes today. Cleaned
    // derivatives are removed with their parent but were never quota-charged,
    // so subtracting their content sizes would undercount unrelated storage.
    const accountedBytes = Number(resolved.asset.contentSize || 0);
    const accountingUserId = resolved.asset.creatorUserId;

    await db.transaction(async (tx) => {
      const now = new Date();
      const quarantined = await tx.update(inputAssets).set({
        state: "quarantined",
        quarantinedAt: now,
        deletedAt: null,
        updatedAt: now,
      }).where(and(inArray(inputAssets.id, assetIds), eq(inputAssets.state, "ready"))).returning({ id: inputAssets.id });
      if (quarantined.length !== assetIds.length) throw new InputAssetRegistrationError("Asset deletion state changed concurrently");
    });

    try {
      for (const path of paths) await removeOwnedFile(path);
    } catch (error) {
      throw error instanceof InputAssetRegistrationError
        ? error
        : new InputAssetRegistrationError("Asset file deletion failed; assets remain quarantined");
    }

    await db.transaction(async (tx) => {
      const now = new Date();
      const deleted = await tx.update(inputAssets).set({
        state: "deleted",
        deletedAt: now,
        quarantinedAt: null,
        updatedAt: now,
      }).where(and(inArray(inputAssets.id, assetIds), eq(inputAssets.state, "quarantined"))).returning({ id: inputAssets.id });
      if (deleted.length !== assetIds.length) throw new InputAssetRegistrationError("Asset deletion finalization failed");
      await tx.delete(uploads).where(and(eq(uploads.userId, accountingUserId), eq(uploads.filePath, resolved.absolutePath)));
      await tx.update(users).set({
        storageUsedBytes: sql`GREATEST(0, ${users.storageUsedBytes} - ${accountedBytes})`,
      }).where(eq(users.id, accountingUserId));
    });
    return c.json({ ok: true, message: "Upload deleted", rawAssetId: assetId, raw_asset_id: assetId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete upload";
    return c.json({ error: message }, err instanceof InputAssetRegistrationError ? 503 : 500);
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
    const user = c.get("user");
    const [binding] = await db.select().from(occurrenceCleanJobs)
      .where(eq(occurrenceCleanJobs.jobId, jobId)).limit(1);
    if (binding && binding.userId !== user.id) return c.json({ error: "Job not found" }, 404);

    const data = await plumberClient.withUser(user.id).withRole(user.role).getJobStatus(jobId);
    if (!binding) {
      const unboundResult = unwrapJobResult(data);
      if (typeof unboundResult.cleaned_file_id === "string") {
        return c.json({ error: "Clean job ownership is unavailable" }, 409);
      }
      return c.json(data);
    }

    if (data.status !== "completed") {
      return c.json({ ...data, rawAssetId: binding.rawAssetId, raw_asset_id: binding.rawAssetId });
    }
    const cleanResult = unwrapJobResult(data);
    if (cleanResult.error) return c.json({ status: data.status, error: cleanResult.error }, 502);
    try {
      const finalized = await registerCleanedOccurrenceAsset(user, binding.rawAssetId, cleanResult);
      await db.update(occurrenceCleanJobs).set({
        cleanedAssetId: finalized.cleanedAssetId as string,
        updatedAt: new Date(),
      }).where(and(
        eq(occurrenceCleanJobs.jobId, jobId),
        eq(occurrenceCleanJobs.userId, user.id),
      ));
      return c.json({ status: data.status, ...finalized, result: finalized, rawAssetId: binding.rawAssetId, raw_asset_id: binding.rawAssetId });
    } catch (error) {
      await removeNewFile(typeof cleanResult.cleaned_file_id === "string" ? cleanResult.cleaned_file_id : null);
      return c.json({ error: error instanceof Error ? error.message : "Cleaned asset registration failed" }, 503);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get job status";
    return c.json({ error: message }, 502);
  }
});
// Generate synthetic multi-species occurrence data for stress testing
dataRoutes.post("/occurrences/synthetic", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    if (hasPathInput(body)) return c.json(pathInputError(), 400);
    const user = c.get("user");
    const data = await plumberClient.withUser(user.id).withRole(user.role).generateSynthetic(body);
    const producerPath = typeof data.file_path === "string" ? data.file_path : null;
    if (!producerPath || !producerPath.startsWith("/")) {
      return c.json({ error: "Synthetic producer returned no registered output" }, 502);
    }
    let rawAsset: InputAssetRow;
    try {
      rawAsset = await registerRawOccurrenceAsset(user, producerPath, {
        filename: typeof data.file_name === "string" ? data.file_name : "synthetic_occurrences.csv",
        fileSize: 0,
        format: "csv",
        nRows: typeof data.n_records === "number" ? data.n_records : 0,
      });
    } catch (error) {
      await removeNewFile(producerPath);
      throw error;
    }
    const publicData = { ...data };
    for (const key of PATH_INPUT_KEYS) delete publicData[key];
    return c.json({
      ...publicData,
      rawAssetId: rawAsset.id,
      raw_asset_id: rawAsset.id,
      file_id: rawAsset.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Synthetic data generation failed";
    if (err instanceof InputAssetRegistrationError) return c.json({ error: message }, 503);
    return c.json({ error: message }, 502);
  }
});
