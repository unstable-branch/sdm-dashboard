import { describe, expect, it } from "vitest";
import {
  BATCH_MANIFEST_SCHEMA_VERSION,
  buildBatchManifestContract,
} from "./batch-manifest.js";

describe("buildBatchManifestContract", () => {
  it("emits the stable schema version and core batch manifest shape", () => {
    const manifest = buildBatchManifestContract({
      batch_id: "batch-123",
      generated_at: "2026-05-26T00:00:00Z",
      comparison_ref: "/app/outputs/batches/batch-123/comparison.json",
      comparison: {
        schema: "batch_comparison.v1",
        counts: { total: 2, completed: 2 },
        metrics: {
          by_run: [{ run_id: "run-1", metrics: { auc_mean: 0.91 } }],
          by_species: [],
          by_model: [],
        },
        warnings: [],
      },
      runs: [
        {
          run_id: "run-1",
          species: "Example species",
          model_id: "glm",
          status: "completed",
          manifest_path: "/app/outputs/jobs/run-1/manifest.json",
          manifest: {
            artifacts: [
              {
                key: "suitability_tif",
                path: "outputs/jobs/run-1/suitability.tif",
                kind: "raster",
                media_type: "image/tiff",
              },
            ],
          },
        },
      ],
    });

    expect(manifest.schema_version).toBe(BATCH_MANIFEST_SCHEMA_VERSION);
    expect(manifest.batch_id).toBe("batch-123");
    expect(manifest.run_ids).toEqual(["run-1"]);
    expect(manifest.counts).toMatchObject({
      total: 1,
      completed: 1,
      with_manifest_refs: 1,
      with_artifact_refs: 1,
    });
    expect(manifest.comparison.ref).toEqual({
      key: "comparison",
      path: "/app/outputs/batches/batch-123/comparison.json",
      url: null,
      media_type: "application/json",
    });
    expect(manifest.comparison.summary?.schema).toBe("batch_comparison.v1");
    expect(manifest.children[0]?.manifest_ref?.path).toBe("/app/outputs/jobs/run-1/manifest.json");
    expect(manifest.artifact_refs).toEqual([
      {
        run_id: "run-1",
        key: "suitability_tif",
        path: "outputs/jobs/run-1/suitability.tif",
        kind: "raster",
        media_type: "image/tiff",
      },
    ]);
  });

  it("bounds children and artifact refs without deriving raw output or occurrence rows", () => {
    const manifest = buildBatchManifestContract({
      batch_id: "batch-123",
      comparison: {
        schema: "batch_comparison.v1",
        counts: { total: 60 },
        metrics: {
          by_run: [{ run_id: "run-1", metrics: { auc_mean: 0.8 }, output_files: { raster: "raw.tif" } }],
          occurrence_rows: [{ longitude: 1, latitude: 2 }],
        },
      },
      runs: Array.from({ length: 60 }, (_, runIndex) => ({
        run_id: `run-${runIndex}`,
        status: "completed",
        output_files: { raw_raster: `run-${runIndex}.tif` },
        occurrence_rows: [{ longitude: 1, latitude: 2 }],
        artifacts: Array.from({ length: 30 }, (_, artifactIndex) => ({
          key: `artifact_${artifactIndex}`,
          path: `outputs/jobs/run-${runIndex}/artifact-${artifactIndex}.json`,
        })),
      })),
    });

    expect(manifest.children).toHaveLength(50);
    expect(manifest.children[0]?.artifact_refs).toHaveLength(20);
    expect(manifest.artifact_refs).toHaveLength(200);
    expect(JSON.stringify(manifest)).not.toContain("occurrence_rows");
    expect(JSON.stringify(manifest)).not.toContain("raw.tif");
    expect(JSON.stringify(manifest)).not.toContain("raw_raster");
  });

  it("propagates top-level, comparison, child, and child-error warnings", () => {
    const manifest = buildBatchManifestContract({
      batch_id: "batch-123",
      warnings: ["batch warning"],
      comparison: {
        schema: "batch_comparison.v1",
        warnings: [
          {
            code: "failed_run",
            message: "Run failed: Plumber failed",
            run_id: "run-2",
          },
        ],
      },
      runs: [
        {
          run_id: "run-1",
          status: "completed",
          warnings: [{ code: "manifest_warning", message: "Manifest omitted optional field" }],
        },
        {
          run_id: "run-2",
          status: "failed",
          error: "Plumber failed",
        },
      ],
    });

    expect(manifest.warnings).toEqual([
      {
        code: "warning",
        severity: "warning",
        message: "batch warning",
        run_id: null,
      },
      {
        code: "failed_run",
        severity: "warning",
        message: "Run failed: Plumber failed",
        run_id: "run-2",
      },
      {
        code: "manifest_warning",
        severity: "warning",
        message: "Manifest omitted optional field",
        run_id: "run-1",
      },
      {
        code: "child_error",
        severity: "warning",
        message: "Plumber failed",
        run_id: "run-2",
      },
    ]);
  });
});
