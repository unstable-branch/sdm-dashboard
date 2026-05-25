# API Contract Inventory (Current Hono API)

## Purpose
This inventory is the contract baseline for agentic clients (notebooks, scripted workflows, and later MCP adapters). It captures what the API actually exposes today, where contracts are already usable, and where instability or ambiguity still exists before freezing an MCP-facing interface.

Primary sources:
- `api/src/index.ts`
- `api/src/routes/auth.ts`
- `api/src/routes/projects.ts`
- `api/src/routes/sdm.ts`
- `api/src/routes/occurrences.ts`
- `api/src/routes/climate.ts`
- `api/src/routes/ecology.ts`
- `api/src/routes/diagnostics.ts`
- `api/src/routes/results.ts`
- `api/src/routes/jobs.ts`

## Route Groups

### Auth (`/api/v1/auth`)
- Main routes: `POST /register`, `POST /login`, `GET /me`, `POST|GET|DELETE /api-keys`, `POST /api-keys/:id/rotate` (`api/src/routes/auth.ts`).
- Auth mode: mixed.
  - Public: `register`, `login`.
  - Auth-required: `me`, API key CRUD/rotate.
- Sync/async: synchronous DB + JWT/API key operations.
- Current machine-interface notes:
  - Clear bootstrap flow for human and agent auth.
  - Rate limits on register/login/key create/key rotate.
  - Token lifetime appears fixed (24h JWT), no refresh contract surfaced.

### Projects (`/api/v1/projects`)
- Main routes: `GET /`, `POST /`, `PUT /:id`, `GET /:id`, member management at `/:id/members` (`api/src/routes/projects.ts`).
- Auth mode: auth required for all routes (`projectRoutes.use("*", authMiddleware)`).
- Sync/async: synchronous DB CRUD.
- Current machine-interface notes:
  - Project-scoped access checks exist for mutation paths.
  - Response shapes are straightforward but not schema-versioned.

### SDM (`/api/v1/sdm`)
- Main routes: `POST /run`, `POST /batch`, `GET /batches/:batchId`, `GET /runs`, `GET /status/:jobId`, `POST /cancel/:jobId`, `POST /cancel-all`, `DELETE /runs/delete/:runId`, `POST /runs/clear-all`, `GET /models`, `GET /config/defaults`, `GET /future/scenarios` (`api/src/routes/sdm.ts`).
- Auth mode: mixed by route middleware.
  - Auth-required: run, batch, batch status, cancel/cancel-all, runs, status, delete/clear-all.
  - Optional auth applied globally after protected paths.
- Sync/async: mixed.
  - `POST /run` supports `async=true` queue mode and non-async immediate plumber start mode.
  - `POST /batch` starts multiple runs and returns a batch envelope; `GET /batches/:batchId` returns aggregate child-run status plus a bounded `comparison` summary (`batch_comparison.v1`).
- Current machine-interface notes:
  - Strong input validation for model config (`modelConfigSchema`).
  - Status lifecycle exists (`queued|running|completed|failed|cancelled`), but identifier semantics are mixed (`run.id` returned as `jobId` in async run response).
  - `POST /cancel/:jobId` is run-centric: it cancels child runs by run ID,
    not batch parents by `batch_id`. Batch parent cancellation is not a
    separate route contract today.
  - `GET /status/:jobId` keeps the existing run-centric fields and appends a
    normalized `workflow_status.v1` polling layer with `run_id`, `workflow_id`,
    `terminal`, `progress_percent`, and `poll_after_ms`; `workflow_id` is the
    existing run ID, not a queue or Plumber ID.
  - Some endpoints degrade to success-with-warning behavior when backing services fail (`GET /runs` fallback 200).
  - Batch comparison summaries expose numeric scalar metrics by run/species/model and low-quality warnings, while omitting raw raster, occurrence, and output-file payloads. See `docs/BATCH_COMPARISON_CONTRACT.md`.

### Data / Occurrences (`/api/v1/data`)
- Main routes: occurrence dataset identity endpoints under `/occurrence-datasets*`, upload/clean/GBIF/DwCA under `/occurrences/*`, plus species endpoints `/species`, `/species/:id`, `/species/:id/occurrences` (`api/src/routes/occurrences.ts`).
- Auth mode: auth required for all routes (`dataRoutes.use("*", authMiddleware)`).
- Sync/async: mixed.
  - Upload/GBIF search/save/DwCA are synchronous request-response.
  - Clean supports async queue (`body.async === true`).
- Current machine-interface notes:
  - Handles file-based workflows and DB persistence of cleaned occurrences.
  - Occurrence dataset identity now has stable project-scoped list/register/get routes.
  - Upload, GBIF save, DwCA parse, and synchronous clean attach stable dataset IDs when file outputs exist while retaining existing file path/file ID aliases.
  - Broader artifact identity is still not normalized outside occurrence datasets.

### Climate (`/api/v1/climate`)
- Main routes: `GET /scenarios`, `GET /check`, `POST /download`, `POST /delete/:scenarioId`, `GET /status/:jobId` (`api/src/routes/climate.ts`).
- Auth mode: mixed.
  - Auth-required: `download`, `delete`.
  - `optionalAuth` on remaining routes.
- Sync/async: mixed.
  - `download` is async queue-first.
  - `check/scenarios/status` are synchronous reads/proxy calls.
- Current machine-interface notes:
  - Explicit 503 behavior when Redis queue unavailable for downloads.
  - `scenarios` cached (`longCache`), useful for repeated agent fetches.

### Ecology (`/api/v1/ecology`)
- Main routes: `GET /:runId`, `GET /:runId/eoo-aoo`, `GET /:runId/aoa`, `GET /:runId/report` (`api/src/routes/ecology.ts`).
- Auth mode: currently no auth middleware applied in this router.
- Sync/async: synchronous proxy to plumber-derived outputs.
- Current machine-interface notes:
  - Simple route shape for downstream analysis.
  - Missing explicit access guard compared with project-scoped routes.

### Diagnostics (`/api/v1/diagnostics`)
- Main routes: `GET /vif/:runId`, `/response-curves/:runId`, `/importance/:runId`, `/cbi/:runId`, `/mess/:runId`, `/summary/:runId` (`api/src/routes/diagnostics.ts`).
- Auth mode: `optionalAuth` with rate limit.
- Sync/async: synchronous reads/proxy calls.
- Current machine-interface notes:
  - Predictable path family by diagnostic type.
  - Access model is looser than results/data/project surfaces.

### Results (`/api/v1/results`)
- Main routes: `GET /file/:filePath`, `GET /:id`, `GET /:id/report.txt`, `GET /:id/script`, `GET /:id/manifest` (`api/src/routes/results.ts`).
- Auth mode: auth required for all routes (`resultsRoutes.use("*", authMiddleware)`), with per-run/project checks.
- Sync/async: synchronous retrieval/streaming and plumber proxy calls for script/manifest.
- Current machine-interface notes:
  - Strong run access checks and path confinement for file retrieval.
  - `manifest` is now normalized at the Hono boundary into `run_manifest.v1`
    with bounded `model`, `data`, `climate`, `validation`, `metrics`,
    `output_files`, and `artifacts` fields while preserving current Plumber
    compatibility fields (`ok`, `manifest_path`, `manifest.run_id`, etc.).

### Jobs (`/api/v1/jobs`)
- Main routes: `GET /sse`, `GET /:jobId`, `POST /:jobId/cancel` (`api/src/routes/jobs.ts`).
- Auth mode: currently no auth middleware in this router.
- Sync/async: async monitoring/cancellation interface over queue; SSE for live updates.
- Current machine-interface notes:
  - `GET /:jobId` now retains the queue fields (`id`, `state`, `progress`, `result`, `failedReason`) and adds a polling-friendly normalized layer: `status`, `progress_percent`, `terminal`, `poll_after_ms`, and `error`.
  - The normalized route maps BullMQ states into `queued|running|completed|failed|cancelled|unknown`; see `docs/ASYNC_JOB_STATUS_CONTRACT.md`.
  - Useful real-time event stream (`job-update`) for agents/UI.
  - Job visibility/cancel surface is global unless externally gated.

### Health / Ready (`/health`, `/ready`)
- Main routes: `GET /health`, `GET /ready` (`api/src/index.ts`).
- Auth mode: public.
- Sync/async: synchronous health/readiness snapshots.
- Current machine-interface notes:
  - Health returns service status envelope (`plumber`, `redis`).
  - Ready exposes `status` + `checks` for plumber, database, and storage bucket availability.

## Current Strengths for Agentic/API Work
- Clear route grouping and versioned API prefixes (`/api/v1/*`) from a single mount point (`api/src/index.ts`).
- JWT + API key support for machine authentication flows.
- Existing async workflow primitives: queue-backed jobs, run status polling, and SSE job updates.
- Input validation already present on core SDM run configs (`modelConfigSchema`), reducing malformed task submissions.
- Project-scoped run/species filtering exists on key data/results endpoints.

## Gaps to Close Before MCP
- Stable schemas/OpenAPI:
  - A baseline OpenAPI document exists, but schemas are still intentionally partial and should be tightened endpoint-by-endpoint.
  - Several endpoints pass through upstream plumber payloads directly.
- Idempotency:
  - `Idempotency-Key` support exists on expensive mutation routes: SDM run, SDM batch, occurrence clean, and climate download.
  - Remaining risk: partial side effects from downstream failures still need route-specific hardening where operations are not transactional.
- Workflow objects:
  - Study-area and environment-set summary schemas now have a conservative
    pure TypeScript/Zod foundation in `api/src/services/workflow-object-schemas.ts`
    and are documented in `docs/WORKFLOW_OBJECT_SCHEMAS.md`.
  - Run/job/batch are represented by mixed ad hoc envelopes instead of one stable workflow resource shape.
- Batch parent semantics:
  - `batch_id` is persisted on child runs and has an aggregate status endpoint with additive comparison summaries, but there is not yet a separate batch resource with owner metadata, idempotency, or server-side comparison filters.
- Artifact manifests:
  - Occurrence data now has stable dataset IDs, and run manifests now expose a
    bounded Hono-side `artifacts[]` list derived from Plumber output files.
    Broader artifact/file identity is still split between local paths,
    `file_id`, and upstream output conventions outside the run-manifest route.
- Status/error shape:
  - Error/status payloads vary by route (`error`, `message`, `warning`, pass-through objects), with mixed 200/4xx/5xx fallback behavior.
  - `GET /api/v1/jobs/:jobId` and `GET /api/v1/sdm/status/:jobId` now have
    additive normalized polling fields; batch status and Plumber status
    pass-throughs are not yet normalized.
- Scopes/quotas/audit:
  - Auth exists, but route-level machine scopes, quota semantics, and audit event contract are not formalized.

## Suggested Phase 1 Tasks (Small Tickets)
1. Continue tightening `GET /api/v1/openapi.json` schemas from broad placeholders into request/response contracts for each route group.
2. Define shared envelope schemas in API code/docs: `ApiError`, `WorkflowStatus`, `Pagination`, `ArtifactRef`.
3. Normalize SDM run submission response shape to always return `{ runId, workflowId, status }` (retain compatibility alias temporarily).
4. Add route-specific partial-failure hardening and retry guidance for idempotent SDM batch/run operations.
5. Wire study-area and environment-set summaries only where a specific route
   needs them; keep the helpers pure until then.
6. Extend the current `runs.batch_id` aggregate into a fuller batch resource only if owner metadata, idempotency, or long-lived batch history needs require it.
7. Extend artifact manifest coverage to batch manifests and document which
   artifact fields are safe for LLM/notebook summaries versus explicit
   downloads.
8. Standardize error mapping middleware so all handlers emit a single error contract with stable `code`, `message`, and optional `details`.
9. Add explicit auth policy pass for currently open operational routes (`/api/v1/jobs/*`, `/api/v1/ecology/*`, selected diagnostics) and document intended machine scope.
10. Add readiness checks for DB/storage in `/ready` to match published readiness fields.
