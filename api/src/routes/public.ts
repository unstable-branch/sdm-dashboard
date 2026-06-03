import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs, species } from "../db/schema.js";
import type { AppEnv } from "../middleware/auth.js";
import { optionalAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

type BioregionMatch = "match" | "partial" | "mismatch" | "unknown";

type RouteRunRow = {
  runId: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | null;
  completedAt: Date | null;
  config: unknown;
  metrics: unknown;
  outputFiles: unknown;
  provenance: unknown;
  speciesOccurrenceCount: number | null;
};

type SpeciesIntelligencePayload = {
  seedSlug: string;
  scientificName: string;
  alaGuid: string | null;
  occurrenceCount: number;
  occurrenceSource: "ala" | "sdm-dashboard";
  nativeRangeBioregions: string[];
  customerBioregionMatch: BioregionMatch;
  lastModelRunAt: string | null;
  modelStatus: "ready" | "processing" | "stale" | "unavailable" | "failed";
  suitabilityTileUrl: string | null;
  suitabilityImageUrl: string | null;
  confidenceLabel: string | null;
  limitations: string[];
  futureClimateSummary: string | null;
  recommendedUse: string | null;
  sourceRunId: string | null;
};

const BIOME_REGION_KEYS = [
  "nativeRangeBioregions",
  "native_range_bioregions",
  "nativeRangeBioregion",
  "native_range_bioregion",
];

const CONFIDENCE_KEYS = [
  "confidenceLabel",
  "confidence_label",
];

const IMAGE_KEYS = [
  "suitabilityImageUrl",
  "suitability_image_url",
  "suitabilityImage",
  "suitability_image",
];

const TILE_KEYS = [
  "suitabilityTileUrl",
  "suitability_tile_url",
  "suitabilityTile",
  "suitability_tile",
];

const FUTURE_SUMMARY_KEYS = [
  "futureClimateSummary",
  "future_summary",
  "futureClimate",
];

const RECOMMENDED_USE_KEYS = [
  "recommendedUse",
  "recommended_use",
];

const LIMITATION_KEYS = [
  "limitations",
  "caveats",
  "notes",
];

const OCCURRENCE_KEYS = [
  "occurrenceCount",
  "occurrence_count",
  "presenceRecords",
  "presence_records",
  "records",
  "totalOccurrences",
  "total_occurrences",
];

const MODEL_STATUS_READY = "ready";
const MODEL_STATUS_UNAVAILABLE: SpeciesIntelligencePayload["modelStatus"] = "unavailable";

const publicSpeciesRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyPrefix: "public-species-intelligence",
});

const publicCacheHeaders = createMiddleware(async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.header("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
    c.header("Vary", "Accept, X-API-Key");
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized.length > 0 ? normalized : null;
}

function readNumberIfPresent(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.includes("..") || value.includes("\\") || value.includes("file:")) {
    return false;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function findNestedValue(container: unknown, keys: string[]): unknown {
  if (!isRecord(container)) return null;
  for (const key of keys) {
    if (key in container) return container[key];
  }
  return null;
}

function readOccurrenceCount(row: RouteRunRow): number {
  for (const key of OCCURRENCE_KEYS) {
    if (isRecord(row.metrics) && key in row.metrics) {
      const candidate = readNumberIfPresent(row.metrics[key]);
      if (candidate !== null) return candidate;
    }
  }

  if (row.speciesOccurrenceCount && row.speciesOccurrenceCount > 0) {
    return row.speciesOccurrenceCount;
  }
  return 0;
}

function readNativeRangeBioregions(row: RouteRunRow): string[] {
  const fromProvenance = asStringArray(findNestedValue(row.provenance, BIOME_REGION_KEYS));
  if (fromProvenance.length > 0) return fromProvenance;

  const fromConfig = asStringArray(findNestedValue(row.config, BIOME_REGION_KEYS));
  if (fromConfig.length > 0) return fromConfig;

  const fromOutput = asStringArray(findNestedValue(row.outputFiles, BIOME_REGION_KEYS));
  return fromOutput;
}

function readStringByKeys(value: unknown, keys: string[]): string | null {
  const candidate = findNestedValue(value, keys);
  return asNonEmptyString(candidate);
}

function readStringArrayByKeys(value: unknown, keys: string[]): string[] {
  for (const key of keys) {
    const candidate = findNestedValue(value, [key]);
    const items = asStringArray(candidate);
    if (items.length > 0) return items;
  }
  return [];
}

function readAlaGuid(row: RouteRunRow): string | null {
  return (
    readStringByKeys(row.config, ["ala_guid", "alaGuid", "alaGuidId", "ala_guid_id"]) ??
    readStringByKeys(row.provenance, ["ala_guid", "alaGuid", "alaGuidId", "ala_guid_id"]) ??
    null
  );
}

function safePublicUrl(values: unknown[]): string | null {
  for (const value of values) {
    if (isHttpUrl(value)) {
      return value.trim();
    }
  }
  return null;
}

function findUrls(row: RouteRunRow): { tileUrl: string | null; imageUrl: string | null } {
  const tile = safePublicUrl([
    readStringByKeys(row.outputFiles, TILE_KEYS),
    readStringByKeys(row.provenance, TILE_KEYS),
    readStringByKeys(row.config, TILE_KEYS),
  ].flatMap((value) => [value].filter(Boolean)));

  const image = safePublicUrl([
    readStringByKeys(row.outputFiles, IMAGE_KEYS),
    readStringByKeys(row.provenance, IMAGE_KEYS),
    readStringByKeys(row.config, IMAGE_KEYS),
  ].flatMap((value) => [value].filter(Boolean)));

  return { tileUrl: tile, imageUrl: image };
}

function computeBioregionMatch(
  customerBioregion: string | null,
  nativeRangeBioregions: string[],
): BioregionMatch {
  if (!customerBioregion || nativeRangeBioregions.length === 0) return "unknown";

  const query = customerBioregion.toLowerCase().trim();
  const ranges = nativeRangeBioregions.map((value) => value.toLowerCase().trim());
  if (ranges.includes(query)) return "match";

  const partial = ranges.some((value) => value.includes(query) || query.includes(value));
  return partial ? "partial" : "mismatch";
}

function occurrenceSourceFromRun(run: RouteRunRow | null): "ala" | "sdm-dashboard" {
  return run && run.status === "completed" ? "sdm-dashboard" : "ala";
}

function modelStatusFromRun(run: RouteRunRow | null): SpeciesIntelligencePayload["modelStatus"] {
  if (!run) return MODEL_STATUS_UNAVAILABLE;
  if (run.status === "completed") return MODEL_STATUS_READY;
  if (run.status === "running" || run.status === "queued") return "processing";
  if (run.status === "cancelled") return "unavailable";
  if (run.status === "failed") return "failed";
  return MODEL_STATUS_UNAVAILABLE;
}

export function normalizeSpeciesIntelligenceFromRun(input: {
  seedSlug: string;
  scientificName: string;
  alaGuid?: string | null;
  customerBioregion: string | null;
  run: RouteRunRow | null;
  modelStatus?: SpeciesIntelligencePayload["modelStatus"];
}): SpeciesIntelligencePayload {
  const { seedSlug, scientificName, alaGuid, customerBioregion, run, modelStatus } = input;
  const nativeRangeBioregions = run ? readNativeRangeBioregions(run) : [];
  const customerBioregionMatch = computeBioregionMatch(customerBioregion, nativeRangeBioregions);
  const { tileUrl, imageUrl } = run ? findUrls(run) : { tileUrl: null, imageUrl: null };

  return {
    seedSlug,
    scientificName,
    alaGuid: asNonEmptyString(alaGuid) ?? (run ? readAlaGuid(run) : null),
    occurrenceCount: run ? readOccurrenceCount(run) : 0,
    occurrenceSource: occurrenceSourceFromRun(run),
    nativeRangeBioregions,
    customerBioregionMatch,
    lastModelRunAt: run?.completedAt ? run.completedAt.toISOString() : null,
    modelStatus: modelStatus ?? modelStatusFromRun(run),
    suitabilityTileUrl: tileUrl,
    suitabilityImageUrl: imageUrl,
    confidenceLabel: run ? readStringByKeys(run.provenance, CONFIDENCE_KEYS) : null,
    limitations: run ? readStringArrayByKeys(run.provenance, LIMITATION_KEYS) : [],
    futureClimateSummary: run ? readStringByKeys(run.provenance, FUTURE_SUMMARY_KEYS) : null,
    recommendedUse: run ? readStringByKeys(run.provenance, RECOMMENDED_USE_KEYS) : null,
    sourceRunId: run?.runId ?? null,
  };
}

function bestRun(rows: RouteRunRow[], alaGuid: string | null): RouteRunRow | null {
  if (rows.length === 0) return null;
  if (!alaGuid) return rows[0];

  const normalizedGuid = alaGuid.toLowerCase().trim();
  if (!normalizedGuid) return rows[0];

  const match = rows.find((run) => {
    const runGuid = asNonEmptyString(readAlaGuid(run));
    return runGuid !== null && runGuid.toLowerCase().trim() === normalizedGuid;
  });

  return match ?? null;
}

function runMatchesAlaGuid(run: RouteRunRow, alaGuid: string | null): boolean {
  if (!alaGuid) return true;
  const normalizedGuid = alaGuid.toLowerCase().trim();
  if (!normalizedGuid) return true;

  const runGuid = asNonEmptyString(readAlaGuid(run));
  return runGuid !== null && runGuid.toLowerCase().trim() === normalizedGuid;
}

function selectPublicRun(rows: RouteRunRow[], alaGuid: string | null): {
  run: RouteRunRow | null;
  modelStatus: SpeciesIntelligencePayload["modelStatus"];
} {
  if (rows.length === 0) {
    return { run: null, modelStatus: MODEL_STATUS_UNAVAILABLE };
  }

  const scopedRows = rows.filter((run) => runMatchesAlaGuid(run, alaGuid));
  if (scopedRows.length === 0) {
    return { run: null, modelStatus: MODEL_STATUS_UNAVAILABLE };
  }

  const latestActive = scopedRows.find((run) => run.status === "queued" || run.status === "running") ?? null;
  const latestCompleted = bestRun(scopedRows.filter((run) => run.status === "completed"), alaGuid);
  if (latestActive && latestCompleted) {
    return { run: latestCompleted, modelStatus: "stale" };
  }
  if (latestActive) {
    return { run: latestActive, modelStatus: "processing" };
  }
  if (latestCompleted) {
    return { run: latestCompleted, modelStatus: MODEL_STATUS_READY };
  }

  const latestFailed = scopedRows.find((run) => run.status === "failed") ?? null;
  if (latestFailed) {
    return { run: latestFailed, modelStatus: "failed" };
  }

  return { run: null, modelStatus: MODEL_STATUS_UNAVAILABLE };
}

export const publicRoutes = new Hono<AppEnv>();
publicRoutes.use("*", optionalAuth);

publicRoutes.get("/species-intelligence", publicSpeciesRateLimit, publicCacheHeaders, async (c) => {
  const seedSlug = asNonEmptyString(c.req.query("seed_slug"));
  const scientificName = asNonEmptyString(c.req.query("scientific_name"));

  if (!seedSlug || !scientificName) {
    return c.json({ error: "seed_slug and scientific_name are required" }, 400);
  }

  const alaGuid = asNonEmptyString(c.req.query("ala_guid"));
  const customerBioregion = asNonEmptyString(c.req.query("customer_bioregion"));

  try {
    const rows = await db
      .select({
        runId: runs.id,
        status: runs.status,
        completedAt: runs.completedAt,
        config: runs.config,
        metrics: runs.metrics,
        outputFiles: runs.outputFiles,
        provenance: runs.provenance,
        speciesOccurrenceCount: species.occurrenceCount,
      })
      .from(runs)
      .leftJoin(species, eq(runs.speciesId, species.id))
      .where(eq(runs.speciesName, scientificName))
      .orderBy(desc(runs.completedAt), desc(runs.createdAt))
      .limit(20);

    const selected = selectPublicRun(rows, alaGuid);

    const payload = normalizeSpeciesIntelligenceFromRun({
      seedSlug,
      scientificName,
      alaGuid,
      customerBioregion,
      run: selected.run,
      modelStatus: selected.modelStatus,
    });

    return c.json(payload);
  } catch (error) {
    console.error("[public] species-intelligence failed", error instanceof Error ? error.message : error);
    return c.json({
      seedSlug,
      scientificName,
      alaGuid: alaGuid ?? null,
      occurrenceCount: 0,
      occurrenceSource: "ala",
      nativeRangeBioregions: [],
      customerBioregionMatch: "unknown",
      lastModelRunAt: null,
      modelStatus: MODEL_STATUS_UNAVAILABLE,
      suitabilityTileUrl: null,
      suitabilityImageUrl: null,
      confidenceLabel: null,
      limitations: [],
      futureClimateSummary: null,
      recommendedUse: null,
      sourceRunId: null,
    } satisfies SpeciesIntelligencePayload);
  }
});
