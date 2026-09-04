// Auto-generated from Plumber OpenAPI spec — do not edit manually.
// Regenerate: npx tsx api/scripts/generate-plumber-types.ts
//
// Only types that are actually consumed by client code live here. Runtime
// responses in api/src/services/plumber.ts use `Record<string, unknown>` for
// untyped fields; typed callers import the schemas directly. The auto-generated
// `PlumberSchemas` interface (produced by the generator) is the source of
// truth for endpoint return shapes.

// ── Plumber upload response (hand-written; consumed by api/src/routes/occurrences.ts + examples.ts) ─
// If Plumber's @response shape changes, update this to match.
export interface PlumberUploadResponse {
  file_id: string;
  file_path: string;
  filename: string;
  format: string;
  n_rows: number;
  species_detected: string | null;
  columns_detected: Record<string, string | null>;
  coord_warnings?: string[];
  preview: Array<Record<string, unknown>>;
}

// ── Job logs (consumed by api + frontend via run-history.tsx + results/[runId]/page.tsx) ─────────
export interface PlumberJobLogs {
  id: string;
  stderr: string;
  stdout: string;
  progress_log: string;
}
