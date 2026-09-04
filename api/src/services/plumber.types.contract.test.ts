import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(process.cwd(), "..");

describe("GF-01 + GF-02: Plumber runtime shape matches generated types", () => {
  it("Plumber runtime health response includes the documented optional fields", () => {
    // The audit found that handle_health() in plumber/R/helpers/health_helpers.R
    // returns 6 fields (status, r_version, timestamp, active_runs,
    // max_concurrent_runs, memory_gb) but the hand-written PlumberHealthResponse
    // only declared 3. After Group F the only hand-written types are those
    // actively consumed; health uses Record<string, unknown> at the consumer.
    // The contract is now: runtime keys are the source of truth, the
    // generated PlumberSchemas captures them.
    const runtimeFields = [
      "status",
      "r_version",
      "timestamp",
      "active_runs",
      "max_concurrent_runs",
      "memory_gb",
    ];
    const rSource = fs.readFileSync(
      path.join(repoRoot, "plumber", "R", "helpers", "health_helpers.R"),
      "utf-8",
    );
    expect(rSource).toContain("active_runs = sdm_count_active_runs()");
    expect(rSource).toContain("max_concurrent_runs = SDM_MAX_CONCURRENT_RUNS");
    expect(rSource).toContain("memory_gb =");
    for (const f of runtimeFields) {
      expect(rSource).toContain(f);
    }
  });

  it("Plumber runtime climate status returns id (not job_id)", () => {
    // GF-02: the audit found handle_climate_status returns id; the hand-written
    // PlumberClimateStatus declared job_id. After Group F that hand-written
    // type is gone; clients consume via Record<string, unknown>.
    const rSource = fs.readFileSync(
      path.join(repoRoot, "plumber", "R", "helpers", "climate_helpers.R"),
      "utf-8",
    );
    expect(rSource).toContain("id = meta$id");
    expect(rSource).toContain("status = meta$status");
    expect(rSource).not.toContain("job_id = meta$id");
  });

  it("plumber-types.ts exports only types that are actually consumed by the api", () => {
    // GF-03: prior versions exported ~15 hand-written interfaces of which only
    // PlumberUploadResponse and PlumberJobLogs were actually consumed. After
    // Group F every other type is gone.
    const shared = fs.readFileSync(
      path.join(repoRoot, "packages", "shared", "src", "plumber-types.ts"),
      "utf-8",
    );
    const exports = Array.from(shared.matchAll(/^export\s+(?:interface|type)\s+(\w+)/gm)).map((m) => m[1]);

    // Allowed hand-written types: only those with live consumers.
    const allowed = new Set(["PlumberUploadResponse", "PlumberJobLogs"]);
    const unexpected = exports.filter((e) => !allowed.has(e));
    expect(unexpected).toEqual([]);
  });

  it("PlumberUploadResponse is the only declared response type besides PlumberJobLogs", () => {
    // Belt-and-suspenders: confirm the contract is small.
    const shared = fs.readFileSync(
      path.join(repoRoot, "packages", "shared", "src", "plumber-types.ts"),
      "utf-8",
    );
    const exports = Array.from(shared.matchAll(/^export\s+(?:interface|type)\s+(\w+)/gm)).map((m) => m[1]);
    expect(exports.sort()).toEqual(["PlumberJobLogs", "PlumberUploadResponse"]);
  });

  it("generate-plumber-types.ts does not hand-write endpoint response interfaces", () => {
    // GF-04: the generator used to emit a hand-written PlumberHealthResponse,
    // PlumberRunResponse, PlumberStatusResponse, PlumberModelInfo,
    // PlumberUploadResponse, PlumberCleanResponse, PlumberClimateScenario,
    // PlumberManifestResponse, PlumberErrorResponse — all of which drifted
    // from runtime. The new generator emits ONLY PlumberSchemas (the
    // JSON-schema-derived map) and per-endpoint discriminated-union types.
    const gen = fs.readFileSync(
      path.join(repoRoot, "api", "scripts", "generate-plumber-types.ts"),
      "utf-8",
    );
    for (const drifted of [
      "PlumberRunResponse",
      "PlumberStatusResponse",
      "PlumberModelInfo",
      "PlumberCleanResponse",
      "PlumberClimateScenario",
      "PlumberManifestResponse",
      "PlumberErrorResponse",
    ]) {
      expect(gen).not.toContain(`export interface ${drifted}`);
    }
    expect(gen).toContain("PlumberSchemas");
  });
});
