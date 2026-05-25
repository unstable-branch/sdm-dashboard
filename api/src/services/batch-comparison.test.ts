import { describe, expect, it } from "vitest";
import { buildBatchComparisonSummary } from "./batch-comparison.js";

describe("buildBatchComparisonSummary", () => {
  it("summarizes numeric metrics by run, species, and model", () => {
    const summary = buildBatchComparisonSummary([
      {
        id: "run-1",
        species: "Species A",
        model_id: "glm",
        status: "completed",
        metrics: { auc_mean: 0.8, tss_mean: 0.7, raw_path: "/tmp/raster.tif" },
      },
      {
        id: "run-2",
        species: "Species A",
        model_id: "rf",
        status: "completed",
        metrics: { auc_mean: 0.9, validation: { cbi_mean: 0.4 } },
      },
    ]);

    expect(summary.schema).toBe("batch_comparison.v1");
    expect(summary.counts).toEqual({
      total: 2,
      queued: 0,
      running: 0,
      completed: 2,
      failed: 0,
      cancelled: 0,
      with_metrics: 2,
      missing_metrics: 0,
    });
    expect(summary.metrics.by_run).toEqual([
      {
        run_id: "run-1",
        species: "Species A",
        model_id: "glm",
        status: "completed",
        metrics: { auc_mean: 0.8, tss_mean: 0.7 },
      },
      {
        run_id: "run-2",
        species: "Species A",
        model_id: "rf",
        status: "completed",
        metrics: { auc_mean: 0.9, "validation.cbi_mean": 0.4 },
      },
    ]);
    expect(summary.metrics.by_species).toEqual([
      {
        key: "Species A",
        runs: 2,
        with_metrics: 2,
        metrics: {
          auc_mean: { count: 2, min: 0.8, max: 0.9, mean: 0.8500000000000001 },
          tss_mean: { count: 1, min: 0.7, max: 0.7, mean: 0.7 },
          "validation.cbi_mean": { count: 1, min: 0.4, max: 0.4, mean: 0.4 },
        },
      },
    ]);
    expect(summary.metrics.by_model).toEqual([
      {
        key: "glm",
        runs: 1,
        with_metrics: 1,
        metrics: {
          auc_mean: { count: 1, min: 0.8, max: 0.8, mean: 0.8 },
          tss_mean: { count: 1, min: 0.7, max: 0.7, mean: 0.7 },
        },
      },
      {
        key: "rf",
        runs: 1,
        with_metrics: 1,
        metrics: {
          auc_mean: { count: 1, min: 0.9, max: 0.9, mean: 0.9 },
          "validation.cbi_mean": { count: 1, min: 0.4, max: 0.4, mean: 0.4 },
        },
      },
    ]);
    expect(summary.warnings).toEqual([]);
  });

  it("emits low-quality warnings without exposing non-numeric payloads", () => {
    const summary = buildBatchComparisonSummary([
      {
        id: "run-1",
        species: "Species A",
        model_id: "glm",
        status: "completed",
        metrics: { raster: "/tmp/raster.tif", occurrence_rows: [{ x: 1 }] },
      },
      {
        id: "run-2",
        species: "Species B",
        model_id: "rf",
        status: "failed",
        metrics: null,
        error: "Plumber failed",
      },
      {
        id: "run-3",
        species: "Species C",
        model_id: "gam",
        status: "running",
        metrics: null,
      },
    ]);

    expect(summary.counts.with_metrics).toBe(0);
    expect(summary.counts.missing_metrics).toBe(3);
    expect(summary.metrics.by_run).toEqual([]);
    expect(summary.warnings.map((warning) => warning.code)).toEqual([
      "non_numeric_metrics",
      "failed_run",
      "incomplete_run",
    ]);
    expect(JSON.stringify(summary)).not.toContain("raster.tif");
    expect(JSON.stringify(summary)).not.toContain("occurrence_rows");
  });
});
