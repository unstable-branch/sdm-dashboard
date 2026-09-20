import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Plumber canonical execution boundary", () => {
  it("rejects model payloads that lack a fresh Hono execution attestation", async () => {
    const source = await readFile(resolve(process.cwd(), "../plumber/R/helpers/models_helpers.R"), "utf8");
    expect(source).toContain("sdm_require_canonical_execution <- function(req)");
    const handler = source.slice(source.indexOf("handle_model_run <- function"), source.indexOf("sdm_execution_config_keys <- function"));
    expect(handler.indexOf("sdm_require_canonical_execution(req)")).toBeGreaterThanOrEqual(0);
    expect(handler.indexOf("sdm_require_canonical_execution(req)")).toBeLessThan(handler.indexOf("jsonlite::fromJSON"));
    const targetsHandler = source.slice(source.indexOf("handle_targets_run <- function"), source.indexOf("handle_targets_status <- function"));
    expect(targetsHandler.indexOf("sdm_require_canonical_execution(req)")).toBeGreaterThanOrEqual(0);
    expect(targetsHandler.indexOf("sdm_require_canonical_execution(req)")).toBeLessThan(targetsHandler.indexOf("jsonlite::fromJSON"));
    expect(source).toContain("PLUMBER_EXECUTION_KEY");
    expect(source).toContain("X-SDM-Execution-Signature");
    expect(source).toContain("X-SDM-Execution-Nonce");
    expect(source).toContain("sdm_consume_execution_nonce");
    expect(source).toContain("sdm_constant_time_equal");
  });

  it("publishes current climate resolution as safe scenario metadata", async () => {
    const source = await readFile(resolve(process.cwd(), "../plumber/R/helpers/climate_helpers.R"), "utf8");
    expect(source).toContain("resolution = as.numeric(sdm_default_worldclim_res)");
    expect(source).toContain("resolution = 0.5");
  });
});
