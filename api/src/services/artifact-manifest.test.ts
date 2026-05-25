import { describe, expect, it } from "vitest";
import {
  ManifestAdapterError,
  RUN_MANIFEST_SCHEMA_VERSION,
  normalizeRunManifestResponse,
} from "./artifact-manifest.js";

describe("artifact manifest adapter", () => {
  it("normalizes current Plumber manifest payloads into the stable contract", () => {
    const data = normalizeRunManifestResponse(
      {
        ok: true,
        manifest_path: "/app/outputs/jobs/run-123/manifest.json",
        manifest: {
          run_id: "run-123",
          generated_at: "2026-05-26T00:00:00Z",
          app_version: { r_version: "R version 4.4.0" },
          species: "Acacia mearnsii",
          model: {
            id: "glm",
            parameters: { seed: 123, biovars: [1, 4, 12] },
          },
          data: {
            occurrence_file: "uploads/acacia.csv",
            occurrence_hash: "abc123",
            record_count: 42,
          },
          climate: { source: "worldclim", resolution: 10 },
          validation: { cv_folds: 5, cv_strategy: "random" },
          metrics: { auc_mean: 0.86 },
          output_files: {
            suitability_tif: "outputs/jobs/run-123/suitability.tif",
            report: { path: "outputs/jobs/run-123/report.txt" },
          },
        },
      },
      "run-123",
    );

    expect(data.ok).toBe(true);
    expect(data.schema_version).toBe(RUN_MANIFEST_SCHEMA_VERSION);
    expect(data.manifest_path).toBe("/app/outputs/jobs/run-123/manifest.json");
    expect(data.manifest.run_id).toBe("run-123");
    expect(data.manifest.app_version).toEqual({ r_version: "R version 4.4.0" });
    expect(data.manifest.model.id).toBe("glm");
    expect(data.manifest.output_files?.suitability_tif).toBe("outputs/jobs/run-123/suitability.tif");
    expect(data.manifest.artifacts).toEqual([
      {
        key: "suitability_tif",
        path: "outputs/jobs/run-123/suitability.tif",
        kind: "raster",
        media_type: "image/tiff",
      },
      {
        key: "report",
        path: "outputs/jobs/run-123/report.txt",
        kind: "text",
        media_type: "text/plain",
      },
    ]);
  });

  it("keeps legacy manifest fields bounded when present", () => {
    const longString = "x".repeat(3000);
    const data = normalizeRunManifestResponse(
      {
        ok: true,
        manifest: {
          run_timestamp: "2026-05-26T00:00:00Z",
          model_id: "maxent",
          model_label: "MaxEnt",
          input_file_hash: "hash",
          cleaning_summary: { note: longString },
          output_paths: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`file_${index}`, `file_${index}.csv`])),
        },
      },
      "fallback-run",
    );

    expect(data.run_id).toBe("fallback-run");
    expect(data.generated_at).toBe("2026-05-26T00:00:00Z");
    expect(data.manifest.model).toMatchObject({ id: "maxent", label: "MaxEnt" });
    expect(data.manifest.data?.cleaning_summary).toEqual({ note: `${"x".repeat(2045)}...` });
    expect(data.manifest.artifacts).toHaveLength(50);
  });

  it("rejects payloads without a manifest object", () => {
    expect(() => normalizeRunManifestResponse({ ok: true }, "run-123")).toThrow(ManifestAdapterError);
  });
});
