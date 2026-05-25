# Async Job Status Contract

## Purpose
This is the Phase 3 baseline for making long-running API work pollable by code.
It records the status shapes that exist today and the smallest normalized
responses now implemented for the generic jobs route group and SDM run status.

## Current Async/Status Shapes

### SDM model runs
- `POST /api/v1/sdm/run` with `async: true` creates a `runs` row and returns
  `{ jobId, queuedAt }`, where `jobId` is the run ID, not the BullMQ job ID.
- `GET /api/v1/sdm/status/:jobId` reads the run row by ID and returns
  run-centric fields: `id`, `status`, `species`, `model_id`, `started_at`,
  `completed_at`, `error`, `metrics`, `output_files`, `progress_log`, and
  `config`.
- The same response now appends the additive `workflow_status.v1` layer:
  `status_schema`, `run_id`, `workflow_id`, `terminal`, `progress_percent`,
  and `poll_after_ms`. The existing `status` and `error` fields are retained
  and normalized to the same lifecycle/string-or-null vocabulary used by the
  layer.
- Run statuses are persisted as `queued`, `running`, `completed`, `failed`, or
  `cancelled`.

### SDM batches
- `POST /api/v1/sdm/batch` returns `{ batch_id, job_ids, total, message }`,
  where `job_ids` are child run IDs.
- `GET /api/v1/sdm/batches/:batchId` returns aggregate counts and child run
  summaries with `counts_by_status`, `active`, `completed`, `failed`,
  `cancelled`, `runs`, timestamps, `latest_error`, and `warnings`.
- `POST /api/v1/sdm/cancel/:jobId` cancels a child run by run ID. It does not
  currently accept the batch parent `batch_id`; parent cancellation remains
  outside this route's compatibility contract.
- API-side cancellation records cancelled runs as terminal by setting
  `completed_at`, allowing all-terminal batch aggregates to derive
  `completed_at` when every child has a terminal timestamp.

### Occurrence clean jobs
- `POST /api/v1/data/occurrences/clean` with `async: true` returns
  `{ jobId, status: "queued" }`, where `jobId` is the BullMQ job ID.
- Follow-up polling uses the generic jobs route, not a data-specific status
  route.

### Climate download jobs
- `POST /api/v1/climate/download` returns `{ jobId, status: "queued" }`, where
  `jobId` is the BullMQ job ID.
- `GET /api/v1/climate/status/:jobId` proxies the Plumber climate status shape
  for authenticated callers when a Plumber-side job ID is available, while
  generic queue status remains available through `/api/v1/jobs/:jobId`.

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

## Normalized SDM Workflow Status Response
`GET /api/v1/sdm/status/:jobId` keeps the existing run status fields and appends
a workflow status layer without changing identifier semantics. The `:jobId`
path value is still matched against `runs.id`; `run_id` and `workflow_id` both
use that same run ID.

```json
{
  "id": "run-123",
  "status": "running",
  "species": "Acacia mearnsii",
  "model_id": "glm",
  "started_at": "2026-05-26T00:00:00.000Z",
  "completed_at": null,
  "error": null,
  "metrics": null,
  "output_files": null,
  "progress_log": [],
  "config": {},
  "status_schema": "workflow_status.v1",
  "run_id": "run-123",
  "workflow_id": "run-123",
  "terminal": false,
  "progress_percent": null,
  "poll_after_ms": 2000
}
```

Field rules:

| Field | Meaning |
| --- | --- |
| `status_schema` | Fixed schema marker: `workflow_status.v1`. |
| `run_id` | Existing dashboard run ID (`runs.id`). |
| `workflow_id` | Same value as `run_id` for this first SDM workflow status layer. |
| `status` | Existing run lifecycle value, or terminal Plumber lifecycle when the route already refreshed it. |
| `terminal` | `true` for `completed`, `failed`, or `cancelled`; otherwise `false`. |
| `progress_percent` | Numeric 0-100 progress if already available from an existing status payload; `100` for completed runs; otherwise `null`. |
| `poll_after_ms` | Suggested client polling delay for non-terminal runs; `null` for terminal runs. |
| `error` | Existing error field normalized to a string or `null`. |

## Compatibility Decision
The route-group implementation is intentionally additive. It does not change
queue storage, SSE event shape, climate status proxying, occurrence clean
submission, or result/manifest routes.

The final cross-route vocabulary still belongs to main-seat integration because
run IDs, queue job IDs, and Plumber job IDs are not yet one stable workflow
resource. The SDM workflow layer therefore keeps `workflow_id` equal to the
existing run ID instead of introducing a new queue or Plumber identifier.
