export const RUN_MANIFEST_SCHEMA_VERSION = "run_manifest.v1";

const MAX_STRING_LENGTH = 2048;
const MAX_OBJECT_KEYS = 50;
const MAX_ARRAY_ITEMS = 50;
const MAX_DEPTH = 4;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

type UnknownRecord = Record<string, unknown>;

export interface ArtifactRef {
  key: string;
  path: string | null;
  kind: "raster" | "image" | "table" | "text" | "script" | "json" | "unknown";
  media_type: string | null;
}

export interface RunManifestContract {
  schema_version: typeof RUN_MANIFEST_SCHEMA_VERSION;
  run_id: string;
  generated_at: string | null;
  species: string | null;
  app_version: JsonRecord | null;
  model: {
    id: string | null;
    label: string | null;
    parameters: JsonRecord | null;
  };
  data: JsonRecord | null;
  climate: JsonRecord | null;
  validation: JsonRecord | null;
  metrics: JsonRecord | null;
  output_files: JsonRecord | null;
  artifacts: ArtifactRef[];
  provenance: {
    app_version: JsonRecord | null;
    manifest_path: string | null;
  };
  warnings: string[];
}

export interface RunManifestEnvelope {
  ok: true;
  schema_version: typeof RUN_MANIFEST_SCHEMA_VERSION;
  run_id: string;
  generated_at: string | null;
  manifest_path: string | null;
  manifest: RunManifestContract;
}

export class ManifestAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestAdapterError";
  }
}

export function normalizeRunManifestResponse(payload: unknown, requestedRunId: string): RunManifestEnvelope {
  if (!isRecord(payload)) {
    throw new ManifestAdapterError("Malformed manifest response");
  }

  const sourceManifest = payload.manifest;
  if (!isRecord(sourceManifest)) {
    throw new ManifestAdapterError("Malformed manifest response: missing manifest object");
  }

  const manifestPath = asString(payload.manifest_path);
  const runId = asString(sourceManifest.run_id) ?? requestedRunId;
  const generatedAt = asString(sourceManifest.generated_at) ?? asString(sourceManifest.run_timestamp);
  const outputFiles = sanitizeRecord(sourceManifest.output_files ?? sourceManifest.output_paths);
  const appVersion = sanitizeRecord(
    sourceManifest.app_version ??
      compactRecord({
        r_version: sourceManifest.r_version,
        package_versions: sourceManifest.package_versions,
        git_sha: sourceManifest.git_sha,
      }),
  );

  const manifest: RunManifestContract = {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    species: asString(sourceManifest.species),
    app_version: appVersion,
    model: normalizeModel(sourceManifest),
    data: normalizeData(sourceManifest),
    climate: sanitizeRecord(sourceManifest.climate ?? sourceManifest.covariate_source),
    validation: sanitizeRecord(sourceManifest.validation),
    metrics: sanitizeRecord(sourceManifest.metrics),
    output_files: outputFiles,
    artifacts: normalizeArtifacts(outputFiles),
    provenance: {
      app_version: appVersion,
      manifest_path: manifestPath,
    },
    warnings: [],
  };

  return {
    ok: true,
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    manifest_path: manifestPath,
    manifest,
  };
}

function normalizeModel(sourceManifest: UnknownRecord): RunManifestContract["model"] {
  const model = isRecord(sourceManifest.model) ? sourceManifest.model : {};
  return {
    id: asString(model.id) ?? asString(sourceManifest.model_id),
    label: asString(model.label) ?? asString(sourceManifest.model_label),
    parameters: sanitizeRecord(model.parameters),
  };
}

function normalizeData(sourceManifest: UnknownRecord): JsonRecord | null {
  if (isRecord(sourceManifest.data)) {
    return sanitizeRecord(sourceManifest.data);
  }

  return sanitizeRecord(
    compactRecord({
      input_file_hash: sourceManifest.input_file_hash,
      cleaning_summary: sourceManifest.cleaning_summary,
    }),
  );
}

function normalizeArtifacts(outputFiles: JsonRecord | null): ArtifactRef[] {
  if (!outputFiles) {
    return [];
  }

  return Object.entries(outputFiles)
    .slice(0, MAX_OBJECT_KEYS)
    .map(([key, value]) => {
      const path = artifactPath(value);
      return {
        key: truncateString(key, 128),
        path,
        kind: inferArtifactKind(path),
        media_type: inferMediaType(path),
      };
    });
}

function artifactPath(value: JsonValue): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!isJsonRecord(value)) {
    return null;
  }

  return (
    jsonString(value.path) ??
    jsonString(value.file_path) ??
    jsonString(value.file) ??
    jsonString(value.url) ??
    jsonString(value.href)
  );
}

function inferArtifactKind(path: string | null): ArtifactRef["kind"] {
  const ext = extension(path);
  if (ext === "tif" || ext === "tiff") return "raster";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return "image";
  if (ext === "csv" || ext === "tsv") return "table";
  if (ext === "txt" || ext === "md") return "text";
  if (ext === "r" || ext === "rmd") return "script";
  if (ext === "json" || ext === "geojson") return "json";
  return "unknown";
}

function inferMediaType(path: string | null): string | null {
  const ext = extension(path);
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "csv") return "text/csv";
  if (ext === "tsv") return "text/tab-separated-values";
  if (ext === "txt") return "text/plain";
  if (ext === "md") return "text/markdown";
  if (ext === "r" || ext === "rmd") return "text/x-r-source";
  if (ext === "json" || ext === "geojson") return "application/json";
  return null;
}

function extension(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const lastSegment = withoutQuery.split(/[\\/]/).pop() ?? "";
  const index = lastSegment.lastIndexOf(".");
  if (index < 0 || index === lastSegment.length - 1) {
    return null;
  }
  return lastSegment.slice(index + 1).toLowerCase();
}

function sanitizeRecord(value: unknown): JsonRecord | null {
  const sanitized = sanitizeValue(value, 0);
  return isJsonRecord(sanitized) && Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeValue(value: unknown, depth: number): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return truncateString(value, MAX_STRING_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, entry]) => [truncateString(key, 128), sanitizeValue(entry, depth + 1)]),
    );
  }
  return String(value);
}

function compactRecord(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? truncateString(value, MAX_STRING_LENGTH) : null;
}

function jsonString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
