import { Hono } from "hono";
import { mkdirSync, existsSync, accessSync, constants } from "fs";
import { writeFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { db } from "../db/index.js";
import { species, occurrences } from "../db/schema.js";
import { and, count, eq, inArray } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import type { AppEnv } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");

function saveUpload(buffer: Buffer, originalName: string): { destPath: string; pipelineRunId: string } {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  try {
    accessSync(UPLOAD_DIR, constants.W_OK);
  } catch {
    throw new Error(`Upload directory is not writable: ${UPLOAD_DIR}. Run: sudo chown -R $USER:$USER data/uploads`);
  }

  const pipelineRunId = randomUUID();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = join(UPLOAD_DIR, safeName);
  return { destPath, pipelineRunId };
}

async function writeUploadFile(destPath: string, buffer: Buffer): Promise<void> {
  await writeFile(destPath, buffer);
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
    const { destPath, pipelineRunId } = saveUpload(buffer, file.name);
    await writeUploadFile(destPath, buffer);
    const user = c.get("user");

    let result: Record<string, unknown>;
    try {
      result = await plumberClient.withUser(user.id).uploadOccurrence(destPath, file.name);
    } catch (plumberErr) {
      const pm = plumberErr instanceof Error ? plumberErr.message : "Unknown error";
      if (pm.includes("fetch failed") || pm.includes("ECONNREFUSED") || pm.includes("connect") || pm.includes("timeout")) {
        return c.json({
          error: "Upload saved to disk but Plumber backend is not responding. The occurrence file will be processed when Plumber is available.",
          filePath: destPath,
          pipelineRunId,
          plumberStatus: pm,
        }, 202);
      }
      throw plumberErr;
    }
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
    return c.json({ ...result, pipelineRunId });
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

    const result = await plumberClient.withUser(user.id).cleanOccurrences(body);

    if (result && typeof result === "object" && "error" in result) {
      return c.json(result, 502);
    }

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/gbif/search", gbifRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const result = await plumberClient.searchGbif(body);
    return c.json(result);
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

    const searchResult = await plumberClient.searchGbif({ taxon, country, max_records: maxRecords });
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
    const { destPath, pipelineRunId } = saveUpload(buffer, file.name);
    const user = c.get("user");

    const result = await plumberClient.withUser(user.id).parseDwca({ file_id: destPath });
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
    return c.json({ ...result, file_id: destPath, file_path: destPath, pipelineRunId });
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
