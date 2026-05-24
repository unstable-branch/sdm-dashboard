# SDM Dashboard — MCP Server Implementation Plan

## Overview

Implement 5 MCP (Model Context Protocol) servers to bridge the AI's capabilities with the SDM Dashboard's R/Plumber/Hono stack. Each server exposes **Tools**, **Resources**, and **Prompts** following the official MCP specification v1.x.

**Language**: TypeScript/Node.js (matching the modern stack)  
**SDK**: `@modelcontextprotocol/sdk` v1.x (stable)  
**Transport**: stdio (JSON-RPC 2.0)  
**Location**: `.opencode/mcp/<server-name>/` per server, shared lib at `packages/mcp/`

---

## Architecture

### Multi-MCP stack

```
AI Host (OpenCode)
   │
   ├── stdio ── r-intelligence MCP server    (port: N/A — stdio)
   ├── stdio ── climate-manager MCP server   (port: N/A — stdio)
   ├── stdio ── sdm-pipeline MCP server      (port: N/A — stdio)
   ├── stdio ── plumber-navigator MCP server (port: N/A — stdio)
   ├── stdio ── project-audit MCP server     (port: N/A — stdio)
   └── stdio ── meta-mcp orchestrator        (port: N/A — stdio, optional)
                         │
              spawns children as subprocesses
              aggregates tools/resources/prompts
              runs pipeline templates
              monitors health
```

### Design principles

- **Process isolation**: Each server runs as a separate Node process connected via stdio — one crash doesn't take down others.
- **No server-to-server IPC**: MCP has no spec for direct server communication. Cross-referencing happens at the **rules generation stage** (`refresh-all-rules.ts`) or at the **AI client level**.
- **Rule files embed snapshots**: Each server's `rules/` directory contains self-contained copies of data it needs from other servers' domains. Refreshed by `refresh-all-rules.ts`.
- **Tool name namespacing**: `{server-namespace}_{tool_name}` (e.g., `r_parse`, `climate_verify_readiness`, `audit_release`).
- **Error handling**: Hard failures throw JSON-RPC error (tool didn't run). Soft failures return `{ content: [{ type: "text", text: JSON.stringify(result) }], isError: true }`.
- **Custom error codes**: -32000 to -32099 (allocated in `packages/mcp/src/errors.ts`).
- **Tool annotations**: Every tool defines `read_only_hint` and `idempotent_hint` to guide AI calling behaviour.
- **Tool graduation rule**: New tool bands require a proven workflow stage — never expose tools before their inputs, outputs, and test path are defined.

### Workspace model

Every project lives under `SDM_MCP_WORKSPACE_ROOT` with a predictable directory layout:

```
projects/
  <project-name>/
    state.json          — project state machine
    logs/
      audit.jsonl       — append-only tool call audit trail
    01_occurrences/
    02_study_area/
    03_environment/
    04_formatting/
    05_models/
    06_projections/
    07_reports/
```

The server never writes outside the workspace root. All file operations pass through a `safe_path()` helper enforcing the boundary.

### State machine

`state.json` is a lightweight project index (not a data store):

```json
{
  "schema": "sdm-mcp/state/v1",
  "project_name": "koala-seq",
  "species": "Phascolarctos cinereus",
  "target_crs": "EPSG:4326",
  "created_at": "2026-05-20T00:00:00Z",
  "updated_at": "2026-05-20T00:01:00Z",
  "current_step": "created",
  "steps_completed": ["create_project"],
  "files": {},
  "package_versions": {}
}
```

May contain: project metadata, target CRS, current workflow step, completed steps, relative file references, package versions.

Must NOT contain: credentials, raw occurrence tables, raster data, model objects, long logs.

### Response contract

Every tool returns a structured JSON response with these fields:

**Success:**
```json
{
  "status": "success",
  "message": "short human-readable summary",
  "timestamp": "2026-05-20T00:00:00Z",
  "data": {},
  "files_created": {},
  "next_recommended_tool": "project_status",
  "warnings": []
}
```

**Error:**
```json
{
  "status": "error",
  "code": "path_outside_workspace",
  "message": "short safe message",
  "timestamp": "2026-05-20T00:00:00Z",
  "data": {},
  "warnings": []
}
```

`next_recommended_tool` guides the AI to the correct next step. `files_created` tracks what artifacts the tool produced. Sensitive fields (api_key, token, secret, password, credential) are recursively redacted to `<redacted>` in audit logs and error output.

### Tool annotations (adopted from sdm-mcp)

Every tool definition includes MCP annotations:

- `read_only_hint: boolean` — tells the AI this tool has no side effects (can be called freely for inspection)
- `idempotent_hint: boolean` — tells the AI calling it twice is safe

Combined with `{namespace}_health` and `next_recommended_tool`, these annotations form the AI's navigation system across the tool surface.

### Tool graduation rule (development policy)

Do not add a new tool band until its workflow stage has:

1. A specific workflow stage definition.
2. Structured inputs and bounded outputs.
3. State file and audit log updates.
4. Unit coverage for validation and path safety.
5. One smoke path that a client can run.

The first domain band must be occurrence intake, not modelling. This prevents premature tool surface expansion and keeps the AI prompt context manageable.

### Why no runtime cross-references

| Concern | Solution |
|---------|----------|
| Model registry data needed by sdm-pipeline | `rules/model-metadata.json` refreshed by `refresh-all-rules.ts` |
| Package list data needed by project-audit | Both servers import `shared/package-sync.ts` |
| Climate layer definitions needed by sdm-pipeline | `rules/biovar-definitions.json` regenerated from `config.R` |
| Conditional model registration (live state) | Optional live R query via `pipeline_list_registered_models` — AI chains calls if needed |

**Exception — meta-MCP**: Discovers all child servers' tools/resources/prompts at startup via `initialize` protocol. This is the only sanctioned runtime cross-ref and follows the MCP host pattern.

---

## Package structure

### Shared library: `packages/mcp/`

```
packages/mcp/
  src/
    r-executor.ts       — Rscript child process manager
    rule-loader.ts      — Rule file loader + Zod validation
    errors.ts           — MCPToolError class + custom error codes (-32000 to -32099)
    types.ts            — MCP-specific domain types
    index.ts            — barrel export
  package.json          — @sdm/mcp-shared
  tsconfig.json
```

Depends on `@sdm/shared` (existing — types, Zod schemas, constants).  
Already covered by `pnpm-workspace.yaml`'s `packages/*` glob.

### Server implementations: `.opencode/mcp/<server-name>/`

```
.opencode/mcp/
  r-intelligence/
  climate-manager/
  sdm-pipeline/
  plumber-navigator/
  project-audit/
  meta-mcp/                (optional)
  scripts/
    install-hooks.ts       — installs git hooks
```

Each server directory follows this structure:

```
<server-name>/
  src/
    index.ts               — MCP server entry point (stdio transport, tool/resource/prompt registration)
    tools/                 — one file per tool
    resources/             — resource handlers
    prompts/               — prompt templates
  rules/                   — static JSON rule files (regenerated by own refresh script)
  scripts/
    refresh-rules.ts       — regenerates this server's rules/ from R sources (optional)
  package.json             — depends on @sdm/mcp-shared + @modelcontextprotocol/sdk
  tsconfig.json
```

### Rule refresh architecture

Each server owns its own rule generation. No server writes to another's `rules/` directory.

```
git post-commit hook
  └─→ iterates .opencode/mcp/*/scripts/refresh-rules.ts
        ├─→ r-intelligence/scripts/refresh-rules.ts   ← reads load.R, packages.R, config.R
        ├─→ climate-manager/scripts/refresh-rules.ts  ← reads config.R, climate naming
        ├─→ sdm-pipeline/scripts/refresh-rules.ts    ← reads model_registry.R, config.R
        ├─→ project-audit/scripts/refresh-rules.ts   ← reads release file lists
        └─→ plumber-navigator/scripts/refresh-rules.ts ← reads plumber.R, auth.R
```

### Health contract

Every MCP server exposes a `{namespace}_health` tool. This is the only required tool.

```
{namespace}_health → {
  server: string
  status: "healthy" | "degraded"
  r_available: boolean
  rules_loaded: number
  last_refresh: string | null
  uptime_seconds: number
}
```

The AI calls health before deciding which tools to route to.

---

## The 5 MCP Servers

### 1. `r-intelligence` (highest priority)

Bridges the AI's biggest blind spot: R code. Provides function discovery, package validation, and module graph navigation.

**Tools**:
- `r_parse` — parse a single R file for syntax errors
- `r_function_info` — lookup function signature, source file, and params
- `r_package_sync` — 3-way comparison of `packages.R` ↔ `install_packages.R` ↔ `DESCRIPTION`
- `r_refresh_rules` — trigger rule regeneration on demand
- `r_model_registry` — query R for currently registered model backends (live)

**Resources**: `r://functions`, `r://modules`, `r://packages`

**Rules**: Module graph (`rules/module-graph.json`), package lists (`rules/packages.json`), function index (`rules/function-index.json`)

---

### 2. `climate-manager`

Manages climate data sources: WorldClim current, WorldClim future (CMIP6), CHELSA v2.1.

**Tools**:
- `climate_list_layers` — scan climate directories for available BIO tifs
- `climate_verify_readiness` — check env vars + filesystem for completeness
- `climate_download` — trigger download of missing layers

**Resources**: `climate://layers/worldclim`, `climate://layers/chelsa`, `climate://layers/future`

**Rules**: Naming conventions (regex per source), BIO variable definitions, env var defaults, default biovar selection

---

### 3. `sdm-pipeline` (most domain logic)

SDM model execution pipeline instrumentation. Covers occurrence data through post-processing and ecology.

See full tool specification below (§ Tools by Phase).

**Tools**: 14 total across 4 phases (3 in Phase 1, 3 in Phase 2, 3 in Phase 3, 4 in Phase 4, plus the originally planned `sdm_validate_config`, `sdm_recommend_model`, `sdm_diagnose_failure`, `sdm_run_pipeline`).

**Rules**: Model metadata, failure patterns, config schema, model param rules.

---

### 4. `plumber-navigator` (fastest to build)

Parses `plumber/R/plumber.R` (1688-line API file) + `plumber/R/auth.R` to provide endpoint discovery and auth classification.

**Tools**:
- `plumber_list_endpoints` — list all endpoints with methods, params, auth level
- `plumber_get_endpoint` — detail for a single endpoint
- `plumber_validate_auth` — cross-reference endpoint annotations with auth.R
- `plumber_generate_curl` — generate curl command for testing

**Resources**: `plumber://endpoints`, `plumber://auth`

**Rules**: Auth level classifications, endpoint annotation regex patterns

---

### 5. `project-audit`

Release audit and project health. Wraps existing `audit_release.R` + adds Node-level checks.

**Tools**:
- `audit_release` — full release audit (wraps `audit_release.R`)
- `audit_package_consistency` — 3-way package file comparison (uses `shared/package-sync.ts`)
- `audit_file_structure` — checks expected file existence + forbidden patterns
- `audit_docker_health` — validates compose files + Dockerfiles

**Rules**: Expected release files, forbidden patterns/secrets, Dockerfile/compose validation checks

---

### Optional: `meta-mcp` orchestrator

Spawns child servers as subprocesses, aggregates all tools/resources/prompts, runs pipeline templates with error recovery, monitors health. Not required for Phase 1 — add when multi-server orchestration is needed.

#### Meta-MCP rules

```
meta-mcp/
  rules/
    server-registry.json     — which child servers to spawn, start order, restart policy
    pipeline-templates.json  — declarative multi-step workflow definitions
    health-thresholds.json   — max restarts, check interval, degradation criteria
```

**`rules/server-registry.json`**:

```json
{
  "servers": [
    {
      "name": "r-intelligence",
      "path": ".opencode/mcp/r-intelligence/dist/index.js",
      "startup_order": 1,
      "restart_policy": "always",
      "max_restarts": 3,
      "timeout_ms": 15000
    },
    {
      "name": "climate-manager",
      "path": ".opencode/mcp/climate-manager/dist/index.js",
      "startup_order": 2,
      "restart_policy": "on-failure",
      "max_restarts": 2,
      "timeout_ms": 15000
    },
    {
      "name": "sdm-pipeline",
      "path": ".opencode/mcp/sdm-pipeline/dist/index.js",
      "startup_order": 2,
      "restart_policy": "on-failure",
      "max_restarts": 2,
      "timeout_ms": 30000
    },
    {
      "name": "plumber-navigator",
      "path": ".opencode/mcp/plumber-navigator/dist/index.js",
      "startup_order": 1,
      "restart_policy": "always",
      "max_restarts": 3,
      "timeout_ms": 10000
    },
    {
      "name": "project-audit",
      "path": ".opencode/mcp/project-audit/dist/index.js",
      "startup_order": 3,
      "restart_policy": "on-failure",
      "max_restarts": 1,
      "timeout_ms": 15000
    }
  ]
}
```

Startup order: level 1 (no deps) → level 2 (need rules from level 1's refresh scripts) → level 3 (standalone).

**`rules/pipeline-templates.json`**:

```json
{
  "templates": [
    {
      "id": "preflight",
      "label": "Pre-flight check before model run",
      "steps": [
        { "server": "plumber-navigator", "tool": "plumber_validate_auth", "args": {} },
        { "server": "climate-manager", "tool": "climate_verify_readiness", "args": {} },
        { "server": "r-intelligence", "tool": "r_package_sync", "args": {} }
      ],
      "mode": "parallel",
      "on_error": "warn"
    },
    {
      "id": "full_run",
      "label": "Full SDM run with diagnostics",
      "steps": [
        { "group": "prerequisites", "mode": "parallel",
          "steps": [
            { "server": "climate-manager", "tool": "climate_list_layers", "args": {} },
            { "server": "sdm-pipeline", "tool": "pipeline_list_registered_models", "args": {} }
          ]
        },
        { "server": "sdm-pipeline", "tool": "sdm_validate_config", "args": {} },
        { "server": "sdm-pipeline", "tool": "sdm_run_pipeline", "args": {} }
      ],
      "mode": "sequential",
      "on_error": "abort",
      "recovery": [
        { "server": "sdm-pipeline", "tool": "sdm_diagnose_failure", "args": {} }
      ]
    }
  ]
}
```

**`rules/health-thresholds.json`**:

```json
{
  "check_interval_ms": 30000,
  "degradation_criteria": {
    "max_restarts_per_minute": 3,
    "max_response_time_ms": 10000,
    "stale_rule_hours": 72
  },
  "notification": "log"
}
```

#### Meta-MCP tools

- `meta_list_servers` — report all child servers and their status (running/stopped/crashed)
- `meta_restart_server` — restart a single child server by name
- `meta_run_pipeline` — execute a pipeline template by ID, returns aggregated results
- `meta_health_summary` — aggregated health of all children

#### Meta-MCP resources

- `meta://servers` — full server registry with live status
- `meta://templates` — pipeline template definitions
- `meta://health` — aggregated health snapshot

---

## SDM Pipeline Tools — Complete Specification

The R/Shiny pipeline has 5 stages:

```
occurrence → cleaning → covariates → fit → predict → postprocess + ecology
```

Stage coverage:

| Stage | Current MCP tools | Phase 1 addition | Phase 2+ |
|-------|------------------|-----------------|----------|
| Occurrence ingestion | `sdm_validate_config` | — | — |
| Cleaning | `sdm_diagnose_failure` | — | — |
| Covariates | — | `pipeline_verify_covariates` | `pipeline_list_future_scenarios`, `pipeline_check_vif_readiness`, `pipeline_preview_covariate_stack` |
| Model fitting | `sdm_recommend_model` | `pipeline_list_registered_models` | `pipeline_validate_model_config` |
| Prediction | — | `pipeline_validate_projection` | — |
| Post-process | `sdm_run_pipeline` | — | `pipeline_get_available_ecology`, `pipeline_run_ecology` |
| Cross-cutting | — | — | `pipeline_list_past_runs`, `pipeline_get_run_summary`, `pipeline_estimate_duration`, `pipeline_describe_config` |

### Currently planned (pre-existing)

| Tool | R dependency | What it does |
|------|-------------|-------------|
| `sdm_validate_config` | Optional — validates model_id | Validates overall config schema against rules/ |
| `sdm_recommend_model` | Optional — checks min_records | Recommends model by occurrence count + covariate count |
| `sdm_diagnose_failure` | None | Maps R error messages to known solutions via failure-patterns.json |
| `sdm_run_pipeline` | Heavy — calls `run_fast_sdm()` | Orchestrates a full SDM model run via R |

### Phase 1 (build sprint)

#### `pipeline_verify_covariates`

- **Purpose**: Check that all requested environmental covariate files exist on disk before running a model.
- **R code**: `find_worldclim_files(dir, biovars, source)` — returns named vector of paths or NA per BIO.
- **Input**: `worldclim_dir`, `chelsa_dir`, `selected_biovars`, `source`, optional flags for extras/future.
- **Output**: `{ biovars: { present, missing }, directories, chelsa_extras, future_scenarios?, readiness, message }`.
- **Implementation**: Rscript call for BIO file matching; `fs.existsSync()` for directory checks.
- **Error cases**: Invalid biovars (not 1-19, <2), dir doesn't exist, R not installed.

#### `pipeline_list_registered_models`

- **Purpose**: Query R for currently available model backends (respects conditional registration).
- **R code**: `sdm_model_ids()` + `get_sdm_model(id)` for each.
- **Input**: None.
- **Output**: `{ models: [{ id, label, maturity, packages, min_records, supports_* }], default_model_id, total, by_maturity }`.
- **Implementation**: Single Rscript call sourcing `load.R`, iterating model registry, returning JSON.
- **Error cases**: No models registered, R not installed, load.R fails.

#### `pipeline_validate_projection`

- **Purpose**: Validate that the projection extent contains valid occurrence data; catch extent-outside-data errors.
- **R code**: `validate_extent()` + optional `occurrence_extent_overlap(occ, extent)`.
- **Input**: `training_extent`, `projection_extent`, optional `occurrence_file`.
- **Output**: `{ validation: { training_extent, projection_extent, coverage }, occurrence_overlap?, ready, message }`.
- **Implementation**: Pure math for extent validation; optional R call for occurrence overlap.
- **Error cases**: Invalid extent (NaN, wrong order, out of bounds), occurrence file not found.

### Phase 2 (next sprint)

#### `pipeline_list_future_scenarios`

- **Purpose**: Scan `Worldclim_future/` for downloaded GCM/SSP/period directories.
- **R dependency**: None (pure filesystem — parse subdirectory names).
- **Input**: `future_dir` (optional).
- **Output**: `{ scenarios: [{ gcm, ssp, period, file_count, bio_layers, complete }], total_scenarios }`.
- **Error cases**: Dir doesn't exist, no scenarios found, non-standard naming (warned but skipped).

#### `pipeline_validate_model_config`

- **Purpose**: Validate model-specific parameters before calling R (e.g., `maxnet_features` must be `l/q/p/lq/lp/qp/lqp`).
- **R dependency**: Optional — `validate_sdm_model_id()` to confirm model exists.
- **Input**: `model_id`, model-specific config params.
- **Output**: `{ model_valid, errors: [{ param, message, value, allowed }], warnings }`.
- **Implementation**: Hardcoded TypeScript validation rules per model backend. No heavy R sourcing needed.

#### `pipeline_describe_config`

- **Purpose**: Return the full SDM config schema (87 params with defaults, types, groups, ranges).
- **R dependency**: None (static JSON rule file).
- **Input**: Optional `param` filter (single param name).
- **Output**: `{ config_schema: Record<string, { name, type, default, description, group, required }>, param_count }`.
- **Implementation**: Rule file `rules/config-schema.json` loaded via `RuleLoader`.

### Phase 3 (future)

#### `pipeline_list_past_runs`

- **Purpose**: Scan `outputs/` directory for `_manifest.json` files and return run history.
- **R dependency**: None (pure filesystem).
- **Input**: `output_dir`, optional `limit`, `since`, `species` filters.
- **Output**: `{ runs: [{ base_name, species, timestamp, model_id, auc_mean, ... }], total_runs }`.

#### `pipeline_get_run_summary`

- **Purpose**: Parse a past run's `_manifest.json` and `_report.txt` into structured data.
- **R dependency**: None (JSON + text parsing).
- **Input**: `base_name`, `output_dir`.
- **Output**: `{ found, manifest: full JSON, report: structured text fields }`.

#### `pipeline_estimate_duration`

- **Purpose**: Estimate model run duration from config parameters (pure heuristic).
- **R dependency**: None (pure math).
- **Input**: `model_id`, `n_biovars`, `n_covariates`, `background_n`, `cv_folds`, `n_cores`.
- **Output**: `{ estimated_seconds, estimated_readable, factor_breakdown }`.
- **Formula**: `base_time × bg_factor × cv_factor × model_factor × covariate_factor / sqrt(cores)`.

### Phase 4 (future — nice-to-have)

#### `pipeline_check_vif_readiness`

- **Purpose**: Check if VIF reduction can run given the covariate set.
- **R dependency**: Heavy — `load_environment()` + `select_by_vif()`.
- **Input**: `occurrence_file`, `worldclim_dir`, `selected_biovars`, `training_extent`.
- **Output**: `{ ready, n_covariates, n_complete_cases, n_zero_variance, vif_possible }`.

#### `pipeline_preview_covariate_stack`

- **Purpose**: Report covariate stack metadata before running a model.
- **R dependency**: Heavy — `load_environment()` (loads actual rasters, returns metadata only).
- **Input**: Climate + covariate params.
- **Output**: `{ layers: [{ name, source, n_cells, has_valid_stats, mean, sd }], total_layers, crs, resolution, extents }`.

#### `pipeline_get_available_ecology`

- **Purpose**: Report which ecology calculations can run given a past run's artifacts.
- **R dependency**: None (file existence checks).
- **Input**: `base_name`, `output_dir`.
- **Output**: `{ has_occurrence_data, has_suitability_raster, ..., available_calculations: { eoo_aoo, mess, aoa, ... } }`.

#### `pipeline_run_ecology`

- **Purpose**: Run a single ecology calculation (EOO/AOO, MESS, etc.) standalone.
- **R dependency**: Medium — `compute_eoo_aoo()`, `compute_mess()`, etc.
- **Input**: `calculation: "eoo_aoo" | "mess" | ...`, `base_name`, calculation-specific params.
- **Output**: `{ calculation, result, output_files }`.

---

## Gap 1: Compute engine abstraction (Phase 5)

### Problem

Every tool imports `RExecutor` directly. A Python backend (`elapid`, `SDMtoolbox`, `maxent` Java) would require rewriting every tool.

### Solution: `Executor` interface

New file `packages/mcp/src/executor.ts`:

```typescript
export interface ExecutorOptions {
  projectRoot: string;
  timeoutMs?: number;
}

export type ExecutorResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: unknown;
  error?: { message: string; category: string; raw: string };
};

export interface Executor {
  execute(script: string, opts?: { sourceFirst?: boolean }): Promise<ExecutorResult>;
  sourceAndCall<T>(call: string): Promise<ExecutorResult & { data: T | null }>;
  isAvailable(): Promise<boolean>;
}
```

### What changes

| File | Change |
|------|--------|
| `packages/mcp/src/executor.ts` | **New** — interface + types |
| `packages/mcp/src/r-executor.ts` | `class RExecutor implements Executor` — no method signature change |
| `packages/mcp/src/index.ts` | Export `Executor` alongside `RExecutor` |
| All tool `*.ts` files | Constructor takes `Executor`, not `RExecutor`. Call `this.executor.execute()` |

### Enabled (not built in this plan)

| Future file | Purpose |
|-------------|---------|
| `python-executor.ts` | Wraps `python3 -c "..."` or conda env |
| `docker-executor.ts` | Wraps `docker run` — runs R/Python in container |
| `http-executor.ts` | Wraps remote HTTP endpoint for cloud deployments |

---

## Gap 2: Three new servers (Phase 6)

### Server A: `occurrence-manager`

Dedicated server for occurrence data handling, extracted from `sdm_pipeline`.

**R code wrapped**: `occurrences.R` (`read_occurrence_file`, `clean_occurrences`), `occurrences_dwca.R` (DwC-A parsing), `occurrences_gbif.R` (GBIF search via `rgbif`).

| Tool | R dependency | What it does |
|------|-------------|--------------|
| `oc_import` | Heavy — `read_occurrence_file()` | Load CSV/TSV/DwC-A, detect columns, return preview |
| `oc_validate` | Medium — CC tests | Run CoordinateCleaner, return flagged records |
| `oc_clean` | Heavy — `clean_occurrences()` | Full cleaning: duplicates, bad coords, source merge |
| `oc_summarize` | Light — `nrow()`, `table(source)` | Record counts, per-source breakdown |
| `oc_search_gbif` | Heavy — `rgbif::occ_search()` | GBIF taxonomic + spatial search |
| `oc_thin` | Medium — spatial thinning | Reduce spatial auto-correlation |
| `oc_preview` | None — pure fs | First 10 rows + column types from CSV |

**Resources**: `oc://current` (loaded dataset), `oc://sources` (per-source breakdown).

### Server B: `job-manager`

Async job submission and tracking. Wraps existing BullMQ + Redis infrastructure.

**Code wrapped**: `api/src/services/queue.ts` (BullMQ worker), `api/src/services/job-events.ts` (event bus), `api/src/services/websocket.ts` (real-time progress).

| Tool | What it does |
|------|-------------|
| `job_submit` | Submit a model run config, returns `jobId` |
| `job_cancel` | Cancel a running job by ID |
| `job_status` | Get progress %, current stage, logs |
| `job_list` | List recent jobs, filter by status/species/date |
| `job_resubmit` | Clone a previous run with modified config |

**Resources**: `job://<id>` (full detail), `job://queue` (queue depth, running count).

### Server C: `output-manager`

Run output discovery, comparison, and export. Extends the Phase 3 `pipeline_list_past_runs` and `pipeline_get_run_summary` into a full server.

**Code wrapped**: `R/output/manifest.R` (manifest format), `R/output/report.R` (report format), `R/output/plots.R` (map format), filesystem scanning.

| Tool | What it does |
|------|-------------|
| `out_list` | List runs, filter by species/model/date/metric range |
| `out_get_report` | Return formatted report text for a run |
| `out_get_manifest` | Return full manifest JSON |
| `out_compare` | Side-by-side: AUC, TSS, var importance, suitability |
| `out_export_bundle` | Package outputs (TIF, PNG, report) for download |
| `out_delete` | Remove a run's artifacts from disk |

**Resources**: `output://runs` (run index), `output://<id>/report`, `output://<id>/manifest`.

---

## Gap 3: Transport layer (Phase 7)

### Problem

All servers use stdio transport only. This prevents:
- Remote AI clients connecting over a network
- Web UI displaying tool results
- Multi-user deployments
- Rate limiting and resource governance

### Solution: optional transport adapters

New directory `packages/mcp/src/transport/`:

| File | Purpose |
|------|---------|
| `adapter.ts` | `Transport` interface — `start()`, `stop()`, `registerTool()` |
| `http-server.ts` | Express adapter — mounts tools as HTTP POST endpoints |
| `websocket-server.ts` | WebSocket adapter — real-time bidirectional messaging |
| `auth.ts` | JWT + API key middleware per request |
| `rate-limiter.ts` | Token bucket — per tool per user |

### Auth model

```
per-server flag:     whether this server requires auth
jwt_secret:          HMAC secret for JWT validation
api_keys: [str]      optional API key whitelist
allow_health_without_auth: true   — health endpoint is public
```

### Rate limits per tool

Configured in each server's `rules/rate-limits.json`:

```json
{
  "sdm_run_pipeline":         { "max_per_minute": 2, "max_concurrent": 1 },
  "pipeline_verify_covariates": { "max_per_minute": 30, "max_concurrent": 5 },
  "climate_download":         { "max_per_minute": 1, "max_concurrent": 1 },
  "oc_import":                { "max_per_minute": 10, "max_concurrent": 3 }
}
```

### Changes to server entry points

Each server's `src/index.ts` gets an optional transport init block:

```typescript
// Existing: stdio-only
const server = new McpServer({ name: "sdm-pipeline" }, { capabilities });

// Optional: HTTP transport
if (process.env.MCP_HTTP_PORT) {
  const httpAdapter = new HttpAdapter({ port: +process.env.MCP_HTTP_PORT });
  httpAdapter.registerTool("sdm_validate_config", validateConfigHandler);
  httpAdapter.start();
}
```

---

## Implementation order

### Phase 1: Shared infrastructure + core servers

| Step | What | Depends on |
|------|------|-----------|
| 0.1 | Create `packages/mcp/` — shared lib (r-executor, rule-loader, errors, types) | Nothing |
| 0.2 | Build `r-intelligence` | packages/mcp |
| 0.3 | Build `plumber-navigator` | packages/mcp |
| 0.4 | Build sdm-pipeline server skeleton + 4 rule files | packages/mcp |
| 0.5 | Build Phase 1 tools (3 tools) | sdm-pipeline skeleton |

### Phase 2: Remaining servers + Phase 2 tools

| Step | What | Depends on |
|------|------|-----------|
| 1.1 | Build `climate-manager` | packages/mcp |
| 1.2 | Build `project-audit` | packages/mcp |
| 1.3 | Build Phase 2 sdm-pipeline tools (3 tools) | sdm-pipeline skeleton |

### Phase 3: Phase 3 tools

| Step | What | Depends on |
|------|------|-----------|
| 2.1 | Build Phase 3 sdm-pipeline tools (3 tools) | sdm-pipeline skeleton |

### Phase 4: Phase 4 tools

| Step | What | Depends on |
|------|------|-----------|
| 3.1 | Build Phase 4 sdm-pipeline tools (4 tools) | sdm-pipeline skeleton |

### Phase 5: Abstract computation engine (Gap 1)

Replace hardcoded `RExecutor` usage with a pluggable `Executor` interface so tools don't depend on R directly.

| Step | What | Depends on |
|------|------|-----------|
| 4.1 | Add `packages/mcp/src/executor.ts` — `Executor` interface + types | packages/mcp |
| 4.2 | Add `implements Executor` to `r-executor.ts` (no API change) | 4.1 |
| 4.3 | Update all tool files to inject `Executor` via constructor | 4.1 |

**Enables future additions**: `python-executor.ts`, `docker-executor.ts`, `http-executor.ts` — none built in this plan, but the interface makes them drop-in.

### Phase 6: Three missing servers (Gap 2)

| Step | What | Depends on |
|------|------|-----------|
| 5.1 | Build `occurrence-manager` — 7 tools (import, validate, clean, summarize, GBIF search, thin, preview) | packages/mcp + sdm-pipeline (reuses R executor) |
| 5.2 | Build `job-manager` — 5 tools (submit, cancel, status, list, resubmit) | packages/mcp |
| 5.3 | Build `output-manager` — 6 tools (list, get_report, get_manifest, compare, export, delete) | packages/mcp |

### Phase 7: HTTP/WebSocket transport + auth (Gap 3)

Add optional transport adapters so servers can run standalone (not just as stdio children of OpenCode).

| Step | What | Depends on |
|------|------|-----------|
| 6.1 | Add `packages/mcp/src/transport/adapter.ts` — `Transport` interface | packages/mcp |
| 6.2 | Add `packages/mcp/src/transport/http-server.ts` — Express adapter | 6.1 |
| 6.3 | Add `packages/mcp/src/transport/websocket-server.ts` — WebSocket adapter | 6.1 |
| 6.4 | Add `packages/mcp/src/transport/auth.ts` — JWT + API key middleware | 6.1 |
| 6.5 | Add `packages/mcp/src/transport/rate-limiter.ts` — per-tool token bucket | 6.1 |
| 6.6 | Add `rules/rate-limits.json` to each server — per-tool rate limit config | 6.5 |

### Phase 8: Optional

| Step | What | Depends on |
|------|------|-----------|
| 7.0 | Build `meta-mcp` orchestrator | All 5 servers built |
| 7.1 | Git post-commit hook for per-server refresh | All per-server `scripts/refresh-rules.ts` |

---

## Key decisions made

1. **Shared lib at `packages/mcp/`** (not `.opencode/mcp/shared/`) — so it gets the existing pnpm workspace, TypeScript build, ESLint config, and CI pipeline automatically. Server implementations live in `.opencode/mcp/<server>/`.

2. **Static rule files with auto-refresh** — each server's `rules/` directory is self-contained. Per-server `scripts/refresh-rules.ts` regenerates rules from R sources. Git post-commit hook iterates all servers and triggers their refresh scripts. **Exception**: `model-metadata.json` is a hand-authored reference fallback — the live R query (`pipeline_list_registered_models`) is the source of truth. The static file is only consulted when R isn't available.

3. **Live R query as fallback** — `pipeline_list_registered_models` calls R directly to get the current model registry, rather than relying solely on static rules. This handles conditional registration (biomod2, maxnet, ranger, cito packages may or may not be installed).

4. **No runtime server-to-server IPC** — MCP doesn't support it. Cross-server data flows through:
   - Rule files (refreshed at generation time)
   - AI-level chaining (AI calls `r_model_registry` then passes result to `sdm_validate_config`)
   - Meta-MCP orchestration (optional, at startup only)

5. **Parameterized tools** — `sdm_validate_config` and `sdm_recommend_model` accept optional `model_registry` parameter so the AI can pass live data from sibling servers.

6. **Types at `packages/mcp/src/types.ts`** — not in `@sdm/shared` (which is shared with the Hono API and frontend). MCP-specific types stay in the MCP layer.

7. **3-phase test strategy** — Unit (no R, 90% of tests), Integration (with R, tagged `--tag=integration`), E2E (MCP protocol over stdio, tagged `--tag=e2e`). CI runs unit + integration.

8. **Structured response contract** — Every tool returns `{ status, message, timestamp, data, files_created, next_recommended_tool, warnings }` for success, `{ status, code, message, timestamp, data, warnings }` for error. Sensitive fields are recursively redacted in audit logs.

9. **Per-project state machine** — `state.json` tracks pipeline progress via `current_step` and `steps_completed`. The AI reads state before deciding which tool to call next.

10. **Workspace isolation** — All project files live under `SDM_MCP_WORKSPACE_ROOT`. A `safe_path()` utility enforces the boundary. Numbered stage directories (`01_occurrences/` → `07_reports/`) provide a predictable layout.

11. **JSONL audit logging** — Every tool call is appended to `logs/audit.jsonl` with timestamp, tool name, redacted inputs, status, and message. Immutable audit trail for reproducibility.

12. **Tool annotations** — `read_only_hint` and `idempotent_hint` on every tool definition. Guides AI calling behaviour and prevents unnecessary re-execution.

13. **Tool graduation rule** — New tools are not added until their workflow stage has a proven implementation. Do not expose modelling tools before occurrence intake and environment layers are tested.

---

## Test strategy

### Unit tests (vitest, 90% of test count)

- No R required, no real filesystem (tmpdir or mocks).
- Test all parsing, validation, error branches, edge cases.
- Run: `pnpm --filter @sdm/mcp-* run test:unit`
- Location: `<server>/tests/unit/tools/<tool-name>.test.ts`

### Integration tests (vitest, `--tag=integration`)

- R must be installed and `$PROJECT_ROOT` pointing at the repo.
- One test per tool that calls R for real.
- Use `test.skipIf(!hasR)` to skip when R isn't available.
- Run: `pnpm --filter @sdm/mcp-* run test:integration`

### E2E tests (vitest, `--tag=e2e`)

- Start the MCP server as a child process, send JSON-RPC messages via stdin.
- Verify structured responses match expected schemas.
- Run: `pnpm --filter @sdm/mcp-* run test:e2e`

---

## CI integration

Add to `.github/workflows/platform-ci.yml`:

```yaml
mcp:
  name: MCP server build + test
  runs-on: ubuntu-latest
  timeout-minutes: 15
  needs: shared
  steps:
    - uses: actions/checkout@v4
    - run: npm install -g pnpm
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - name: Download shared artifacts
      uses: actions/download-artifact@v4
      with:
        name: shared-dist
        path: packages/shared/dist
    - name: Build MCP packages
      run: |
        pnpm --filter @sdm/mcp-shared run build
        for dir in .opencode/mcp/*/; do
          (cd "$dir" && npx tsc --noEmit)
        done
    - name: Unit tests
      run: |
        for dir in .opencode/mcp/*/; do
          (cd "$dir" && npx vitest run tests/unit --reporter=verbose 2>/dev/null) || true
        done
    - name: Integration tests
      if: ${{ runner.os == 'Linux' && hashFiles('**/R/core/bootstrap.R') != '' }}
      run: |
        for dir in .opencode/mcp/*/; do
          (cd "$dir" && npx vitest run tests/integration --reporter=verbose 2>/dev/null) || true
        done
```

---

## Release workflow fixes (in scope)

### 1. Release version alignment

In `.github/workflows/release.yml`, replace the single `make_release_zip.R` call with:

```yaml
- name: Build source release zip
  run: Rscript scripts/make_release_zip.R --version=${{ github.ref_name }} source
- name: Build Windows-ready release zip
  run: Rscript scripts/make_release_zip.R --version=${{ github.ref_name }} ready
```

### 2. Package sync deduplication

Extract 3-way comparison into `packages/mcp/src/package-sync.ts` (or `packages/shared`). Both `r_package_sync` and `audit_package_consistency` import the same shared function.

### 3. Git post-commit hook for auto-refresh

```
.git/hooks/post-commit:
  changed = git diff --name-only HEAD~1..HEAD
  triggers = ["R/load.R", "R/core/config.R", "R/core/packages.R",
              "install_packages.R", "DESCRIPTION", "plumber/R/plumber.R",
              "plumber/R/auth.R", "R/models/model_registry.R"]
  if intersect(changed, triggers) not empty:
    for dir in .opencode/mcp/*/; do
      if [ -f "$dir/scripts/refresh-rules.ts" ]; then
        pnpm tsx "$dir/scripts/refresh-rules.ts"
      fi
    done
    git add .opencode/mcp/*/rules/
    git commit --amend --no-edit
```

### 4. CI issues to fix

| Issue | Fix |
|-------|-----|
| Duplicate R quality checks | Remove `r-quality` job from `platform-ci.yml` — `r-quality.yml` already covers it |
| R cache version drift | Bump `r-quality.yml` to `cache-version: 2` |
| Missing `PLUMBER_INTERNAL_KEY` in prod compose | Add to both `api` and `plumber` services in `docker-compose.prod.yml` |
| E2E `continue-on-error: true` | Remove or gate behind workflow_dispatch input |
| No CI for `main` branch push | Add `main` to `platform-ci.yml` push branches |
| `release.yml` lacks `renv.lock` validation | Add `renv::snapshot(lockfile = "renv.lock")` check to `audit_release.R` |
