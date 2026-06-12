import { Hono } from "hono";
import { statSync, existsSync, promises as fs } from "fs";
import { join, dirname, extname, resolve } from "path";
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
import { encrypt, decrypt } from "../services/encryption.js";
import { setUploadDir, saveUploadEncrypted, decryptToUploads, resolveFilePath, pollPlumberJob } from "../services/upload-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");
setUploadDir(UPLOAD_DIR);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const gbifAlaRoutes = new Hono<AppEnv>();

gbifAlaRoutes.use("*", authMiddleware);

gbifAlaRoutes.post("/occurrences/gbif/search", gbifRateLimit, async (c) => {
  try {
    const body = await c.req.json();

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
            } catch { }
          }
          if (settings.gbifEmail) body.gbif_email = settings.gbifEmail;
        }
      } catch { }
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

gbifAlaRoutes.post("/occurrences/gbif/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const filePath = body.file_path as string | undefined;

    if (filePath) {
      const pipelineRunId = randomUUID();
      const user = c.get("user");
      const nRows = (body.n_rows as number) || 0;
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
      const filename = filePath.split("/").pop() || "gbif_records.csv";
      const fileSize = existsSync(filePath) ? statSync(filePath).size : 0;
      await db.insert(uploads).values({
        userId: user.id,
        filename: `GBIF-${filename}`,
        filePath,
        fileSize,
        format: "csv",
        nRows,
        isCleaned: false,
      }).onConflictDoNothing();
      return c.json({
        file_path: filePath,
        file_id: filePath,
        n_rows: nRows,
        filename,
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

    const filename = resultFilePath.split("/").pop() || "gbif_records.csv";
    const fileSize = existsSync(resultFilePath) ? statSync(resultFilePath).size : 0;
    await db.insert(uploads).values({
      userId: user.id,
      filename: `GBIF-${filename}`,
      filePath: resultFilePath,
      fileSize,
      format: "csv",
      nRows: nRecords,
      species: taxon,
      isCleaned: false,
    }).onConflictDoNothing();

    return c.json({
      file_path: resultFilePath,
      file_id: resultFilePath,
      n_rows: nRecords,
      filename,
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save GBIF records";
    return c.json({ error: message }, 502);
  }
});

gbifAlaRoutes.post("/occurrences/ala/search", defaultRateLimit, async (c) => {
  try {
    const body = await c.req.json();

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
          } catch { }
        }
      } catch { }
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

gbifAlaRoutes.post("/occurrences/ala/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const filePath = body.file_path as string | undefined;

    if (filePath) {
      const pipelineRunId = randomUUID();
      const user = c.get("user");
      const nRows = (body.n_rows as number) || 0;
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
      const filename = filePath.split("/").pop() || "ala_records.csv";
      const fileSize = existsSync(filePath) ? statSync(filePath).size : 0;
      await db.insert(uploads).values({
        userId: user.id,
        filename: `ALA-${filename}`,
        filePath,
        fileSize,
        format: "csv",
        nRows,
        isCleaned: false,
      }).onConflictDoNothing();
      return c.json({
        file_path: filePath,
        file_id: filePath,
        n_rows: nRows,
        filename,
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

    const filename = resultFilePath.split("/").pop() || "ala_records.csv";
    const fileSize = existsSync(resultFilePath) ? statSync(resultFilePath).size : 0;
    await db.insert(uploads).values({
      userId: user.id,
      filename: `ALA-${filename}`,
      filePath: resultFilePath,
      fileSize,
      format: "csv",
      nRows: nRecords,
      species: taxon,
      isCleaned: false,
    }).onConflictDoNothing();

    return c.json({
      file_path: resultFilePath,
      file_id: resultFilePath,
      n_rows: nRecords,
      filename,
      pipelineRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save ALA records";
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
      return c.json({ error: `File too large. Maximum ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const user = c.get("user");

    const { encPath, pipelineRunId } = saveUploadEncrypted(buffer, file.name);

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
