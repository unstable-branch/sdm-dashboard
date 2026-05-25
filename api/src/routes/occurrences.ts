import { Hono } from "hono";
import { writeFileSync, mkdirSync, existsSync, accessSync, constants } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { plumberClient } from "../services/plumber.js";
import { enqueueSdmJob } from "../services/queue.js";
import { db } from "../db/index.js";
import { species, occurrences } from "../db/schema.js";
import { and, count, eq, inArray } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureDefaultProject, getUserProjectIds } from "../services/access.js";
import {
  createOccurrenceDataset,
  getOccurrenceDatasetForUser,
  listOccurrenceDatasets,
  type OccurrenceDatasetAggregate,
  type OccurrenceDatasetKind,
  type OccurrenceDatasetStatus,
} from "../services/occurrence-datasets.js";
import type { AppEnv } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");

function saveUpload(buffer: Buffer, originalName: string): string {
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
  writeFileSync(destPath, buffer);
  return destPath;
}

export const dataRoutes = new Hono<AppEnv>();

dataRoutes.use("*", defaultRateLimit);
dataRoutes.use("*", authMiddleware);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB

type AuthUser = AppEnv["Variables"]["user"];

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function getJsonObject(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  return getRecord(value);
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function extractFileId(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

async function resolveProjectIdForUser(user: AuthUser, explicitProjectId?: string): Promise<{ projectId?: string; forbidden?: boolean }> {
  if (!explicitProjectId) {
    return { projectId: await ensureDefaultProject(user) };
  }

  if (user.role === "admin") {
    return { projectId: explicitProjectId };
  }

  const projectIds = await getUserProjectIds(user);
  if (!projectIds?.includes(explicitProjectId)) {
    return { forbidden: true };
  }

  return { projectId: explicitProjectId };
}

async function createDatasetFromRecord(input: {
  record: Record<string, unknown>;
  fileIdKeys: string[];
  kind: OccurrenceDatasetKind;
  projectId: string;
  userId: string;
  speciesId?: string | null;
  parentDatasetId?: string | null;
  fallbackFileName?: string | null;
}): Promise<OccurrenceDatasetAggregate | null> {
  const fileId = extractFileId(input.record, input.fileIdKeys);
  if (!fileId) return null;

  return createOccurrenceDataset({
    projectId: input.projectId,
    speciesId: input.speciesId ?? null,
    parentDatasetId: input.parentDatasetId ?? null,
    kind: input.kind,
    status: "ready",
    fileId,
    fileName: getString(input.record.filename) ?? input.fallbackFileName ?? basename(fileId),
    recordCount: getNumber(input.record.record_count) ?? getNumber(input.record.n_rows) ?? getNumber(input.record.n_records),
    validCount: getNumber(input.record.valid_count) ?? getNumber(input.record.valid_records),
    summary: getJsonObject(input.record.summary),
    metadata: { source: input.kind },
    createdBy: input.userId,
  });
}

dataRoutes.get("/occurrence-datasets", async (c) => {
  try {
    const user = c.get("user");
    const scoped = await resolveProjectIdForUser(user, c.req.query("project_id"));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }

    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 500);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
    const datasets = await listOccurrenceDatasets({
      projectId: scoped.projectId,
      speciesId: c.req.query("species_id"),
      parentDatasetId: c.req.query("parent_dataset_id"),
      kind: c.req.query("kind") as OccurrenceDatasetKind | undefined,
      status: c.req.query("status") as OccurrenceDatasetStatus | undefined,
      limit,
      offset,
    });

    return c.json({ occurrence_datasets: datasets, limit, offset, hasMore: datasets.length >= limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list occurrence datasets";
    const status = message.startsWith("Invalid occurrence dataset") ? 400 : 500;
    return c.json({ error: message }, status);
  }
});

dataRoutes.post("/occurrence-datasets/register", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const fileId = getString(body.file_id) ?? getString(body.file_path);
    if (!fileId) {
      return c.json({ error: "file_id or file_path is required" }, 400);
    }

    const user = c.get("user");
    const scoped = await resolveProjectIdForUser(user, getString(body.project_id));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }

    const dataset = await createOccurrenceDataset({
      projectId: scoped.projectId,
      speciesId: getString(body.species_id) ?? null,
      parentDatasetId: getString(body.parent_dataset_id) ?? null,
      kind: (getString(body.kind) ?? "registered") as OccurrenceDatasetKind,
      status: (getString(body.status) ?? "ready") as OccurrenceDatasetStatus,
      fileId,
      fileName: getString(body.file_name) ?? null,
      recordCount: getNumber(body.record_count),
      validCount: getNumber(body.valid_count),
      summary: getJsonObject(body.summary),
      metadata: getJsonObject(body.metadata),
      createdBy: user.id,
    });

    return c.json(dataset, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register occurrence dataset";
    const status = message.startsWith("Invalid occurrence dataset") ? 400 : 500;
    return c.json({ error: message }, status);
  }
});

dataRoutes.get("/occurrence-datasets/:id", async (c) => {
  try {
    const user = c.get("user");
    const scoped = await resolveProjectIdForUser(user, c.req.query("project_id"));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }

    const dataset = await getOccurrenceDatasetForUser({
      datasetId: c.req.param("id"),
      userId: user.id,
      userRole: user.role,
      projectId: scoped.projectId,
    });

    if (!dataset) {
      return c.json({ error: "Occurrence dataset not found" }, 404);
    }

    return c.json(dataset);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch occurrence dataset";
    return c.json({ error: message }, 500);
  }
});

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
    const destPath = saveUpload(buffer, file.name);
    const user = c.get("user");
    const scoped = await resolveProjectIdForUser(user, getString(body.project_id));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }

    const result = await plumberClient.withUser(user.id).uploadOccurrence(destPath, file.name);
    const resultRecord = getRecord(result);
    if (!resultRecord) {
      return c.json(result);
    }

    const dataset = await createDatasetFromRecord({
      record: resultRecord,
      fileIdKeys: ["file_id", "file_path"],
      kind: "upload",
      projectId: scoped.projectId,
      userId: user.id,
      speciesId: getString(body.species_id) ?? null,
      parentDatasetId: getString(body.parent_dataset_id) ?? null,
      fallbackFileName: file.name,
    });

    return c.json(dataset ? { ...resultRecord, dataset_id: dataset.id } : resultRecord);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/clean", async (c) => {
  try {
    const body = await c.req.json();
    const async = body.async === true;
    const user = c.get("user");
    const scoped = await resolveProjectIdForUser(user, getString(body.project_id));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }
    const projectId = scoped.projectId;

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

    const inputDatasetId = getString(body.dataset_id);
    let inputDataset: OccurrenceDatasetAggregate | null = null;
    if (inputDatasetId) {
      inputDataset = await getOccurrenceDatasetForUser({
        datasetId: inputDatasetId,
        userId: user.id,
        userRole: user.role,
        projectId,
      });
      if (!inputDataset) {
        return c.json({ error: "Occurrence dataset not found" }, 404);
      }
    }

    const result = await plumberClient.cleanOccurrences(body);
    const resultRecord = getRecord(result);

    if (resultRecord && "cleaned_file_id" in resultRecord) {
      const cleanedFileId = resultRecord.cleaned_file_id as string;
      const speciesName = (body.species as string) || "Untitled species";

      let [sp] = await db
        .select()
        .from(species)
        .where(and(eq(species.name, speciesName), eq(species.projectId, projectId)))
        .limit(1);

      if (!sp) {
        [sp] = await db
          .insert(species)
          .values({ name: speciesName, projectId, occurrenceCount: 0 })
          .returning();
      }

      // Use cleaned_records from Plumber instead of re-parsing CSV
      const cleanedRecords = resultRecord.cleaned_records as Array<Record<string, unknown>> | undefined;
      const validRecords = (cleanedRecords || []).filter(
        (r) => typeof r.longitude === "number" && typeof r.latitude === "number" && isFinite(r.longitude) && isFinite(r.latitude)
      );

      if (validRecords.length > 0) {
        const recordsToInsert = validRecords.map((row) => ({
          speciesId: sp.id,
          projectId,
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

    if (!resultRecord) {
      return c.json(result);
    }

    const response: Record<string, unknown> = { ...resultRecord };
    if (inputDatasetId) {
      response.input_dataset_id = inputDatasetId;
    }

    const outputDataset = await createDatasetFromRecord({
      record: resultRecord,
      fileIdKeys: ["cleaned_file_id", "file_id"],
      kind: "cleaned",
      projectId,
      userId: user.id,
      speciesId: getString(body.species_id) ?? inputDataset?.speciesId ?? null,
      parentDatasetId: inputDatasetId ?? null,
      fallbackFileName: null,
    });
    if (outputDataset) {
      response.output_dataset_id = outputDataset.id;
    }

    return c.json(response);
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
    const user = c.get("user");
    const scoped = await resolveProjectIdForUser(user, getString(body.project_id));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }

    if (!taxon) {
      return c.json({ error: "taxon is required" }, 400);
    }

    const searchResult = await plumberClient.searchGbif({ taxon, country, max_records: maxRecords });
    const filePath = searchResult.file_path as string | undefined;
    const nRecords = (searchResult.n_records as number) || 0;

    if (!filePath || nRecords === 0) {
      return c.json({ error: "No GBIF records found" }, 404);
    }

    const response = {
      file_path: filePath,
      file_id: filePath,
      n_rows: nRecords,
      filename: filePath.split("/").pop() || "gbif_records.csv",
    };
    const dataset = await createOccurrenceDataset({
      projectId: scoped.projectId,
      speciesId: getString(body.species_id) ?? null,
      parentDatasetId: getString(body.parent_dataset_id) ?? null,
      kind: "gbif",
      status: "ready",
      fileId: filePath,
      fileName: response.filename,
      recordCount: nRecords,
      summary: { taxon, country: country ?? null },
      metadata: { source: "gbif" },
      createdBy: user.id,
    });

    return c.json({
      ...response,
      dataset_id: dataset.id,
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
    const scoped = await resolveProjectIdForUser(user, getString(body.project_id));
    if (scoped.forbidden || !scoped.projectId) {
      return c.json({ error: "Access denied" }, 403);
    }

    const result = await plumberClient.withUser(user.id).parseDwca({ file_id: destPath });
    const resultRecord = getRecord(result);
    if (!resultRecord) {
      return c.json(result);
    }

    const dataset = await createDatasetFromRecord({
      record: resultRecord,
      fileIdKeys: ["file_id", "file_path", "file"],
      kind: "dwca",
      projectId: scoped.projectId,
      userId: user.id,
      speciesId: getString(body.species_id) ?? null,
      parentDatasetId: getString(body.parent_dataset_id) ?? null,
      fallbackFileName: file.name,
    });

    return c.json(dataset ? { ...resultRecord, dataset_id: dataset.id } : resultRecord);
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
