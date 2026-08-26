#!/usr/bin/env node
// api/scripts/generate-plumber-types.ts
// Fetches OpenAPI spec from running Plumber instance and generates TypeScript types.
//
// Usage:
//   npx tsx scripts/generate-plumber-types.ts              # uses default Plumber URL
//   npx tsx scripts/generate-plumber-types.ts --url=http://localhost:8000
//
// Output: packages/shared/src/plumber-types.ts
//
// The generator is the source of truth for the typed shape of every Plumber
// response. `PlumberSchemas` is the auto-generated JSON-schema-derived map of
// every component schema Plumber exposes. Each endpoint also gets a
// `${operationId}Response` discriminated-union type keyed by HTTP status. We
// deliberately do NOT hand-write the typed shape of each endpoint response
// here — every prior hand-written interface drifted from runtime and was the
// source of Sev-1 type-contract bugs (PlumberHealthResponse declared 3 fields,
// runtime returned 6; PlumberClimateStatus declared job_id, runtime returned
// id). If a field needs a hand-typed name, it belongs on the Plumber R side
// in an `@response` OpenAPI annotation.

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

const PLUMBER_URL = process.argv.find((a) => a.startsWith("--url="))?.slice(6) || process.env.PLUMBER_URL || "http://localhost:8000";
const OUTPUT_PATH = join(PROJECT_ROOT, "packages", "shared", "src", "plumber-types.ts");
const MIN_OPENAPI_PATHS = process.env.PLUMBER_OPENAPI_MIN_PATHS ? Number(process.env.PLUMBER_OPENAPI_MIN_PATHS) : NaN;
const REQUIRED_OPENAPI_PATHS = (process.env.PLUMBER_OPENAPI_REQUIRED_PATHS || "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

const PLACEHOLDER_TOKEN = /<[^>]+>|\{[^}]+\}/g;

function patternToRegex(pattern: string): RegExp {
  const placeholderPattern = pattern.replace(PLACEHOLDER_TOKEN, "__OPENAPI_PLACEHOLDER__");
  const escaped = placeholderPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/__OPENAPI_PLACEHOLDER__/g, "[^/]+");

  return new RegExp(`^${escaped}$`);
}

function validateOpenAPIBaseline(spec: Record<string, unknown>): void {
  const paths = (spec.paths as Record<string, Record<string, unknown>>) || {};
  const availablePaths = Object.keys(paths);
  const pathCount = availablePaths.length;

  if (!Number.isFinite(MIN_OPENAPI_PATHS) && REQUIRED_OPENAPI_PATHS.length === 0) {
    return;
  }

  console.log(`[plumber-types] OpenAPI path count: ${pathCount}`);

  if (Number.isFinite(MIN_OPENAPI_PATHS) && pathCount < MIN_OPENAPI_PATHS) {
    throw new Error(
      `OpenAPI baseline check failed: expected >= ${MIN_OPENAPI_PATHS} paths, got ${pathCount}`
    );
  }

  for (const requiredPath of REQUIRED_OPENAPI_PATHS) {
    const matcher = patternToRegex(requiredPath);
    const ok = availablePaths.some((path) => matcher.test(path));
    if (!ok) {
      throw new Error(`OpenAPI baseline check failed: missing required path matching "${requiredPath}"`);
    }
  }

  if (REQUIRED_OPENAPI_PATHS.length > 0) {
    console.log(
      `[plumber-types] Required OpenAPI path patterns present: ${REQUIRED_OPENAPI_PATHS.length}/${REQUIRED_OPENAPI_PATHS.length}`
    );
  }
}

async function fetchOpenAPISpec(): Promise<Record<string, unknown>> {
  const baseUrl = PLUMBER_URL.replace(/\/+$/, "");
  const endpoints = ["/openapi.json", "/__openapi__/"];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint}`;
    console.log(`[plumber-types] Fetching OpenAPI spec from ${url}`);

    try {
      const res = await fetch(url);
      if (res.ok) {
        return res.json() as Promise<Record<string, unknown>>;
      }
      failures.push(`${endpoint}: ${res.status} ${res.statusText}`);
    } catch (err) {
      failures.push(`${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `Failed to fetch OpenAPI spec from Plumber endpoints: ${failures.join("; ")}\n` +
    `Is Plumber running at ${PLUMBER_URL} with OpenAPI docs enabled?`
  );
}

function generateTypes(spec: Record<string, unknown>): string {
  const paths = (spec.paths as Record<string, Record<string, Record<string, unknown>>>) || {};
  const components = (spec.components as Record<string, unknown>) || {};
  const schemas = (components.schemas as Record<string, unknown>) || {};

  const lines: string[] = [
    "// Auto-generated from Plumber OpenAPI spec — do not edit manually.",
    "// Regenerate: npx tsx api/scripts/generate-plumber-types.ts",
    "",
    "// Per-component JSON schema map. Each key is the schema name returned",
    "// by Plumber, each value is the raw schema object. Client code narrows",
    "// by indexing `PlumberSchemas['SomeResponse']` rather than declaring",
    "// hand-written interfaces — that way schema drift is caught at",
    "// generation time, not at runtime.",
    "export interface PlumberSchemas {",
  ];

  for (const [name, schema] of Object.entries(schemas)) {
    lines.push(`  ${name}: ${JSON.stringify(schema)};`);
  }

  lines.push("}", "");

  // Per-endpoint discriminated-union response types: an endpoint can have
  // multiple status codes (200, 4xx, 5xx). Each gets its own type alias
  // keyed by `${operationId}Response` and the field name is the literal HTTP
  // status code. This lets callers do
  //   `if (status === 200) data[200] else data[404]`
  // and have TypeScript narrow correctly.
  const endpointTypes: string[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      const op = operation as Record<string, unknown>;
      const operationId = (op.operationId as string) || `${method.toUpperCase()} ${path}`;
      const summary = (op.summary as string) || "";
      const responses = (op.responses as Record<string, Record<string, unknown>>) || {};

      const responseTypes: string[] = [];
      const statusCodes: string[] = [];
      for (const [status, response] of Object.entries(responses)) {
        const resp = response as Record<string, unknown>;
        const content = (resp.content as Record<string, Record<string, unknown>>) || {};
        const jsonSchema = (content["application/json"] as Record<string, unknown>)?.schema;
        if (jsonSchema) {
          responseTypes.push(`    ${status}: ${JSON.stringify(jsonSchema)};`);
          statusCodes.push(status);
        }
      }

      if (responseTypes.length > 0) {
        const typeName = operationId
          .replace(/[^a-zA-Z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");
        const comment = statusCodes.length === 1
          ? `// ${summary || operationId} — HTTP ${statusCodes[0]}`
          : `// ${summary || operationId} — discriminated by HTTP status: ${statusCodes.join(", ")}`;
        endpointTypes.push(
          comment,
          `export type ${typeName}Response = {`,
          ...responseTypes,
          `};`,
          ""
        );
      }
    }
  }

  lines.push(
    "// Per-endpoint response types (one alias per Plumber operationId).",
    ...endpointTypes,
    ""
  );

  return lines.join("\n");
}

async function main() {
  try {
    const spec = await fetchOpenAPISpec();
    validateOpenAPIBaseline(spec);
    const types = generateTypes(spec);

    mkdirSync(join(PROJECT_ROOT, "packages", "shared", "src"), { recursive: true });
    writeFileSync(OUTPUT_PATH, types, "utf-8");

    console.log(`[plumber-types] Generated types at ${OUTPUT_PATH}`);
    console.log(`[plumber-types] PlumberSchemas is the source of truth — narrow via data['SomeResponse'].`);
  } catch (err) {
    console.error("[plumber-types] Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
