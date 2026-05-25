# Agentic API Worker Waves

This document turns `AGENTIC_API_AND_MCP_PLAN.md` into delegable work. The
intent is to keep workers on narrow, reviewable slices while the main maintainer
keeps architecture, integration, and release judgment in one place.

## Phase 1 - Contract Foundation

Goal: make the existing Hono API visible and stable enough for scripts,
notebooks, and later MCP.

Completed initial worker wave:

| Worker | Scope | Output | Verification |
| --- | --- | --- | --- |
| API inventory | Read current Hono route files and document route groups, auth, sync/async behavior, and machine-interface gaps. | `docs/API_CONTRACT_INVENTORY.md` | `git diff --check` |
| OpenAPI baseline | Add a first `/api/v1/openapi.json` endpoint without route rewrites. | `api/src/openapi.ts`, `api/src/index.ts`, optional focused test | API typecheck and focused Vitest |
| API workflow examples | Write curl/notebook-style workflow examples that expose current gaps before MCP exists. | `docs/examples/AGENTIC_API_WORKFLOW.md` | `git diff --check` |

Main-seat integration tasks:

- Review worker output against the actual route files.
- Keep the OpenAPI baseline honest: useful now, but clearly not the final
  generated schema system.
- Add links from `SPEC.md` or release docs only after the artifacts are worth
  maintaining.
- Run focused Node checks before committing.

## Phase 2 - Workflow Objects

Goal: replace fragile "files plus run IDs" workflows with stable API objects.

Completed so far:

- Added `runs.batch_id` persistence plus `GET /api/v1/sdm/batches/:batchId`
  aggregate status.
- Added occurrence dataset and idempotency-key tables/service helpers.
- Added occurrence dataset list/register/get routes and dataset IDs on
  upload, GBIF save, DwCA parse, and synchronous clean responses.
- Wired `Idempotency-Key` replay/conflict/processing behavior into SDM run,
  SDM batch, occurrence clean, and climate download routes.
- Added pure `study_area.v1`, `environment_scenario_summary.v1`, and
  `environment_set_summary.v1` schema helpers; route wiring is intentionally
  deferred until a specific endpoint needs them.

Next delegable tasks:

- Extend batch parent semantics beyond the initial `runs.batch_id` aggregate
  if later work needs owner metadata, server-side comparison filters, or
  stronger lifecycle/audit behavior.
- Add route-specific partial-failure hardening where downstream work can create
  side effects before an error is returned.

Keep in main:

- Decide the minimal object model.
- Prevent schema sprawl.
- Decide whether migrations are required or whether existing tables are enough
  for the first beta.

## Phase 3 - Async Job Hardening

Goal: make long-running jobs reliable from code without browser state.

Worker B status:

- Added `docs/ASYNC_JOB_STATUS_CONTRACT.md` with the current async/status
  inventory and the first normalized polling contract.
- Implemented the normalized polling response additively for
  `GET /api/v1/jobs/:jobId` only.
- Kept existing queue response fields and did not touch results routes or
  manifest behavior.

Delegable tasks:

- Continue inventorying current status shapes across model runs, climate downloads, clean
  jobs, BullMQ jobs, and Plumber status.
- Extend or revise the normalized job status response after main-seat vocabulary
  review.
- Implement polling-friendly status response for additional route groups only
  after ID semantics are settled.
- Add cancellation semantics tests for batch parent and child runs.
- Add pagination/filtering tests for run history.

Keep in main:

- Choose final status/error vocabulary.
- Decide rate limit and concurrency policy.
- Review cancellation behavior for destructive side effects.

## Phase 4 - Artifact And Provenance Manifests

Goal: make outputs reproducible and safe for LLM/notebook summaries.

Completed so far:

- Added a Hono-side `RunManifest` v1 adapter for
  `GET /api/v1/results/:id/manifest`, wrapping current Plumber manifests into
  bounded fields while retaining `ok`, `manifest_path`, and `manifest.*`
  compatibility aliases.
- Added `batch_comparison.v1` summaries to
  `GET /api/v1/sdm/batches/:batchId`, with numeric scalar metrics grouped by
  run/species/model and warnings for failed/incomplete/missing-metric runs.

Delegable tasks:

- Inventory existing `results`, `manifest`, report, and output-file behavior.
- Define `BatchManifest` schema and tests.
- Add docs for what is safe to summarize versus what requires explicit
  download.

Keep in main:

- Decide scientific provenance fields that must be present.
- Review privacy/data-leak boundaries.

## Phase 5 - API Examples And SDK Candidate

Goal: prove the API is usable before building MCP.

Delegable tasks:

- Convert curl workflow into an R notebook example.
- Convert curl workflow into a Python notebook/script example.
- Add a tiny smoke script for API-only happy path if the local stack can run.
- Identify repeated client code that would justify a tiny SDK.

Keep in main:

- Decide whether an SDK is worth owning.
- Keep examples aligned with real API behavior.

## Phase 6 - MCP Adapter

Goal: expose only curated workflow actions through MCP after the API is stable.

Delegable tasks:

- Map each MCP tool to one documented API workflow.
- Build a read-only MCP prototype for project/run/batch summaries.
- Add bounded response helpers for counts, warnings, IDs, and artifact links.
- Add local client config examples.

Keep in main:

- Tool naming and shape.
- Security model.
- Public release timing.

## Phase 7 - Security, Quotas, And Audit

Goal: make machine access safe enough for real users.

Delegable tasks:

- Inventory current API-key model and route authorization.
- Design scope fields for read/write/run/batch/admin keys.
- Add audit event schema proposal.
- Add quota/concurrency test cases.
- Add redaction tests for manifests/logs/errors.

Keep in main:

- Security policy.
- Migration timing.
- Any public documentation claims.
