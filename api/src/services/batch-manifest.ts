export const BATCH_MANIFEST_SCHEMA_VERSION = "batch_manifest.v1";

const MAX_CHILDREN = 50;
const MAX_ARTIFACTS_PER_CHILD = 20;
const MAX_TOTAL_ARTIFACT_REFS = 200;
const MAX_WARNINGS = 100;
const MAX_WARNING_MESSAGE_LENGTH = 512;
const MAX_STRING_LENGTH = 2048;
const MAX_OBJECT_KEYS = 50;
const MAX_ARRAY_ITEMS = 50;
const MAX_DEPTH = 4;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };
type UnknownRecord = Record<string, unknown>;

export type BatchManifestRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";

export interface BatchManifestRefInput {
  key?: unknown;
  path?: unknown;
  url?: unknown;
  href?: unknown;
  media_type?: unknown;
  mediaType?: unknown;
}

export interface BatchManifestRef {
  key: string | null;
  path: string | null;
  url: string | null;
  media_type: string | null;
}

export interface BatchManifestArtifactRef {
  run_id: string;
  key: string;
  path: string | null;
  kind: "raster" | "image" | "table" | "text" | "script" | "json" | "unknown";
  media_type: string | null;
}

export interface BatchManifestWarning {
  code: string;
  severity: "warning";
  message: string;
  run_id: string | null;
}

export interface BatchManifestCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  with_manifest_refs: number;
  with_artifact_refs: number;
}

export interface BatchManifestChild {
  run_id: string;
  species: string | null;
  model_id: string | null;
  status: BatchManifestRunStatus;
  manifest_ref: BatchManifestRef | null;
  artifact_refs: BatchManifestArtifactRef[];
  warnings: BatchManifestWarning[];
}

export interface BatchManifestContract {
  schema_version: typeof BATCH_MANIFEST_SCHEMA_VERSION;
  batch_id: string;
  generated_at: string | null;
  run_ids: string[];
  counts: BatchManifestCounts;
  comparison: {
    ref: BatchManifestRef | null;
    summary: JsonRecord | null;
  };
  children: BatchManifestChild[];
  artifact_refs: BatchManifestArtifactRef[];
  warnings: BatchManifestWarning[];
  provenance: {
    source: string;
    generated_at: string | null;
    input_refs: BatchManifestRef[];
  };
}

export interface BatchManifestRunInput {
  id?: unknown;
  run_id?: unknown;
  species?: unknown;
  model_id?: unknown;
  status?: unknown;
  error?: unknown;
  warnings?: unknown;
  manifest?: unknown;
  manifest_ref?: BatchManifestRefInput | string | null;
  manifest_path?: unknown;
  artifacts?: unknown;
  artifact_refs?: unknown;
}

export interface BuildBatchManifestInput {
  batch_id: string;
  generated_at?: unknown;
  runs?: BatchManifestRunInput[];
  counts?: Partial<BatchManifestCounts> | null;
  comparison?: unknown;
  comparison_ref?: BatchManifestRefInput | string | null;
  warnings?: unknown;
  provenance?: {
    source?: unknown;
    generated_at?: unknown;
    input_refs?: Array<BatchManifestRefInput | string | null>;
  } | null;
}

export function buildBatchManifestContract(input: BuildBatchManifestInput): BatchManifestContract {
  const children = (input.runs ?? [])
    .slice(0, MAX_CHILDREN)
    .map((run) => normalizeChild(run))
    .filter((child): child is BatchManifestChild => child !== null);
  const artifactRefs = children.flatMap((child) => child.artifact_refs).slice(0, MAX_TOTAL_ARTIFACT_REFS);
  const warnings = normalizeWarnings(input.warnings, null)
    .concat(extractComparisonWarnings(input.comparison))
    .concat(children.flatMap((child) => child.warnings))
    .slice(0, MAX_WARNINGS);

  return {
    schema_version: BATCH_MANIFEST_SCHEMA_VERSION,
    batch_id: truncateString(input.batch_id, 128),
    generated_at: asString(input.generated_at),
    run_ids: children.map((child) => child.run_id),
    counts: mergeCounts(deriveCounts(children), input.counts),
    comparison: {
      ref: normalizeRef(input.comparison_ref, "comparison"),
      summary: normalizeComparisonSummary(input.comparison),
    },
    children,
    artifact_refs: artifactRefs,
    warnings,
    provenance: {
      source: asString(input.provenance?.source) ?? "already_fetched_summaries",
      generated_at: asString(input.provenance?.generated_at) ?? asString(input.generated_at),
      input_refs: normalizeInputRefs(input.provenance?.input_refs),
    },
  };
}

function normalizeChild(run: BatchManifestRunInput): BatchManifestChild | null {
  const sourceManifest = isRecord(run.manifest) ? run.manifest : {};
  const runId = asString(run.run_id) ?? asString(run.id) ?? asString(sourceManifest.run_id);
  if (!runId) {
    return null;
  }

  const manifestRef =
    normalizeRef(run.manifest_ref, "manifest") ??
    normalizeRef(asString(run.manifest_path) ?? asString(sourceManifest.manifest_path), "manifest");
  const artifactRefs = normalizeArtifactRefs(runId, run.artifact_refs ?? run.artifacts ?? sourceManifest.artifacts);
  const warnings = normalizeWarnings(run.warnings ?? sourceManifest.warnings, runId);
  const errorMessage = asString(run.error ?? sourceManifest.error);
  if (errorMessage) {
    warnings.push({
      code: "child_error",
      severity: "warning",
      message: truncateString(errorMessage, MAX_WARNING_MESSAGE_LENGTH),
      run_id: runId,
    });
  }

  return {
    run_id: runId,
    species: asString(run.species ?? sourceManifest.species),
    model_id: asString(run.model_id ?? field(sourceManifest.model, "id") ?? sourceManifest.model_id),
    status: normalizeStatus(run.status ?? sourceManifest.status),
    manifest_ref: manifestRef,
    artifact_refs: artifactRefs,
    warnings: warnings.slice(0, MAX_WARNINGS),
  };
}

function deriveCounts(children: BatchManifestChild[]): BatchManifestCounts {
  const counts: BatchManifestCounts = {
    total: children.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    active: 0,
    with_manifest_refs: 0,
    with_artifact_refs: 0,
  };

  for (const child of children) {
    if (child.status === "queued" || child.status === "running" || child.status === "completed" || child.status === "failed" || child.status === "cancelled") {
      counts[child.status]++;
    }
    if (child.status === "queued" || child.status === "running") {
      counts.active++;
    }
    if (child.manifest_ref) {
      counts.with_manifest_refs++;
    }
    if (child.artifact_refs.length > 0) {
      counts.with_artifact_refs++;
    }
  }

  return counts;
}

function mergeCounts(derived: BatchManifestCounts, overrides: Partial<BatchManifestCounts> | null | undefined): BatchManifestCounts {
  if (!overrides) {
    return derived;
  }

  return {
    total: finiteCount(overrides.total) ?? derived.total,
    queued: finiteCount(overrides.queued) ?? derived.queued,
    running: finiteCount(overrides.running) ?? derived.running,
    completed: finiteCount(overrides.completed) ?? derived.completed,
    failed: finiteCount(overrides.failed) ?? derived.failed,
    cancelled: finiteCount(overrides.cancelled) ?? derived.cancelled,
    active: finiteCount(overrides.active) ?? derived.active,
    with_manifest_refs: finiteCount(overrides.with_manifest_refs) ?? derived.with_manifest_refs,
    with_artifact_refs: finiteCount(overrides.with_artifact_refs) ?? derived.with_artifact_refs,
  };
}

function normalizeComparisonSummary(comparison: unknown): JsonRecord | null {
  if (!isRecord(comparison)) {
    return null;
  }

  const summary = sanitizeRecord({
    schema: comparison.schema ?? comparison.schema_version,
    counts: comparison.counts,
    metrics: comparison.metrics,
    warnings: comparison.warnings,
  });
  return summary && Object.keys(summary).length > 0 ? summary : null;
}

function extractComparisonWarnings(comparison: unknown): BatchManifestWarning[] {
  if (!isRecord(comparison) || !Array.isArray(comparison.warnings)) {
    return [];
  }

  return normalizeWarnings(comparison.warnings, null).map((warning) => ({
    ...warning,
    code: warning.code === "warning" ? "comparison_warning" : warning.code,
  }));
}

function normalizeArtifactRefs(runId: string, value: unknown): BatchManifestArtifactRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_ARTIFACTS_PER_CHILD)
    .map((artifact) => normalizeArtifactRef(runId, artifact))
    .filter((artifact): artifact is BatchManifestArtifactRef => artifact !== null);
}

function normalizeArtifactRef(runId: string, value: unknown): BatchManifestArtifactRef | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = asString(value.key);
  if (!key) {
    return null;
  }

  const path = asString(value.path);
  return {
    run_id: runId,
    key: truncateString(key, 128),
    path,
    kind: normalizeArtifactKind(value.kind, path),
    media_type: asString(value.media_type) ?? asString(value.mediaType) ?? inferMediaType(path),
  };
}

function normalizeWarnings(value: unknown, fallbackRunId: string | null): BatchManifestWarning[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values
    .slice(0, MAX_WARNINGS)
    .map((warning) => normalizeWarning(warning, fallbackRunId))
    .filter((warning): warning is BatchManifestWarning => warning !== null);
}

function normalizeWarning(value: unknown, fallbackRunId: string | null): BatchManifestWarning | null {
  if (typeof value === "string") {
    return {
      code: "warning",
      severity: "warning",
      message: truncateString(value, MAX_WARNING_MESSAGE_LENGTH),
      run_id: fallbackRunId,
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const message = asString(value.message) ?? asString(value.error);
  if (!message) {
    return null;
  }

  return {
    code: normalizeCode(value.code) ?? "warning",
    severity: "warning",
    message: truncateString(message, MAX_WARNING_MESSAGE_LENGTH),
    run_id: asString(value.run_id) ?? fallbackRunId,
  };
}

function normalizeInputRefs(value: Array<BatchManifestRefInput | string | null> | undefined): BatchManifestRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_OBJECT_KEYS)
    .map((ref, index) => normalizeRef(ref, `input_${index}`))
    .filter((ref): ref is BatchManifestRef => ref !== null);
}

function normalizeRef(value: BatchManifestRefInput | string | null | undefined, fallbackKey: string): BatchManifestRef | null {
  if (typeof value === "string") {
    return {
      key: fallbackKey,
      path: value,
      url: null,
      media_type: inferMediaType(value),
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const path = asString(value.path);
  const url = asString(value.url) ?? asString(value.href);
  if (!path && !url) {
    return null;
  }

  return {
    key: asString(value.key) ?? fallbackKey,
    path,
    url,
    media_type: asString(value.media_type) ?? asString(value.mediaType) ?? inferMediaType(path ?? url),
  };
}

function normalizeStatus(value: unknown): BatchManifestRunStatus {
  switch (value) {
    case "queued":
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "unknown";
  }
}

function normalizeArtifactKind(value: unknown, path: string | null): BatchManifestArtifactRef["kind"] {
  if (value === "raster" || value === "image" || value === "table" || value === "text" || value === "script" || value === "json" || value === "unknown") {
    return value;
  }

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
        .filter(([key]) => !isUnsafeInlineKey(key))
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, entry]) => [truncateString(key, 128), sanitizeValue(entry, depth + 1)]),
    );
  }
  return String(value);
}

function isUnsafeInlineKey(key: string): boolean {
  return /^(output_files|outputFiles|occurrence_rows|occurrences|rows|raw|payload|data|raster)$/i.test(key);
}

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const code = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  return code.length > 0 ? code : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? truncateString(value, MAX_STRING_LENGTH) : null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
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
