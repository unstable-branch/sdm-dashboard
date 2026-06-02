# Issue #5 Recommendation: Reproducibility Strategy for SDM Runtime

Pacey's request is to evaluate Issue #5 after PR #10 (dev), not implement it.
This document reviews the current Hono/API + BullMQ + Plumber runtime against
Nextflow and Snakemake for reproducible SDM pipeline operation and recommends
next steps.

## Current implementation (as of `phase4/workflow-runtime-20260602`)

- API entry: `api/src/routes/sdm.ts` and other workflow routes still perform orchestration and auth, then either call Plumber directly (sync) or enqueue work via `enqueueSdmJob` (async).
- Queue execution: `api/src/services/queue.ts` uses BullMQ with background `Worker` handlers and polling loops (`getModelStatus`, `getClimateStatus`, etc.).
- Plumber runtime: `plumber/R/plumber.R` submits model runs with concurrency caps, then spawns `plumber/R/run_model_background.R` via `callr::r_bg`.
- Status propagation: `api/src/services/plumber-sync.ts` also polls Plumber run status every 5s for running rows and updates DB/SSE.
- Reproducibility artifacts:
  - per-run `manifest.json` from `GET /api/v1/output/manifest/<run_id>` and
    `R/output/script_export.R` script output export;
  - run `meta.json` and `progress.log` in `outputs/jobs/<run_id>`, including
    timestamps, CPU/memory, error codes, occurrence hash, and model config.

This gives **good operational traceability for each run**, but pipeline
resumability is limited because the runtime is API/request-driven and not fully
declared as a DAG.

## How this differs from Nextflow / Snakemake

- **Scheduling model**
  - Current runtime: imperative controller code (routes + worker loops) with
    explicit polling and cross-service coordination.
  - Nextflow/Snakemake: declarative DAG execution graph from dependencies, where
    task outputs/inputs determine when each step runs.
- **Resumability after partial failure**
  - Current runtime: if a worker or process crashes, queue state and job status are
    patched by polling sync, but steps are not independently resumable from
    task-level checkpoints.
  - Nextflow/Snakemake: checkpoint/restart semantics recover from failed tasks and
    rerun only invalidated steps.
- **Deterministic caching**
  - Current runtime: outputs are time-stamped directories; cache keying is mostly by
    run id/config persistence in DB, not content hashes.
  - Nextflow/Snakemake: stronger artifact memoization and fingerprint-based
    rerun prevention.
- **Environment reproducibility**
  - Current runtime: Docker service pinning is present at platform level, but
    runtime-level task environments are not isolated per task (single Plumber image).
  - Nextflow/Snakemake: process-level container/conda profiles are explicit.
- **Pipeline ergonomics**
  - Current runtime: one main background script (`run_model_background.R`) and
    monolithic domain functions; good for API UX, less modular for CI-grade
    pipeline composition.
  - Nextflow/Snakemake: naturally support staged targets (`clean -> prepare ->
    fit -> predict -> evaluate -> export`) and visual DAG inspection.

## Recommendation

Treat this as **"reproducibility-focused single-tenant/managed workflow"** for now, not
"generalized Nextflow/Snakemake-compatible pipeline engine".

- Keep Hono + BullMQ + Plumber for production API/workbench delivery because it is the implemented contract and supports
  auth/project-scoped run history, queue backpressure, SSE progress, and
  immediate UX needs.
- Improve reproducibility posture with low-risk, docs-only/feature-internal work:
  1) tighten existing manifest and script-export payloads (package/env locks,
     climate-source checksums, deterministic run identifiers),
  2) simplify status ownership (single path for completion writes), and
  3) harden restart behavior for long-running model jobs.
- Defer a full Nextflow/Snakemake migration until there is a clear requirement for
  multi-user HPC-style fan-out, mixed-language task graphs, and cross-language rule
  caching.

## Evidence/code paths inspected

- `api/src/routes/sdm.ts` (request validation, async/sync model paths, queue enqueue + run insert/update behavior)
- `api/src/services/queue.ts` (BullMQ worker lifecycle, polling for Plumber statuses, retries/timeouts/backoff)
- `api/src/services/plumber-sync.ts` (periodic reconciliation of running DB rows)
- `api/src/services/plumber.ts` (Hono <-> Plumber HTTP client with request timeout and auth headers)
- `api/src/index.ts` (startup/shutdown hooks that start queue + plumber-sync poller)
- `plumber/R/plumber.R` (run submission, status endpoints, manifest/script-export endpoints)
- `plumber/R/run_model_background.R` (actual execution path, resource counters, output materialization)
- `R/output/script_export.R` (`format = "r"` + `format = "targets"` export scaffolding)
- `docs/REVIEW_PHASE4.md` (previous workflow comparison matrix)

## Proposed acceptance criteria for Issue #5 closure

1. **Decision recorded in docs:** this doc explicitly states whether the project
   is adopting a full DAG workflow migration or a "single-service orchestrator"
   model.
2. **Reproducibility minimum met:** every completed run manifest must include
   software versions, deterministic seed usage, and run input hashes sufficient to
   recreate the model phase given same upstream rasters/inputs.
3. **Status consistency:** `runs` completion state is updated through a single,
   deterministic ownership path (queue worker and sync job behavior documented and
   non-duplicative).
4. **Resume semantics documented:** documented behavior for rerun/retry after failed
   worker vs failed background process, including manual recovery commands and data
   retention expectations.
5. **Evidence trail:** PR description links this recommendation and the exact
   inspected paths above (this file + line-aware notes in follow-up if behavior changes).
