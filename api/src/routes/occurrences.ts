import { Hono } from "hono";
import { mkdirSync, existsSync, accessSync, constants, promises as fs } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { db } from "../db/index.js";
import { species, occurrences, users } from "../db/schema.js";
import { and, count, eq, inArray } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import type { AppEnv } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");

async function saveUpload(buffer: Buffer, originalName: string): Promise<string> {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  try {
    accessSync(UPLOAD_DIR, constants.W_OK);
  } catch {
    throw new Error(
      `Uploads directory not writable: ${UPLOAD_DIR}. ` +
      "Run: sudo chown -R $USER:$USER data/uploads"
    );
  }
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const destPath = join(UPLOAD_DIR, `${ts}_${safeName}`);
  await fs.writeFile(destPath, buffer);
  return destPath;
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

    // Track storage usage on success
    await db
      .update(users)
      .set({ storageUsedBytes: (quota?.used ?? 0) + buffer.length })
      .where(eq(users.id, user.id));

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return c.json({ error: message }, 502);
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
    const async = body.async === true;
    const user = c.get("user");
    const projectId = await ensureDefaultProject(user);

    if (async) {
      const jobId = await enqueueSdmJob(
        {
          type: "clean",
          payload: body,
        },
        user.id
      );
      return c.json({ jobId, status: "queued" });
    }

    const result = await plumberClient.cleanOccurrences(body);

    if (result && typeof result === "object" && "error" in result) {
      return c.json(result, 502);
    }

    if (result && typeof result === "object" && "cleaned_file_id" in result) {
      const cleanedFileId = result.cleaned_file_id as string;
      const speciesName = (body.species as string) || "Untitled species";

      let [sp] = await db
        .select()
        .from(species)
        .where(and(eq(species.name, speciesName), eq(species.projectId, projectId)))
        .limit(1);

      if (!sp) {
        [sp] = await db
          .insert(species)
          .values({ name: speciesName, projectId, occurrenceCount: 0, userId: user?.id })
          .returning();
      }

      // Use cleaned_records from Plumber instead of re-parsing CSV
      const cleanedRecords = (result as any).cleaned_records as Array<Record<string, unknown>> | undefined;
      const validRecords = (cleanedRecords || []).filter(
        (r) => typeof r.longitude === "number" && typeof r.latitude === "number" && isFinite(r.longitude) && isFinite(r.latitude)
      );

      if (validRecords.length > 0) {
        const recordsToInsert = validRecords.map((row) => ({
          speciesId: sp.id,
          projectId,
          userId: user?.id,
          filePath: cleanedFileId,
          longitude: Number(row.longitude),
          latitude: Number(row.latitude),
          source: (row.source as string) || null,
          flagged: Boolean(row.flagged || row.cc_flag),
          flagReason: (row.flag_reason as string) || null,
          cleaned: true,
          raw: row,
        }));

        await db.insert(occurrences).values(recordsToInsert);
        await db
          .update(species)
          .set({ occurrenceCount: (sp.occurrenceCount || 0) + recordsToInsert.length })
          .where(eq(species.id, sp.id));
      }
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

    return c.json({
      file_path: filePath,
      file_id: filePath,
      n_rows: nRecords,
      filename: filePath.split("/").pop() || "gbif_records.csv",
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
    const destPath = saveUpload(buffer, file.name);
    const user = c.get("user");

    const result = await plumberClient.withUser(user.id).parseDwca({ file_id: destPath });
    return c.json({ ...result, file_id: destPath, file_path: destPath });
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

    const recs = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.speciesId, id))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(occurrences)
      .where(eq(occurrences.speciesId, id));

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
