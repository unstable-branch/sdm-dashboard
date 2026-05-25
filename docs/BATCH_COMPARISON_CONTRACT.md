# Batch Comparison Contract

## Endpoint

`GET /api/v1/sdm/batches/:batchId`

The endpoint keeps its existing batch status fields and adds a bounded
`comparison` object for notebooks, scripted clients, and later MCP tools.

## Response Addition

```json
{
  "comparison": {
    "schema": "batch_comparison.v1",
    "counts": {
      "total": 3,
      "queued": 0,
      "running": 0,
      "completed": 2,
      "failed": 1,
      "cancelled": 0,
      "with_metrics": 2,
      "missing_metrics": 1
    },
    "metrics": {
      "by_run": [
        {
          "run_id": "run-1",
          "species": "Example species",
          "model_id": "glm",
          "status": "completed",
          "metrics": {
            "auc_mean": 0.91,
            "tss_mean": 0.74
          }
        }
      ],
      "by_species": [
        {
          "key": "Example species",
          "runs": 1,
          "with_metrics": 1,
          "metrics": {
            "auc_mean": {
              "count": 1,
              "min": 0.91,
              "max": 0.91,
              "mean": 0.91
            }
          }
        }
      ],
      "by_model": []
    },
    "warnings": [
      {
        "code": "failed_run",
        "severity": "warning",
        "message": "Run failed: Plumber failed",
        "run_id": "run-2",
        "species": "Example species",
        "model_id": "rf"
      }
    ]
  }
}
```

## Safety Boundaries

- `comparison.metrics` includes numeric scalar metrics only.
- Top-level numeric metrics are included directly. One nested object level is
  flattened with dot keys, such as `validation.cbi_mean`.
- Arrays, raster paths, occurrence rows, file paths, and other non-numeric
  payloads are omitted.
- At most 40 metric keys are emitted per run, and metric keys are normalized to
  bounded ASCII-ish identifiers.

## Warning Codes

- `failed_run`: child run failed.
- `cancelled_run`: child run was cancelled before comparable metrics were available.
- `incomplete_run`: child run is queued or running.
- `missing_metrics`: completed child run has no metrics payload.
- `non_numeric_metrics`: completed child run has a metrics payload, but no numeric
  scalar comparison metrics.

## Compatibility Notes

Existing top-level batch fields are preserved:

- `batch_id`
- `total`
- `counts_by_status`
- `active`
- `completed`
- `failed`
- `cancelled`
- `runs`
- `created_at`
- `started_at`
- `completed_at`
- `latest_error`
- `warnings`

The per-run entries in `runs[]` remain status summaries and do not expose raw
metrics or output files. Clients that need artifacts should use the run manifest
or result download endpoints explicitly.
