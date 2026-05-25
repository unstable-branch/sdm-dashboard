# Batch Manifest Contract

## Purpose

`batch_manifest.v1` is a pure API-side contract for already-fetched batch
status, comparison, and run-manifest-like summaries. It is intended for
notebooks, scripted clients, and later MCP tools that need a bounded batch
overview without downloading raw model outputs.

No route is added by this contract. Route wiring can wrap the pure builder later
when the API owner decides where the batch manifest belongs.

## Builder

`api/src/services/batch-manifest.ts` exports:

- `BATCH_MANIFEST_SCHEMA_VERSION`
- `buildBatchManifestContract(input)`

The builder accepts:

- `batch_id`
- already-fetched child run summaries
- optional aggregate counts
- optional `batch_comparison.v1` summary and/or comparison ref
- optional warnings
- optional provenance refs

## Shape

```json
{
  "schema_version": "batch_manifest.v1",
  "batch_id": "batch-123",
  "generated_at": "2026-05-26T00:00:00Z",
  "run_ids": ["run-1", "run-2"],
  "counts": {
    "total": 2,
    "queued": 0,
    "running": 0,
    "completed": 1,
    "failed": 1,
    "cancelled": 0,
    "active": 0,
    "with_manifest_refs": 2,
    "with_artifact_refs": 1
  },
  "comparison": {
    "ref": {
      "key": "comparison",
      "path": "/app/outputs/batches/batch-123/comparison.json",
      "url": null,
      "media_type": "application/json"
    },
    "summary": {
      "schema": "batch_comparison.v1",
      "counts": {
        "total": 2,
        "completed": 1,
        "failed": 1
      },
      "metrics": {
        "by_run": [
          {
            "run_id": "run-1",
            "metrics": {
              "auc_mean": 0.91
            }
          }
        ]
      },
      "warnings": []
    }
  },
  "children": [
    {
      "run_id": "run-1",
      "species": "Example species",
      "model_id": "glm",
      "status": "completed",
      "manifest_ref": {
        "key": "manifest",
        "path": "/app/outputs/jobs/run-1/manifest.json",
        "url": null,
        "media_type": "application/json"
      },
      "artifact_refs": [
        {
          "run_id": "run-1",
          "key": "suitability_tif",
          "path": "outputs/jobs/run-1/suitability.tif",
          "kind": "raster",
          "media_type": "image/tiff"
        }
      ],
      "warnings": []
    }
  ],
  "artifact_refs": [
    {
      "run_id": "run-1",
      "key": "suitability_tif",
      "path": "outputs/jobs/run-1/suitability.tif",
      "kind": "raster",
      "media_type": "image/tiff"
    }
  ],
  "warnings": [
    {
      "code": "failed_run",
      "severity": "warning",
      "message": "Run failed: Plumber failed",
      "run_id": "run-2"
    }
  ],
  "provenance": {
    "source": "already_fetched_summaries",
    "generated_at": "2026-05-26T00:00:00Z",
    "input_refs": []
  }
}
```

## Bounds

- At most 50 child runs are emitted.
- At most 20 artifact refs are emitted per child.
- At most 200 flattened artifact refs are emitted across the batch.
- At most 100 warnings are emitted.
- Inline comparison summaries are sanitized and depth/key/array/string bounded.

## Safety Boundaries

- The builder does not fetch data, read files, or call Plumber.
- It does not add a route.
- It does not derive artifacts from raw `output_files`; callers must pass
  already-normalized manifest artifact refs.
- Raw rasters, occurrence rows, output-file maps, payloads, and raw data blobs
  are not included in inline summaries.
- Raster outputs may appear only as artifact references with path/media-type
  metadata, not as embedded raster contents or occurrence records.
