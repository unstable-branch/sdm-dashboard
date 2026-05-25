#!/usr/bin/env node
// api/scripts/generate-plumber-types.ts
// Fetches OpenAPI spec from running Plumber instance and generates TypeScript types.
//
// Usage:
//   npx tsx scripts/generate-plumber-types.ts              # uses default Plumber URL
//   npx tsx scripts/generate-plumber-types.ts --url=http://localhost:8000
//
// Output: packages/shared/src/plumber-types.ts

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

const PLUMBER_URL = process.argv.find((a) => a.startsWith("--url="))?.slice(6) || process.env.PLUMBER_URL || "http://localhost:8000";
const OUTPUT_PATH = join(PROJECT_ROOT, "packages", "shared", "src", "plumber-types.ts");

async function fetchOpenAPISpec(): Promise<Record<string, unknown>> {
  const url = `${PLUMBER_URL.replace(/\/+$/, "")}/__docs__/openapi.json`;
  console.log(`[plumber-types] Fetching OpenAPI spec from ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}\n` +
      `Is Plumber running at ${PLUMBER_URL} with OpenAPI docs enabled?`
    );
  }

  return res.json() as Promise<Record<string, unknown>>;
}

function generateTypes(spec: Record<string, unknown>): string {
  const paths = (spec.paths as Record<string, Record<string, unknown>>) || {};
  const components = (spec.components as Record<string, unknown>) || {};
  const schemas = (components.schemas as Record<string, unknown>) || {};

  const lines: string[] = [
    "// Auto-generated from Plumber OpenAPI spec — do not edit manually",
    "// Regenerate: npx tsx api/scripts/generate-plumber-types.ts",
    "",
    "export interface PlumberSchemas {",
  ];

  for (const [name, schema] of Object.entries(schemas)) {
    lines.push(`  ${name}: ${JSON.stringify(schema)};`);
  }

  lines.push("}", "");

  const endpointTypes: string[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      const op = operation as Record<string, unknown>;
      const operationId = (op.operationId as string) || `${method.toUpperCase()} ${path}`;
      const summary = (op.summary as string) || "";
      const responses = (op.responses as Record<string, unknown>) || {};

      const responseTypes: string[] = [];
      for (const [status, response] of Object.entries(responses)) {
        const resp = response as Record<string, unknown>;
        const content = (resp.content as Record<string, unknown>) || {};
        const jsonSchema = (content["application/json"] as Record<string, unknown>)?.schema;
        if (jsonSchema) {
          responseTypes.push(`    ${status}: ${JSON.stringify(jsonSchema)};`);
        }
      }

      if (responseTypes.length > 0) {
        endpointTypes.push(
          `// ${summary || operationId}`,
          `export type ${operationId.replace(/[^a-zA-Z0-9]/g, "_")}Response = {`,
          ...responseTypes,
          `};`,
          ""
        );
      }
    }
  }

  lines.push(
    "// Endpoint response types",
    ...endpointTypes,
    "// Plumber health check response",
    "export interface PlumberHealthResponse {",
    "  status: string;",
    "  r_version: string;",
    "  timestamp: string;",
    "}",
    "",
    "// Plumber model run response",
    "export interface PlumberRunResponse {",
    "  job_id: string;",
    "  status: string;",
    "  message: string;",
    "}",
    "",
    "// Plumber model status response",
    "export interface PlumberStatusResponse {",
    "  id: string;",
    "  status: string;",
    "  started_at: string;",
    "  completed_at: string | null;",
    "  error: string | null;",
    "  error_traceback: string | null;",
    "  metrics: Record<string, unknown> | null;",
    "  output_files: Record<string, string> | null;",
    "  r_cpu_time_ms: number | null;",
    "  r_peak_memory_mb: number | null;",
    "  progress_log: string[];",
    "  progress_json: Array<{ timestamp: string; percent: number; detail: string; stage: string }> | null;",
    "}",
    "",
    "// Plumber model listing response",
    "export interface PlumberModelInfo {",
    "  id: string;",
    "  label: string;",
    "  maturity: string;",
    "  min_records: number | null;",
    "  packages: string[];",
    "  notes: string;",
    "}",
    "",
    "// Plumber occurrence upload response",
    "export interface PlumberUploadResponse {",
    "  file_id: string;",
    "  file_path: string;",
    "  filename: string;",
    "  format: string;",
    "  n_rows: number;",
    "  species_detected: string | null;",
    "  columns_detected: Record<string, string | null>;",
    "  preview: Array<Record<string, unknown>>;",
    "}",
    "",
    "// Plumber occurrence clean response",
    "export interface PlumberCleanResponse {",
    "  cleaned_id: string;",
    "  cleaned_file_id: string;",
    "  valid_records: number;",
    "  original_rows: number;",
    "  removed_bad_coordinates: number;",
    "  removed_duplicates: number;",
    "  n_absent_excluded: number;",
    "  source_counts: Record<string, number>;",
    "  cc_flagged: number;",
    "  training_extent: Array<Array<number>>;",
    "  cleaned_records: Array<Record<string, unknown>>;",
    "}",
    "",
    "// Plumber climate scenario response",
    "export interface PlumberClimateScenario {",
    "  id: string;",
    "  type: string;",
    "  gcm?: string;",
    "  ssp?: string;",
    "  period?: string;",
    "  file_count: number;",
    "  size_bytes: number;",
    "  is_averaged?: boolean;",
    "  source?: string;",
    "}",
    "",
    "// Plumber manifest response",
    "export interface PlumberManifestResponse {",
    "  ok: boolean;",
    "  manifest_path: string;",
    "  manifest: Record<string, unknown>;",
    "}",
    "",
    "// Plumber error response",
    "export interface PlumberErrorResponse {",
    "  error: string;",
    "}",
    ""
  );

  return lines.join("\n");
}

async function main() {
  try {
    const spec = await fetchOpenAPISpec();
    const types = generateTypes(spec);

    mkdirSync(join(PROJECT_ROOT, "packages", "shared", "src"), { recursive: true });
    writeFileSync(OUTPUT_PATH, types, "utf-8");

    console.log(`[plumber-types] Generated types at ${OUTPUT_PATH}`);
    console.log(`[plumber-types] Import from '@sdm/shared' as PlumberStatusResponse, PlumberRunResponse, etc.`);
  } catch (err) {
    console.error("[plumber-types] Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
