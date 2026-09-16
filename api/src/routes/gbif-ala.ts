import { Hono } from "hono";
import { statSync, existsSync, promises as fs } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { plumberClient } from "../services/plumber.js";
import { db } from "../db/index.js";
import { userSettings, uploads } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import type { AppEnv } from "../middleware/auth.js";
import { setUploadDir, saveUploadEncrypted, resolveFilePath, pollPlumberJob } from "../services/upload-utils.js";
import { InputAssetRegistrationError, registerInputAssetFromServerPath, type InputAssetRow } from "../services/input-assets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");
setUploadDir(UPLOAD_DIR);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

async function removeProducerOutput(path: string | null | undefined): Promise<void> {
  if (!path || typeof path !== "string") return;
  const candidate = resolve(path);
  const root = resolve(UPLOAD_DIR);
  if (candidate === root || !candidate.startsWith(root + "/")) return;
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    await fs.unlink(candidate);
  } catch { /* only a newly-created in-root producer output is passed */ }
}

async function registerProducerOccurrenceAsset(
  user: { id: string },
  producerPath: string,
  metadata: { filename: string; nRows: number; species?: string | null; format?: string },
): Promise<InputAssetRow> {
  const asset = await registerInputAssetFromServerPath({
    creatorUserId: user.id,
    scope: "private",
    kind: "raw_occurrence",
    absolutePath: producerPath,
  });
  try {
    await db.insert(uploads).values({
      userId: user.id,
      filename: metadata.filename,
      filePath: producerPath,
      fileSize: existsSync(producerPath) ? statSync(producerPath).size : 0,
      format: metadata.format || "csv",
      nRows: metadata.nRows,
      species: metadata.species || null,
      isCleaned: false,
    }).onConflictDoNothing();
  } catch {
    // Compatibility metadata is non-authoritative; canonical registration is not.
  }
  return asset;
}

export const gbifAlaRoutes = new Hono<AppEnv>();

gbifAlaRoutes.use("*", authMiddleware);

gbifAlaRoutes.post("/occurrences/gbif/search", gbifRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    if (body.use_auth && !body.gbif_user && !body.gbif_pwd && !body.gbif_email) {
      try {
        // Credentials are loaded for this already-authenticated principal.
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
              if (isEncryptionKeyConfigured()) {
                try {
                  body.gbif_pwd = decryptString(settings.gbifPassword);
                } catch (err) {
                  console.warn("[gbif-ala] Password decryption failed, using plaintext:", err);
                  body.gbif_pwd = settings.gbifPassword;
                }
              } else {
                body.gbif_pwd = settings.gbifPassword;
              }
            } catch (err) {
              console.warn("[gbif-ala] Failed to load GBIF credentials:", err);
            }
          }
          if (settings.gbifEmail) body.gbif_email = settings.gbifEmail;
        }
      } catch (err) {
        console.warn("[gbif-ala] Failed to query user settings:", err);
      }
    }

    const initial = await plumberClient.withUser(user.id).withRole(user.role).searchGbif(body);

    const jobId = initial?.job_id as string | undefined;
    if (jobId) return c.json({ job_id: jobId, status: "running" });

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GBIF search failed";
    return c.json({ error: message }, 502);
  }
});

gbifAlaRoutes.post("/occurrences/gbif/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const user = c.get("user");
    // Search results contain a compatibility path, but callers must not turn
    // that path into an upload claim. Re-run the server-side producer instead.
    if (typeof body.file_path === "string" || typeof body.file_id === "string") {
      return c.json({ error: "Path-based occurrence staging is not supported; save by taxon/search parameters." }, 400);
    }

    const taxon = body.taxon as string;
    const country = body.country as string | undefined;
    const maxRecords = (body.max_records as number) || 100;
    if (!taxon) return c.json({ error: "taxon is required" }, 400);

    const client = plumberClient.withUser(user.id).withRole(user.role);
    const initial = await client.searchGbif({ taxon, country, max_records: maxRecords });
    const jobId = initial?.job_id as string | undefined;
    let searchResult: Record<string, unknown>;
    if (jobId) {
      const polled = await pollPlumberJob(jobId, 120_000, client);
      searchResult = (polled.status === "completed" && polled.result && typeof polled.result === "object")
        ? polled.result as Record<string, unknown>
        : polled;
    } else {
      searchResult = initial;
    }
    if (searchResult.error || searchResult.status === "failed" || searchResult.status === "error") {
      return c.json({ error: String(searchResult.error || "GBIF search failed") }, 502);
    }

    const producerPath = typeof searchResult.file_path === "string" ? searchResult.file_path : null;
    const nRecords = typeof searchResult.n_records === "number" ? searchResult.n_records : 0;
    if (!producerPath || nRecords === 0) return c.json({ error: "No GBIF records found" }, 404);

    let rawAsset: InputAssetRow;
    try {
      rawAsset = await registerProducerOccurrenceAsset(user, producerPath, {
        filename: "GBIF-" + (producerPath.split("/").pop() || "records.csv"),
        nRows: nRecords,
        species: taxon,
      });
    } catch (error) {
      await removeProducerOutput(producerPath);
      throw error;
    }

    const pipelineRunId = randomUUID();
    const { ipAddress, userAgent } = extractClientInfo(c);
    void logAction({
      userId: user.id,
      action: "occurrence_upload",
      entity: "occurrence",
      entityId: pipelineRunId,
      ipAddress,
      userAgent,
      details: { source: "gbif", taxon, country, n_rows: nRecords, rawAssetId: rawAsset.id, pipelineRunId },
    });
    const publicResult = { ...searchResult };
    delete publicResult.file_path;
    delete publicResult.file_id;
    return c.json({
      ...publicResult,
      rawAssetId: rawAsset.id,
      raw_asset_id: rawAsset.id,
      n_rows: nRecords,
      filename: producerPath.split("/").pop() || "gbif_records.csv",
      file_id: rawAsset.id,
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save GBIF records";
    if (err instanceof InputAssetRegistrationError) return c.json({ error: message }, 503);
    return c.json({ error: message }, 502);
  }
});

gbifAlaRoutes.post("/occurrences/ala/search", defaultRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    if (!body.api_key) {
      try {
        // Credentials are loaded for this already-authenticated principal.
        const [settings] = await db
          .select({ alaApiKey: userSettings.alaApiKey })
          .from(userSettings)
          .where(eq(userSettings.userId, user.id))
          .limit(1);
        if (settings?.alaApiKey) {
          try {
            const { decryptString, isEncryptionKeyConfigured } = await import("../services/encryption.js");
            if (isEncryptionKeyConfigured()) body.api_key = decryptString(settings.alaApiKey);
          } catch (err) {
            console.warn("[gbif-ala] ALA API key decryption failed:", err);
          }
        }
      } catch (err) {
        console.warn("[gbif-ala] Failed to query ALA user settings:", err);
      }
    }

    const initial = await plumberClient.withUser(user.id).withRole(user.role).searchAla(body);

    const jobId = initial?.job_id as string | undefined;
    if (jobId) return c.json({ job_id: jobId, status: "running" });

    return c.json(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ALA search failed";
    return c.json({ error: message }, 502);
  }
});

gbifAlaRoutes.post("/occurrences/ala/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const user = c.get("user");
    if (typeof body.file_path === "string" || typeof body.file_id === "string") {
      return c.json({ error: "Path-based occurrence staging is not supported; save by taxon/search parameters." }, 400);
    }

    const taxon = body.taxon as string;
    const country = body.country as string | undefined;
    const maxRecords = (body.max_records as number) || 1000;
    if (!taxon) return c.json({ error: "taxon is required" }, 400);

    const client = plumberClient.withUser(user.id).withRole(user.role);
    const initial = await client.searchAla({ taxon, country, max_records: maxRecords });
    const jobId = initial?.job_id as string | undefined;
    let searchResult: Record<string, unknown>;
    if (jobId) {
      const polled = await pollPlumberJob(jobId, 120_000, client);
      searchResult = (polled.status === "completed" && polled.result && typeof polled.result === "object")
        ? polled.result as Record<string, unknown>
        : polled;
    } else {
      searchResult = initial;
    }
    if (searchResult.error || searchResult.status === "failed" || searchResult.status === "error") {
      return c.json({ error: String(searchResult.error || "ALA search failed") }, 502);
    }

    const producerPath = typeof searchResult.file_path === "string" ? searchResult.file_path : null;
    const nRecords = typeof searchResult.n_records === "number" ? searchResult.n_records : 0;
    if (!producerPath || nRecords === 0) return c.json({ error: "No ALA records found" }, 404);

    let rawAsset: InputAssetRow;
    try {
      rawAsset = await registerProducerOccurrenceAsset(user, producerPath, {
        filename: "ALA-" + (producerPath.split("/").pop() || "records.csv"),
        nRows: nRecords,
        species: taxon,
      });
    } catch (error) {
      await removeProducerOutput(producerPath);
      throw error;
    }

    const pipelineRunId = randomUUID();
    const { ipAddress, userAgent } = extractClientInfo(c);
    void logAction({
      userId: user.id,
      action: "occurrence_upload",
      entity: "occurrence",
      entityId: pipelineRunId,
      ipAddress,
      userAgent,
      details: { source: "ala", taxon, country, n_rows: nRecords, rawAssetId: rawAsset.id, pipelineRunId },
    });
    const publicResult = { ...searchResult };
    delete publicResult.file_path;
    delete publicResult.file_id;
    return c.json({
      ...publicResult,
      rawAssetId: rawAsset.id,
      raw_asset_id: rawAsset.id,
      n_rows: nRecords,
      filename: producerPath.split("/").pop() || "ala_records.csv",
      file_id: rawAsset.id,
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save ALA records";
    if (err instanceof InputAssetRegistrationError) return c.json({ error: message }, 503);
    return c.json({ error: message }, 502);
  }
});

gbifAlaRoutes.post("/occurrences/dwca", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "File too large. Maximum " + MAX_UPLOAD_BYTES / 1024 / 1024 + "MB." }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const user = c.get("user");
    const saved = saveUploadEncrypted(buffer, file.name);
    const encPath = typeof saved === "string" ? saved : saved.encPath;
    const pipelineRunId = typeof saved === "string" ? randomUUID() : saved.pipelineRunId;
    const resolved = resolveFilePath(encPath);
    if (!resolved.path) {
      await Promise.all([removeProducerOutput(encPath), removeProducerOutput(resolved.path)]);
      return c.json({ error: "Uploaded archive staging is unavailable" }, 503);
    }

    const client = plumberClient.withUser(user.id).withRole(user.role);
    const initial = await client.parseDwca({ file_id: resolved.path });
    const jobId = initial?.job_id as string | undefined;
    const result = jobId ? await pollPlumberJob(jobId, undefined, client) : initial;
    if (result.error || result.status === "failed" || result.status === "error") {
      await Promise.all([removeProducerOutput(encPath), removeProducerOutput(resolved.path)]);
      return c.json({ error: String(result.error || "DwCA parse failed") }, 502);
    }

    let rawAsset: InputAssetRow;
    try {
      // The parser consumes the decrypted server-owned staging file. Keep
      // that same plaintext output as the canonical locator so later cleaning
      // and reads do not treat ciphertext as CSV/archive data.
      rawAsset = await registerProducerOccurrenceAsset(user, resolved.path, {
        filename: file.name,
        nRows: typeof result.n_records === "number" ? result.n_records : 0,
        format: "dwca",
      });
    } catch (error) {
      await Promise.all([removeProducerOutput(encPath), removeProducerOutput(resolved.path)]);
      throw error;
    }

    const { ipAddress, userAgent } = extractClientInfo(c);
    void logAction({
      userId: user.id,
      action: "occurrence_upload",
      entity: "occurrence",
      entityId: pipelineRunId,
      ipAddress,
      userAgent,
      details: { filename: file.name, fileSize: file.size, source: "dwca", rawAssetId: rawAsset.id, pipelineRunId },
    });
    const publicResult = { ...result };
    delete publicResult.file_id;
    delete publicResult.file_path;
    return c.json({ ...publicResult, rawAssetId: rawAsset.id, raw_asset_id: rawAsset.id, file_id: rawAsset.id, pipelineRunId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DwCA parse failed";
    if (err instanceof InputAssetRegistrationError) return c.json({ error: message }, 503);
    return c.json({ error: message }, 502);
  }
});
