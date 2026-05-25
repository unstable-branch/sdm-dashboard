# Async Job Status Contract

## Purpose
This is the Phase 3 baseline for making long-running API work pollable by code.
It records the status shapes that exist today and the smallest normalized
response now implemented for the generic jobs route group.

## Current Async/Status Shapes

### SDM model runs
- `POST /api/v1/sdm/run` with `async: true` creates a `runs` row and returns
  `{ jobId, queuedAt }`, where `jobId` is the run ID, not the BullMQ job ID.
- `GET /api/v1/sdm/status/:jobId` reads the run row by ID and returns
  run-centric fields: `id`, `status`, `species`, `model_id`, `started_at`,
  `completed_at`, `error`, `metrics`, `output_files`, `progress_log`, and
  `config`.
- Run statuses are persisted as `queued`, `running`, `completed`, `failed`, or
  `cancelled`.

### SDM batches
- `POST /api/v1/sdm/batch` returns `{ batch_id, job_ids, total, message }`,
  where `job_ids` are child run IDs.
- `GET /api/v1/sdm/batches/:batchId` returns aggregate counts and child run
  summaries with `counts_by_status`, `active`, `completed`, `failed`,
  `cancelled`, `runs`, timestamps, `latest_error`, and `warnings`.

### Occurrence clean jobs
- `POST /api/v1/data/occurrences/clean` with `async: true` returns
  `{ jobId, status: "queued" }`, where `jobId` is the BullMQ job ID.
- Follow-up polling uses the generic jobs route, not a data-specific status
  route.

### Climate download jobs
- `POST /api/v1/climate/download` returns `{ jobId, status: "queued" }`, where
  `jobId` is the BullMQ job ID.
- `GET /api/v1/climate/status/:jobId` proxies the Plumber climate status shape
  when a Plumber-side job ID is available, while generic queue status remains
  available through `/api/v1/jobs/:jobId`.

### Generic BullMQ jobs
- Before this change, `GET /api/v1/jobs/:jobId` returned the queue helper shape:
  `id`, `state`, `progress`, `result`, and `failedReason`.
- SSE events under `GET /api/v1/jobs/sse` emit `job-update` events with `id`,
  `state`, `progress`, optional `type`, `result`, `logs`, and `failedReason`.

### Plumber statuses
- Model and climate Plumber status payloads are upstream-defined pass-through
  objects. Observed fields include `status`, `metrics`, `output_files`,
  `progress_log`, `error`, `failed_vars`, and `completed_at`.

## Normalized Jobs Polling Response
`GET /api/v1/jobs/:jobId` now keeps every existing queue field and appends a
small normalized polling layer:

```json
{
  "id": "job-123",
  "state": "waiting",
  "progress": 25,
  "result": null,
  "failedReason": null,
  "status": "queued",
  "progress_percent": 25,
  "terminal": false,
  "poll_after_ms": 2000,
  "error": null
}
```

Added fields:

| Field | Meaning |
| --- | --- |
| `status` | Normalized lifecycle value: `queued`, `running`, `completed`, `failed`, `cancelled`, or `unknown`. |
| `progress_percent` | Numeric 0-100 progress when the queue progress is numeric; otherwise `null`. |
| `terminal` | `true` for `completed`, `failed`, or `cancelled`; otherwise `false`. |
| `poll_after_ms` | Suggested client polling delay for non-terminal jobs; `null` for terminal jobs. |
| `error` | Failed job error string from `failedReason`, falling back to `result.error`; otherwise `null`. |

Queue state mapping:

| BullMQ/legacy `state` | Normalized `status` |
| --- | --- |
| `waiting`, `waiting-children`, `delayed`, `prioritized`, `paused` | `queued` |
| `active` | `running` |
| `completed` | `completed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |
| anything else | `unknown` |

## Compatibility Decision
The route-group implementation is intentionally additive. It does not change
queue storage, SSE event shape, SDM run polling, climate status proxying,
occurrence clean submission, or result/manifest routes.

The final cross-route vocabulary still belongs to main-seat integration because
run IDs, queue job IDs, and Plumber job IDs are not yet one stable workflow
resource. The generic jobs route is the safe first place to expose a normalized
polling surface because it already returns one queue status object and has no
project/run database side effects.
