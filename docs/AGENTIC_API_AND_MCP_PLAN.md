# Agentic API And MCP Development Plan

This plan keeps SDM Dashboard's primary product direction intact: the modern
web platform remains the source of truth, and MCP becomes a later adapter over
stable workflow APIs rather than a separate architecture driver.

## Goal

Enable advanced users to drive reproducible SDM workflows from notebooks, CLI
scripts, and LLM clients.

The target workflow is not just "call the model endpoint":

> Find candidate species, filter occurrence records by geography and quality,
> prepare comparable modelling configurations, run batch SDM jobs, monitor
> progress, compare metrics, and export methods/provenance reports.

## Product Principle

Do not expose the whole REST surface as MCP tools.

First make the API machine-grade. Then expose a small curated MCP surface over
workflow-level primitives.

Good MCP tools should map to scientific workflow steps, not internal UI routes.
Run outputs, manifests, reports, and project summaries should be MCP resources
or ordinary API artifacts, not oversized tool responses.

## Architecture Direction

Current useful foundation:

- Hono API already fronts auth, projects, queues, cache, storage, Plumber, and
  database access.
- Shared Zod schemas already define important request shapes such as model
  configuration.
- Plumber owns the R modelling work; Hono owns user-facing auth, projects,
  job coordination, and result access.
- `sdm-mcp` already exists as a cautious local-first MCP prototype. Keep it as
  a learning/prototyping lane until the dashboard API has stable workflow
  contracts.

Target shape:

```text
Notebook / CLI / LLM client
  -> documented SDM Dashboard API
     -> workflow-level endpoints
     -> async batch jobs
     -> artifact and provenance manifests
     -> scoped auth / quotas / audit

MCP server
  -> thin adapter over the same API
  -> curated tools for workflow actions
  -> resources for project/run/artifact summaries
```

## Phase 0 - Alignment And Scope

Purpose: prevent MCP from pulling the project sideways.

Tasks:

- Agree that current web platform stabilization remains first priority.
- Treat MCP as a future interface, not a reason to redesign the frontend.
- Define the initial power-user workflow in one concrete scenario:
  "multi-species eastern Australia batch run with spatial-block CV and AUC
  triage."
- Decide whether the first external machine interface is API-only, notebook
  SDK, or MCP adapter. Recommended order is API contract first, notebook/CLI
  second, MCP third.

Acceptance:

- One short architecture note exists in repo docs.
- Jacob and Pacey agree which workflows are in v1 and which are later.

## Phase 1 - API Contract Baseline

Purpose: turn the existing Hono API into a documented, stable machine surface.

Tasks:

- Add OpenAPI generation using the existing Zod schemas and route contracts.
- Introduce an `/api/v1/openapi.json` endpoint or generated artifact.
- Document auth modes: browser JWT, API key, internal Plumber key.
- Mark routes as public, authenticated user, admin, or internal.
- Add route-level examples for project creation, occurrence upload/cleaning,
  model run, status polling, result download, and batch run.
- Add contract tests for response shape on key API routes.

Acceptance:

- API docs can be generated in CI.
- At least one curl-only happy path can create/login, upload or reference data,
  start a run, poll status, and fetch a manifest/result.
- Route schemas live close to implementation and are not hand-maintained prose
  only.

## Phase 2 - Workflow Objects

Purpose: give agents and notebooks stable objects to reason about instead of
only ad hoc files and run IDs.

Tasks:

- Formalize project, species, occurrence dataset, environment set, model run,
  batch run, and artifact manifest concepts.
- Add or harden API routes for:
  - occurrence dataset registration and summary
  - species/record count summaries
  - study-area presets and custom extents
  - environment layer/scenario summaries
  - batch run creation and status
  - run comparison summaries
- Keep large data out of JSON responses; return counts, capped previews,
  relative artifact IDs, and download links.
- Add idempotency keys for create/run/batch endpoints so agents can safely
  retry after timeouts.

Acceptance:

- A user can inspect "what data and settings will this run use?" before
  starting expensive modelling.
- Re-running a timed-out client request does not create duplicate expensive
  jobs when an idempotency key is supplied.
- Batch runs have a stable parent ID and child run IDs.

## Phase 3 - Agent-Grade Async Jobs

Purpose: make long-running SDM work controllable by code.

Tasks:

- Standardize job status shape across model, climate download, cleaning, and
  batch operations.
- Include machine-readable status, progress, current stage, warnings, error
  code, started/completed timestamps, and linked artifacts.
- Support pagination/filtering for run and batch history.
- Add cancellation semantics for batch parents and child runs.
- Add quotas/concurrency limits suitable for API-key clients.
- Preserve SSE/WebSocket for UI, but make polling first-class for scripts.

Acceptance:

- A notebook can start a batch, poll status, recover after restart, and cancel
  active jobs without UI access.
- Failure responses distinguish bad input, missing data, unavailable dependency,
  modelling failure, quota/concurrency limit, and infrastructure failure.

## Phase 4 - Provenance And Artifact Manifests

Purpose: make outputs scientifically reviewable and safe for LLM summarisation.

Tasks:

- Standardize a run artifact manifest containing input dataset refs, filters,
  covariates, algorithms, CV strategy, seed, package versions, metrics, output
  files, warnings, and report links.
- Add an aggregate batch manifest for multi-species workflows.
- Add lightweight JSON summaries for metrics and diagnostics.
- Keep raw occurrence tables, rasters, and model objects behind explicit
  download endpoints rather than embedding them in summaries.
- Add a "methods report" endpoint that can be safely quoted into notebooks or
  papers after review.

Acceptance:

- Every completed run has a reproducible manifest.
- Every batch has a comparison table with species, record counts, algorithm,
  AUC/TSS, warnings, and artifact links.
- LLM clients can summarize manifest/report text without seeing raw sensitive
  data by default.

## Phase 5 - Notebook And CLI Surface

Purpose: prove the API before MCP.

Tasks:

- Publish minimal examples for R, Python, and curl.
- Add a small TypeScript or Python client only if repetition becomes real.
- Include examples for:
  - login/API-key use
  - occurrence summary
  - single run
  - batch run
  - status polling
  - result manifest download
  - metric filtering such as AUC below 0.7

Acceptance:

- The example workflow runs without the browser.
- Docs are clear enough that MCP is obviously an adapter over these same
  primitives.

## Phase 6 - Curated MCP Adapter

Purpose: expose agent actions only after API workflows are stable.

Initial tools:

- `create_project`
- `search_species_candidates`
- `register_occurrence_dataset`
- `summarize_occurrences`
- `prepare_model_batch`
- `run_model_batch`
- `get_job_status`
- `compare_runs`
- `export_manifest`
- `generate_methods_report`

Initial resources:

- project summary
- occurrence dataset summary
- run summary
- batch summary
- artifact manifest
- methods report

Rules:

- MCP tools call the documented API; they do not reach around Hono into
  Plumber or the filesystem.
- Tool responses are bounded: counts, IDs, warnings, links, capped previews.
- Expensive or destructive actions require explicit confirmation from the host
  client where supported.
- API keys are scoped and never returned in MCP responses.

Acceptance:

- The Acacia/eastern-Australia/AUC-triage scenario can be completed through an
  MCP client without browser interaction.
- The same scenario also works through notebook/API examples.
- MCP adds convenience, not hidden behavior.

## Phase 7 - Security And Release Hardening

Purpose: make the machine interface safe enough to document publicly.

Tasks:

- Add API-key scopes for read, write, run, batch, admin.
- Add per-user/project quotas for batch size, parallel jobs, raster downloads,
  and retained artifacts.
- Redact secrets from logs, manifests, reports, and tool outputs.
- Add audit events for dataset registration, run creation, batch creation,
  cancellation, artifact access, and API-key use.
- Add public docs warning that SDM outputs need scientific validation and are
  not automatic decisions.

Acceptance:

- A public beta user can use the API without receiving admin/internal routes.
- Failed or malicious requests do not leak filesystem paths, secrets, raw data,
  or internal Plumber keys.

## Suggested Immediate Work Order

1. Keep current release/product stabilization moving.
2. Add this plan or a shortened version to the project docs.
3. Add OpenAPI generation and route contract inventory.
4. Add artifact/run manifest contract if not already complete enough.
5. Add one notebook/curl workflow that exercises the current API.
6. Add missing workflow endpoints only where the example workflow is painful.
7. Build MCP as a thin adapter once the API workflow is boring.

The delegable worker-wave breakdown is maintained in
`docs/AGENTIC_API_WORKER_WAVES.md`.

## Non-Goals For The Next Cycle

- Do not create a separate MCP-only modelling engine.
- Do not expose raw Plumber endpoints directly to external MCP clients.
- Do not return large occurrence tables, rasters, or model objects in MCP tool
  responses.
- Do not make the agent choose scientific defaults silently when those choices
  should be visible to the user.
- Do not block the web dashboard release on MCP.
