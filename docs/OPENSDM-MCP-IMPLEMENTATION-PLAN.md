# OpenSDM MCP + XAI Implementation Plan

**Date:** 2026-05-27  
**Status:** Final — Ready for Implementation  
**Replaces:** `.opencode/MCP-PLAN.md` (972-line design document)

---

## Executive Summary

SDM Dashboard's MCP strategy: build the R XAI engine first, expose via Plumber endpoints, then wrap in a lean 2-server MCP layer. Domain verticals (MRV, biosecurity, marine) are deferred pending user research. Server-side agent with BYOK provides autonomous workflow planning.

**Security principle:** Every external model connection requires a user-supplied API key. The platform never holds an LLM key.

**Timeline:** ~32 weeks. **First user-visible XAI by week 9.**

| Phase | Weeks | Deliverable |
|---|---|---|
| Phase 0: Platform Stability | 8 | Structured errors, OpenAPI spec, integration tests, health endpoints |
| Phase 1: R XAI Engine | 8 | 4 statistical XAI modules (importance, SHAP, counterfactual, explain) |
| Phase 2: XAI Plumber Endpoints | 3 | 4 new API endpoints serving XAI results |
| Phase 3a: MCP Servers | 8 | 2 MCP servers (sdm-mcp, devtools-mcp) + meta-MCP |
| Phase 3b: Agent + Admin API | 9 | User agent, admin agent, MCP remote auth, frontend chat UI |

---

## Architecture

### Three-Layer Stack

```
Layer 3: Agent
  ├── User agent (dashboard) — BYOK LLM for SDM workflow planning
  ├── Admin agent (admin API) — BYOK LLM for platform ops
  └── External AI (Claude Desktop, etc.) — BYOK LLM, calls MCP tools via user platform key

Layer 2: Tools
  ├── sdm-mcp (14 tools) — wraps Plumber HTTP endpoints
  ├── devtools-mcp (8 tools) — R code analysis + audit
  └── meta-MCP (orchestrator) — spawns children, pipeline templates, protocol mode

Layer 1: Computation
  ├── Hono API (port 4000) — user auth, SDM routes, agent routes, XAI routes
  ├── Admin API (port 4005) — admin auth, admin agent routes (localhost only)
  ├── Plumber R API (port 8000) — SDM computation, XAI computation
  └── PostgreSQL / Redis / Garage — storage and queuing
```

### Two APIs, Two Agents, Two Audiences

| Tier | Port | Auth | LLM Key | Audience | Network |
|---|---|---|---|---|---|
| **User API** | 4000 | JWT + API Key | User's key from `user_settings` | Ecologists | Public (behind reverse proxy) |
| **Admin API** | 4005 | X-Admin-API-Key only | Admin's key from `user_settings` | Operators | localhost only. Not public. |
| **MCP stdio** | N/A | None (local) | N/A | Developers, AI assistants | Local machine only |

### Authentication Model

```
External AI (Claude Desktop, ChatGPT, Cursor)
  │ Holds: user's LLM API key (BYOK)
  │ Holds: user's platform API key (from dashboard Settings → API Keys)
  │
  │── MCP tool call: sdm_model_run(api_key="sk-...", species="...", config={...})
  │   │
  │   ▼
  │ sdm-mcp validates api_key against PostgreSQL api_keys table
  │   ├─ Invalid → return 401 MCP error
  │   └─ Valid   → call Plumber with X-Forwarded-User
  │
  │── Agent chat: user agent uses user's LLM key from settings
  │   │
  │   ▼
  │ Hono decrypts user_settings.llm_config, calls LLM with user's key
  │   ├─ No key configured → agent unavailable ("configure your key")
  │   └─ Key configured    → agent plans + executes workflow

Platform NEVER holds an LLM API key. Every LLM call uses the authenticated user's key.
```

---

## Server Inventory

### Existing Servers (MCP-PLAN.md — replaced by this plan)

**Note:** The original 8-server MCP-PLAN.md is replaced by this lean 3-server design. The tools from the original plan are consolidated into the servers below.

### New Servers (3 total)

| # | Server | Location | Tools | Wraps | Audience |
|---|---|---|---|---|---|
| 1 | **meta-mcp** | `.opencode/mcp/meta-mcp/` | 4 orchestration + pipeline templates | Subprocess management | Developer |
| 2 | **sdm-mcp** | `.opencode/mcp/sdm-mcp/` | 14 domain tools | Plumber HTTP via `HttpExecutor` | Ecologist |
| 3 | **devtools-mcp** | `.opencode/mcp/devtools-mcp/` | 8 developer tools | Rscript + filesystem | Developer |

### Omitted Servers (from original MCP-PLAN.md)

| Server | Tools | Why Omitted | Alternative |
|---|---|---|---|
| `r-intelligence` | 5 | Thin R wrappers. `r_parse` = `Rscript -e 'parse(file)'` | Fold into devtools-mcp if ever needed |
| `climate-manager` | 3 | `climate_list_layers` = `fs.readdir()` | sdm-mcp covers via Plumber's `/api/v1/climate/scenarios` |
| `plumber-navigator` | 4 | Parses 1 file | devtools-mcp has `plumber_endpoints` tool |
| `project-audit` | 4 | Existing R scripts. Call from CLI | CLI `bash scripts/audit_release.R` |
| `occurrence-manager` | 7 | Wraps existing Plumber POST endpoints | sdm-mcp covers via Plumber endpoints |
| `job-manager` | 5 | Wraps existing BullMQ queue | sdm-mcp covers via `sdm_model_status` |
| `output-manager` | 3 | Wraps filesystem + report endpoints | sdm-mcp covers via `sdm_report` |

---

## sdm-mcp: Tool Surface (14 tools)

| Tool | Method | Plumber/Hono Endpoint | Input | Output |
|---|---|---|---|---|
| `sdm_model_list` | GET | `/api/v1/models` | — | `{models: [{id, label, maturity}]}` |
| `sdm_model_recommend` | Rule | No HTTP (rule-based) | `{n_records, n_covariates}` | `{recommended_id, alternatives, rationale}` |
| `sdm_model_run` | POST | `/api/v1/models/run` | Full config JSON | `{run_id, status: "queued"}` |
| `sdm_model_status` | GET | `/api/v1/models/status/:jobId` | `{job_id}` | `{status, progress, stage, metrics?}` |
| `sdm_model_cancel` | POST | `/api/v1/models/cancel/:jobId` | `{job_id}` | `{status: "cancelled"}` |
| `sdm_model_compare` | — | Aggregates 2 status responses | `{run_a, run_b}` | `{metrics_diff, importance_diff}` |
| `sdm_data_validate` | POST | `/api/v1/data/upload` | `{file_path}` | `{valid, n_rows, columns, issues}` |
| `sdm_data_search_gbif` | POST | `/api/v1/data/gbif/search` | `{species, country?, limit?}` | `{n_records, preview}` |
| `sdm_covariate_list` | GET | `/api/v1/climate/scenarios` | — | `{scenarios: [{source, biovars}]}` |
| `sdm_covariate_check` | GET | `/api/v1/climate/check` | `{biovars, source}` | `{present, missing}` |
| `sdm_xai_importance` | GET | `/api/v1/xai/importance/:runId` | `{run_id, n_perm?}` | `{variables: [{name, importance, sd}]}` |
| `sdm_xai_shap` | POST | `/api/v1/xai/shap/:runId` | `{run_id}` | `{summary: [{variable, contribution}]}` |
| `sdm_xai_explain` | GET | `/api/v1/xai/explanation/:runId` | `{run_id, detail_level?}` | `{sections: [{heading, body}]}` |
| `sdm_report` | GET | `/api/v1/ecology/:runId/report` | `{run_id}` | `{report_text}` |

**Every tool requires `api_key` as its first parameter** — the user's platform API key for authentication.

---

## devtools-mcp: Tool Surface (8 tools)

| Tool | Executor | What It Does |
|---|---|---|
| `r_function_info` | RExecutor | Calls `getAnywhere("function_name")` in R, returns source file + signature |
| `r_package_sync` | Filesystem | Parses `packages.R`, `install_packages.R`, `DESCRIPTION`, flags mismatches |
| `r_parse` | RExecutor | `Rscript -e 'parse(file)'` — reports syntax errors |
| `plumber_list_endpoints` | Filesystem | Parses `plumber/R/plumber.R` for `#* @` annotation blocks |
| `plumber_endpoint_detail` | Filesystem | Returns full annotation block for a specific endpoint path |
| `audit_release` | RExecutor | `Rscript scripts/audit_release.R` |
| `audit_file_structure` | Filesystem | Checks expected files exist, forbidden files absent |
| `audit_docker_health` | Filesystem | Validates docker-compose YAML syntax + Dockerfile existence |

**Every tool requires `api_key` as its first parameter.** Same auth flow as sdm-mcp.

---

## Phase 0: Platform Stability (Weeks 1-8)

### Goal
The existing API must be reliable, observable, and well-documented before anything is wrapped in MCP.

### Week 1-2: Structured Error Handling + Timeouts

**Files:**
- **New:** `api/src/middleware/error-handler.ts`
- **Modified:** `plumber/R/plumber.R` (structured error responses)
- **Modified:** `api/src/index.ts` (error middleware)

**Error response format (all endpoints):**
```json
{
  "error": {
    "code": "validation_error",
    "message": "Human-readable summary",
    "hint": "Actionable suggestion",
    "details": {}
  }
}
```

**Error codes:** `validation_error`, `not_found`, `auth_error`, `rate_limited`, `timeout`, `internal_error`, `r_error`, `dependency_unavailable`

**Timeout monitoring:** Add `setTimeLimit()` to Plumber endpoints for model runs (1800s), climate download (3600s), occurrence cleaning (300s).

**Acceptance:**
```bash
curl -X POST http://localhost:8000/api/v1/models/run -d '{"invalid": true}'
# → {"error": {"code": "validation_error", "message": "...", "hint": "..."}}
```

### Week 3-4: OpenAPI Spec + API Versioning

**Files:**
- **New:** `docs/openapi.yaml` (generated from Zod schemas)
- **Modified:** `api/src/index.ts` (version header, versioned content-type)

**Tooling:** `@asteasolutions/zod-to-openapi` to generate OpenAPI 3.1 from `@sdm/shared` Zod schemas. CI validates spec matches routes on every PR.

**Versioning:** `Accept: application/vnd.sdm.v1+json` header. `X-API-Version` response header.

**Acceptance:**
```bash
curl -H "Accept: application/vnd.sdm.v1+json" http://localhost:4000/api/v1/models
# → X-API-Version: 2.0.0-beta.1
pnpm run generate:openapi && npx @redocly/cli lint docs/openapi.yaml
```

### Week 5-6: Integration Tests

**Files:**
- **New:** `api/tests/integration/auth-flow.test.ts` (6 scenarios)
- **New:** `api/tests/integration/sdm-flow.test.ts` (10 scenarios)
- **New:** `api/tests/integration/climate-flow.test.ts` (3 scenarios)
- **Modified:** `.github/workflows/platform-ci.yml` (integration test job)

**Test scenarios:**
- Auth: register, login, logout, API key CRUD, password reset
- SDM: upload → clean → run → status → diagnostics → ecology → report
- Climate: list scenarios, check readiness, download

**CI:** Spin up Postgres + Redis + Plumber via Docker Compose, run migrations, execute tests, tear down.

**Acceptance:** `pnpm run test:integration` → all green.

### Week 7-8: Health Endpoints + Monitoring

**Files:**
- **New:** `api/src/routes/health.ts`
- **Modified:** `docker-compose.yml` (healthchecks on api, plumber)
- **Modified:** `prometheus.yml` (metrics configuration)

**Endpoints:**
- `GET /health` — aggregated system health (unauthenticated)
- `GET /ready` — readiness probe (200 or 503)
- `GET /health/detailed` — per-service breakdown (authenticated)
- `GET /metrics` — Prometheus metrics

**Metrics:** request count, latency (p50/p95/p99), queue depth, running jobs, DB connections, memory.

**Acceptance:**
```bash
curl http://localhost:4000/health
# → {"status":"ok","checks":{"postgres":{"status":"ok","latency_ms":2},"redis":{...},"plumber":{...}}}
docker compose ps → all services show "healthy"
```

---

## Phase 1: R XAI Engine (Weeks 1-8, parallel with Phase 0)

### Goal
Build 4 R modules that produce explanations for SDM model runs. Pure statistical methods. No AI training, no external API calls. Fully offline and deterministic.

### New Directory

```
R/xai/
  xai_importance.R       ← Enhanced permutation importance
  xai_shap.R             ← SHAP values via fastshap/kernelshap
  xai_counterfactual.R   ← Counterfactual what-if search
  xai_explain.R          ← Rule-based natural language summary
  xai_llm.R              ← Optional LLM fluency pass (uses user's LLM key)
  xai_helpers.R          ← Shared utilities (predict_wrapper, sampling)
```

### Package Dependencies

Add to `R/core/packages.R` (in `sdm_optional_packages`):
```r
"fastshap",   # Fast SHAP value approximation
"kernelshap", # Kernel SHAP (fallback)
"shapviz",    # SHAP visualization data
```

Add to `plumber/Dockerfile` (stage 2):
```dockerfile
RUN R --no-save --no-restore <<'EOF'
options(repos = c(CRAN = Sys.getenv("R_CRAN_REPO")))
for (pkg in c("fastshap", "kernelshap", "shapviz")) {
  install.packages(pkg, Ncpus=1, INSTALL_opts = c("--no-test-load"))
}
EOF
```

Add to `DESCRIPTION` (Suggests): `fastshap, kernelshap, shapviz`

### Week 1: `xai_importance.R`

**Function:**
```r
xai_importance(
  result,              # Full result object from run_fast_sdm()
  n_perm = 50,         # Permutations per variable (was 5)
  use_held_out = TRUE, # Hold out 20% for evaluation
  n_cores = 1,         # Parallel via future.apply
  seed = 42
) -> data.frame(variable, importance, sd, baseline, ci_lower, ci_upper)
```

**Improvements over existing `permutation_importance()`:**
- Default `n_perm` increased from 5 to 50 (10x more stable)
- Parallel execution via `future.apply::future_lapply` (was `parallel::parLapply`)
- Stratified held-out sampling (presence/background balance)
- Generic `predict_wrapper()` dispatches for all 9+ model backends (was 4 hardcoded)
- 95% confidence intervals on importance estimates

**Tests:** 3 test files covering structure, cross-model-type, and small-dataset edge cases.

### Week 2-4: `xai_shap.R`

**Function:**
```r
xai_shap(
  result,              # Full result from run_fast_sdm()
  background_n = 200,  # Background samples for reference distribution
  n_sim = 1000,        # Monte Carlo simulations per feature
  seed = 42,
  method = c("fast", "exact")
) -> list(
  shap_values = matrix(),            # Per-observation SHAP (n_obs x n_vars)
  shap_summary = data.frame(),       # mean_abs_contribution, sd per variable
  shap_rasters = list(),             # One SpatRaster per covariate (if extent available)
  available = logical,               # FALSE if packages missing
  hint = character,                  # Install hint if unavailable
  elapsed_seconds = numeric
)
```

**Algorithm:** Monte Carlo SHAP via `fastshap::explain()`. Falls back to `kernelshap::kernelshap()` if fastshap unavailable. If both missing, returns `available = FALSE` with install hint.

**Performance budget:** <1000 obs: <30s. <10,000 cells: <5min. >100,000 cells: warning, suggest training-data-only.

**Tests:** Structure, SHAP vs permutation correlation, missing-package graceful failure.

### Week 5-6: `xai_counterfactual.R`

**Function:**
```r
xai_counterfactual(
  result,               # Full result from run_fast_sdm()
  lat, lon,             # Target location
  target_suitability,   # Desired suitability (0-1)
  n_steps = 5,          # Intermediate steps to show
  distance_metric = c("mahalanobis", "euclidean"),
  seed = 42
) -> list(
  feasible = logical,                    # Target reachable?
  original_suitability = numeric,
  target_suitability = numeric,
  steps = data.frame(step, variable_changed, delta, new_value, intermediate_suitability),
  distance = numeric,                    # Mahalanobis distance travelled
  n_variables_changed = integer
)
```

**Algorithm:**
1. Extract covariate values at (lat, lon)
2. Find cells in env_train where suitability is within ±0.05 of target
3. Measure Mahalanobis distance from current point to each candidate
4. Return closest path with intermediate steps

**Edge cases:** out-of-extent, already-at-target, impossible target.

### Week 7-8: `xai_explain.R` + `xai_llm.R`

**Rule engine (`xai_explain.R`):**
```r
xai_explain(
  result,
  importance_result = NULL,
  shap_result = NULL,
  detail_level = c("standard", "brief", "comprehensive")
) -> list(
  generated_at,  # ISO timestamp
  sections = list(
    summary, performance, key_drivers, response_shapes,
    spatial_patterns, uncertainty, ecology, recommendations
  )
)
```

**8 sections, each rule-based:**
1. **Summary:** "The [model] for [species] performed [well/moderately/poorly] with AUC=[value]"
2. **Performance:** AUC, TSS, CBI with qualitative labels
3. **Key Drivers:** Top variables from importance/SHAP
4. **Response Shapes:** Unimodal/monotonic/flat per covariate (rule-classified from curve shape)
5. **Spatial Patterns:** Region descriptions from high/low suitability clusters
6. **Uncertainty:** CV spread + MESS extrapolation % + AOA coverage
7. **Conservation:** EOO/AOO with IUCN Criterion B guidance
8. **Recommendations:** If AUC<0.7 → spatial CV, if records<30 → ESM, if VIF>5 → reduce, if extrapolation>20% → caution

**LLM pass (`xai_llm.R`):**
```r
xai_explain(..., llm = list(enabled = TRUE, provider = "openai", ...))
```

- Optional. Uses user's LLM key from `user_settings.llm_config`
- Receives structured rule output, rephrases for fluency
- **Safety:** `validate_no_numeric_drift()` checks LLM output against rule source. If any numeric value drifts >0.01, falls back to rule text for that section.
- Supports OpenAI, Anthropic, Ollama
- Logs token usage to `agent_usage_logs`

---

## Phase 2: XAI Plumber Endpoints (Weeks 9-11)

### Goal
Expose the 4 R XAI modules through the existing Plumber API. Structured JSON responses for consumption by any client.

### New Files

- **`plumber/R/xai_endpoints.R`** — 4 endpoint handlers (~150 lines)
- **`plumber/R/xai_utils.R`** — shared helpers (~50 lines)

### Endpoints

| Endpoint | Method | R Function Called | Returns |
|---|---|---|---|
| `/api/v1/xai/importance/:runId` | GET | `xai_importance()` | `{status, data: {n_variables, n_perm, importance: [{variable, importance, sd, baseline, ci_lower, ci_upper}]}}` |
| `/api/v1/xai/shap/:runId` | POST | `xai_shap()` | `{status, data: {n_variables, n_observations, elapsed_seconds, summary: [{variable, mean_abs_contribution}], has_rasters, raster_paths?}}` |
| `/api/v1/xai/counterfactual/:runId` | POST | `xai_counterfactual()` | Body: `{lat, lon, target_suitability}`. Returns full counterfactual result. |
| `/api/v1/xai/explanation/:runId` | POST | `xai_explain()` | Body: `{detail_level, llm: {enabled, provider, model}}`. Returns 8-section explanation. |

### Hono Proxy Routes (Optional)

**New file:** `api/src/routes/xai.ts` — 4 Hono routes proxying to Plumber, adding JWT auth and user context.

Mount in `api/src/index.ts`:
```typescript
import { xaiRoutes } from './routes/xai'
app.route('/api/v1/xai', xaiRoutes)  // All behind authMiddleware
```

The XAI endpoints inherit the user's JWT context. If `llm.enabled=true` is passed, the Hono route decrypts `user_settings.llm_config` and passes the user's LLM key to Plumber.

### Acceptance

```bash
curl -X POST "http://localhost:8000/api/v1/xai/importance/run-20260527-001"
# → {"status":"success","data":{"n_variables":8,"importance":[...]}}

curl -X POST "http://localhost:8000/api/v1/xai/explanation/run-20260527-001" \
  -d '{"detail_level":"standard","llm":{"enabled":false}}'
# → {"status":"success","data":{"sections":[...],"llm_used":false}}

curl -X POST "http://localhost:8000/api/v1/xai/counterfactual/run-20260527-001" \
  -d '{"lat":-33.8,"lon":151.2,"target_suitability":0.9}'
# → {"status":"success","data":{"feasible":true,"steps":[...]}}
```

---

## Phase 3a: MCP Servers (Weeks 12-19)

### Goal
Build 2 MCP servers + meta-MCP orchestrator. Each MCP tool requires the user's platform API key.

### Week 12-13: Shared Library

```
packages/mcp/
  src/
    executor.ts          ← Executor interface
    r-executor.ts        ← Rscript child process manager
    http-executor.ts     ← Plumber HTTP client (for sdm-mcp)
    rule-loader.ts       ← JSON rule file loader + Zod validation
    errors.ts            ← MCPToolError + error codes
    types.ts             ← MCP-specific types
    index.ts             ← barrel export
  package.json           ← @sdm/mcp-shared
  tsconfig.json
```

**Key implementation: `http-executor.ts`**

```typescript
export class HttpExecutor implements Executor {
  constructor(
    private baseUrl: string,    // Plumber URL (e.g., http://localhost:8000)
    private apiKey: string      // User's platform API key (from tool param)
  ) {}

  async execute(script: string): Promise<ExecutorResult> {
    const [method, path, body] = JSON.parse(script)
    const url = `${this.baseUrl}${path}`

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: body ? JSON.stringify(body) : undefined
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          stdout: JSON.stringify(data),
          stderr: data?.error?.message || `HTTP ${response.status}`,
          exitCode: response.status,
          error: { code: data?.error?.code || 'http_error', message: data?.error?.message }
        }
      }

      return { success: true, stdout: JSON.stringify(data), stderr: '', exitCode: 0, data }
    } catch (e) {
      return { success: false, stdout: '', stderr: (e as Error).message, exitCode: -1,
               error: { code: 'connection_error', message: (e as Error).message } }
    }
  }

  async isAvailable(): Promise<boolean> {
    try { const r = await fetch(`${this.baseUrl}/health`); return r.ok }
    catch { return false }
  }
}
```

### Week 14-16: sdm-mcp Server (14 tools)

```
.opencode/mcp/sdm-mcp/
  src/
    index.ts              ← MCP server entry, stdio transport
    tools/
      model-list.ts       ← sdm_model_list
      model-recommend.ts  ← sdm_model_recommend (rule-based, no HTTP)
      model-run.ts        ← sdm_model_run
      model-status.ts     ← sdm_model_status
      model-cancel.ts     ← sdm_model_cancel
      model-compare.ts    ← sdm_model_compare
      data-validate.ts    ← sdm_data_validate
      data-gbif.ts        ← sdm_data_search_gbif
      covariate-list.ts   ← sdm_covariate_list
      covariate-check.ts  ← sdm_covariate_check
      xai-importance.ts   ← sdm_xai_importance
      xai-shap.ts         ← sdm_xai_shap
      xai-explain.ts      ← sdm_xai_explain
      report.ts           ← sdm_report
  rules/
    model-recommendations.json
    config-schema.json
  package.json
  tsconfig.json
```

**Tool handler pattern (every tool validates api_key):**

```typescript
server.tool(
  'sdm_model_run',
  {
    api_key: z.string().describe('Your platform API key from Settings → API Keys'),
    species: z.string(),
    modelId: z.string(),
    biovars: z.array(z.number().min(1).max(19)).min(2),
    projectionExtent: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  },
  async (args) => {
    // 1. Validate API key
    const user = await validateApiKey(args.api_key)
    if (!user) {
      return { content: [{ type: 'text', text: 'Invalid API key. Get one from Settings → API Keys.' }], isError: true }
    }

    // 2. Execute tool as this user
    const executor = new HttpExecutor(PLUMBER_URL, args.api_key)
    const result = await executor.execute(JSON.stringify(['POST', '/api/v1/models/run', args]))

    // 3. Return result
    if (!result.success) {
      return { content: [{ type: 'text', text: JSON.stringify(result.error) }], isError: true }
    }
    return { content: [{ type: 'text', text: JSON.stringify(result.data) }] }
  },
  { read_only_hint: false, idempotent_hint: false }
)
```

### Week 17-18: devtools-mcp Server (8 tools)

```
.opencode/mcp/devtools-mcp/
  src/
    index.ts
    tools/
      r-function-info.ts
      r-package-sync.ts
      r-parse.ts
      plumber-endpoints.ts
      plumber-endpoint-detail.ts
      audit-release.ts
      audit-file-structure.ts
      audit-docker-health.ts
  rules/
    package-vectors.json
    expected-files.json
    forbidden-patterns.json
  package.json
  tsconfig.json
```

Same auth pattern: every tool validates `api_key` against PostgreSQL.

devtools-mcp uses `RExecutor` (Rscript child process) for R-dependent tools and pure filesystem operations for others.

### Week 19: meta-MCP Orchestrator

```
.opencode/mcp/meta-mcp/
  src/
    index.ts              ← Spawns children, aggregates tools, protocol mode
  rules/
    server-registry.json  ← Which servers to spawn
    pipeline-templates.json ← Preflight, full_run, xai_only templates
    health-thresholds.json ← Restart limits, stale rule thresholds
  package.json
  tsconfig.json
```

**Protocol mode (`MCP_PROTOCOL_MODE=true`):** Filters tool surface to only `sdm_*` tools. Ecologists see a clean surface. Developers see everything.

**Pipeline templates:**
- `preflight`: check climate + model availability (parallel)
- `full_run`: configure → run → XAI importance → XAI explain (sequential)
- `xai_only`: run XAI on existing run

---

## Phase 3b: Agent Service + Admin API (Weeks 20-28)

### Goal
Build user-facing and admin-facing agent services with BYOK LLM integration. Build separate admin API on port 4005.

### Week 20: User Agent Skeleton

**New file:** `api/src/routes/agent.ts`

```typescript
const agentRoutes = new Hono()
agentRoutes.use('*', authMiddleware)

agentRoutes.get('/status', async (c) => {
  const user = c.get('user')
  const llmConfig = await getDecryptedLLMConfig(user.id)
  return c.json({
    available: !!llmConfig?.encrypted_key,
    provider: llmConfig?.provider || null
  })
})

agentRoutes.post('/chat', async (c) => {
  const user = c.get('user')
  const llmConfig = await getDecryptedLLMConfig(user.id)
  if (!llmConfig?.encrypted_key) {
    return c.json({ error: 'llm_not_configured',
                    message: 'Configure your LLM API key in Settings' }, 400)
  }

  const { message, stream } = await c.req.json()
  // Agent uses user's LLM key + SDM tools to plan and execute
  const response = await userAgent.run({
    userId: user.id,
    message,
    llmKey: llmConfig.key,
    provider: llmConfig.provider,
    stream
  })
  return c.json(response)
})
```

### Week 21: User Agent Planner + Executor

**Files:**
- `api/src/agent/planner.ts` — LLM-based step planning
- `api/src/agent/executor.ts` — Step execution (calls Plumber API)

**Planning prompt:**

```
You are an SDM (Species Distribution Modelling) agent. You help ecologists
run and interpret species distribution models.

Your capabilities:
- Search GBIF for occurrence records
- Validate and clean occurrence data
- Recommend model algorithms based on data quality
- Configure and run SDM models
- Interpret results (variable importance, SHAP, response curves)
- Assess conservation status (EOO/AOO, IUCN criteria)
- Compare model runs
- Explain model diagnostics in plain language

Rules:
1. Always check data quality before running a model.
2. Ask for confirmation before running any model (costs compute time).
3. Explain diagnostics in plain language — avoid jargon unless the user
   has demonstrated expertise.
4. Be honest about uncertainty — if a model performs poorly, say so.
5. Never claim a species is threatened based solely on SDM results.
6. Never modify or delete user data without explicit confirmation.
7. If data has <30 records, recommend ESM (Ensemble of Small Models).
```

**Planner returns a step plan:**
```json
{
  "steps": [
    {"tool": "sdm_data_search_gbif", "args": {"species": "Acacia longifolia"}, "description": "Search GBIF for occurrence records"},
    {"tool": "sdm_model_recommend", "args": {"n_records": 247}, "description": "Recommend model algorithm"},
    {"tool": "sdm_model_run", "args": {...}, "description": "Run SDM model"},
    {"tool": "sdm_xai_explain", "args": {"run_id": "..."}, "description": "Generate explanation"}
  ]
}
```

### Week 22-23: User LLM Key Management

**Files:**
- Modified: `api/src/services/encryption.ts` (key encryption/decryption)
- Modified: `api/src/routes/settings.ts` (LLM config endpoints)

**Settings endpoint:**
```http
POST /api/v1/settings
Authorization: Bearer <user_jwt>
Body: {
  "llm_provider": "openai",
  "llm_planning_model": "gpt-4o",
  "llm_chat_model": "gpt-4o-mini",
  "llm_api_key": "sk-..."  // Encrypted to user_settings.llm_config
}
```

**`user_settings.llm_config` schema:**
```json
{
  "provider": "openai",
  "model_planning": "gpt-4o",
  "model_chat": "gpt-4o-mini",
  "encrypted_key": "<aes-256-gcm ciphertext>",
  "key_preview": "sk-...abc123",
  "configured_at": "2026-06-01T12:00:00Z"
}
```

**`GET /api/v1/settings/llm/usage` — token tracking:**
```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "tokens_in": 15000,
  "tokens_out": 42000,
  "estimated_cost_usd": 0.42,
  "this_month": true
}
```

### Week 24: Admin API Skeleton

**New file:** `api/src/admin-index.ts` — separate Hono app on port 4005

```typescript
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { logger } from "hono/logger"
import { adminApiKeyAuth } from "./middleware/admin-auth"
import { adminRoutes } from "./routes/admin/index"

const app = new Hono()
app.use("*", logger())
app.use("/api/v1/admin/*", adminApiKeyAuth)
app.route("/api/v1/admin", adminRoutes)

const port = parseInt(process.env.ADMIN_API_PORT || "4005")
serve({ fetch: app.fetch, port })
```

**New file:** `api/src/middleware/admin-auth.ts` — X-Admin-API-Key only. Validates against `api_keys` table, requires admin role.

**Admin agent endpoints:**
- `GET /api/v1/admin/agent/status` — check if admin LLM configured
- `POST /api/v1/admin/agent/chat` — admin agent chat (uses admin's key from user_settings)
- `GET /api/v1/admin/users` — list users
- `GET /api/v1/admin/users/:id` — get user details
- `PUT /api/v1/admin/users/:id/suspend` — suspend user
- `GET /api/v1/admin/system-settings` — view system config
- `PUT /api/v1/admin/system-settings` — update system config
- `GET /api/v1/admin/health/detailed` — full health diagnostics
- `GET /api/v1/admin/jobs/stuck` — find stuck jobs
- `POST /api/v1/admin/jobs/:id/cancel` — cancel job
- `POST /api/v1/admin/maintenance/run` — run maintenance
- `GET /api/v1/admin/audit` — query audit logs
- `GET /api/v1/admin/reports/usage` — usage report

### Week 25-26: Frontend Agent Chat UI

**New page:** `frontend/src/app/(dashboard)/agent/page.tsx`

**Components:**
- Chat message list (user + agent messages)
- Streaming response display
- Step progress indicator
- Confirmation dialogs (before model runs)
- Run result previews (inline suitability map, importance chart)
- Conversation history sidebar
- Usage display: "This session: ~$0.04 in LLM credits (your key)"

**New page:** `frontend/src/app/(dashboard)/settings/llm/page.tsx`

- LLM provider dropdown (OpenAI, Anthropic, Ollama)
- API key input (password-masked)
- Model selection (planning + chat models)
- Test connection button
- Usage dashboard (tokens in/out, estimated cost, this month / all time)

### Week 27: MCP Remote Auth (HTTP Transport)

Add HTTP transport to MCP servers, gated behind JWT or API key authentication.

```yaml
# meta-mcp rules/server-registry.json — HTTP transport config
{
  "servers": [
    {
      "name": "sdm-mcp",
      "transport": {
        "http": {
          "port": 4002,
          "auth_required": true,
          "auth_type": "jwt_or_api_key"
        }
      }
    }
  ]
}
```

When accessed via HTTP:
- Client sends `Authorization: Bearer <jwt>` or `X-API-Key` header
- MCP server validates against PostgreSQL
- If invalid: MCP error response, tool calls rejected
- If valid: routes to Hono with `X-Hono-Internal` + `X-Forwarded-User`

### Week 28: Documentation + Hardening

- README for each MCP server
- "Bring Your Own API Key" guide for users
- Admin API setup documentation
- Security review signoff
- Integration tests for auth failure paths

---

## Agent Architecture: User vs Admin

| Aspect | User Agent | Admin Agent |
|---|---|---|
| **API** | `POST /api/v1/agent/chat` (port 4000) | `POST /api/v1/admin/agent/chat` (port 4005) |
| **Auth** | JWT (logged-in user) | X-Admin-API-Key only |
| **LLM key** | User's key from `user_settings.llm_config` | Admin user's key from `user_settings.llm_config` |
| **Tools** | SDM tools (run model, diagnostics, explain) | System tools (users, health, jobs, audit) |
| **Scope** | Single user, single project | Whole platform |
| **Rate limits** | Per-user (model runs + LLM tokens) | Per-platform (admin only) |
| **Audit** | Logged to user activity | Logged to admin audit log |
| **UI** | Dashboard Agent tab | Dashboard Admin panel |
| **Without key** | Shows "configure your LLM key" | Shows "configure your admin LLM key" |
| **Network** | Public (behind TLS) | localhost only. Not public. |

---

## Key Security Properties

| Threat | Mitigation |
|---|---|
| External AI calls admin agent without auth | Admin port 4005 is localhost-only. Requires X-Admin-API-Key. |
| External AI calls user agent without auth | Agent routes use authMiddleware. Returns 401 without JWT. |
| External AI uses someone else's LLM key | Agent only uses the authenticated user's key from DB. |
| AI assistant calls MCP tools without auth | Every MCP tool requires api_key parameter. Validated against DB. Returns 401 if invalid. |
| Platform LLM costs spiral | Platform never holds an LLM key. Every LLM call is user-specific. |
| Admin agent runs unauthorized actions | Admin system prompt restricts destructive actions. Confirmation required for: suspend user, cancel job, update config. |
| LLM key leaks via logs | Keys are never logged. Encrypted at rest. |
| MCP servers exposed to network | HTTP transport requires JWT or API key. |

---

## Database Changes

### New Tables

```sql
-- Track agent conversation state
CREATE TABLE agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  current_plan JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track user LLM usage (tokens, cost)
CREATE TABLE agent_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES agent_conversations(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  estimated_cost_usd NUMERIC(10,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_usage_user ON agent_usage_logs(user_id, created_at);
```

### Modified Tables

```sql
-- Add LLM config to existing user_settings table
ALTER TABLE user_settings ADD COLUMN llm_config JSONB;
```

---

## Configuration Surface

### User Settings (Dashboard)

```
Settings → API Keys → LLM Provider:

  Provider:    [OpenAI ▼]
  Plan model:  [gpt-4o          ▼]
  Chat model:  [gpt-4o-mini     ▼]
  API Key:     [••••••••••••••••••]  [Save] [Test Connection]

  Supported: OpenAI, Anthropic, Ollama (local)
  Your key is encrypted at rest. Never logged.

  Usage this month:
  ├── Planning:  8,500 tokens in  /  12,000 tokens out  (~$0.32)
  ├── Chat:      6,500 tokens in  /  30,000 tokens out  (~$0.10)
  └── Total:    15,000 tokens in  /  42,000 tokens out  (~$0.42)
```

### Admin Environment (no LLM key in env vars)

```bash
# Admin API config — tells admin agent which admin user's key to use
ADMIN_API_PORT=4005
ADMIN_LLM_USER_ID=uuid-of-admin-user  # LLM key loaded from this user's settings
```

The admin agent loads the LLM key from the designated admin user's `user_settings.llm_config`, same encryption as the user agent. No platform-managed keys in env vars.

---

## Docker Compose

```yaml
# docker-compose.yml additions
services:
  api:
    # ... existing user API on port 4000 ...

  admin-api:
    build:
      context: .
      dockerfile: Dockerfile.api
    command: ["node", "dist/admin-index.js"]
    ports:
      - "127.0.0.1:4005:4005"  # localhost only
    environment:
      ADMIN_API_PORT: "4005"
      DATABASE_URL: "${DATABASE_URL}"
    networks:
      - sdm-network
    profiles:
      - admin  # Opt-in, not started by default
    depends_on:
      - postgres
      - redis
```

---

## Complete Timeline

```
Week:  0    4    8    12   16   20   24   28   32
      ├────┴────┴────┴────┴────┴────┴────┴────┴────┤

Phase 0: Platform Stability
      [err handling][OpenAPI][integration tests][health+monitoring]
                                              (8 wks)

Phase 1: R XAI Engine (parallel)
      [importance][===SHAP===][counterfactual][explain+llm]
                                              (8 wks)

Phase 2: XAI Plumber Endpoints
                        [4 endpoints][Hono routes][frontend]
                                              (3 wks)

Phase 3a: MCP Servers
                        [packages/mcp/][sdm-mcp 14 tools]
                        [devtools-mcp 8 tools][meta-mcp][docs]
                                              (8 wks)

Phase 3b: Agent + Admin API
                                          [user agent skeleton]
                                          [planner+executor]
                                          [key management]
                                          [admin API skeleton]
                                          [frontend UI]
                                          [MCP remote auth]
                                          [docs + hardening]
                                              (9 wks)

First XAI working:        Week 9   (Plumber endpoints live)
First MCP server:         Week 13  (sdm-mcp live)
First agent chat:         Week 24  (user agent available in dashboard)
Full platform complete:   Week 28  (admin API, MCP remote auth, all docs)
```

---

## Risk Register

| Risk | Phase | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| SHAP too slow for practical use | 1 | Medium | High | Benchmark by Week 3. If >30min for 10k cells, ship with warning + training-data-only SHAP |
| fastshap/kernelshap unavailable | 1 | Low | Medium | Pin CRAN versions. Pure-R Monte Carlo fallback. |
| Plumber API changes break MCP tools | 0, 3 | Medium | Low | Integration tests catch breakage. Thin wrappers — fix in <1hr |
| No one uses MCP servers | 3a | Medium | Low | Phase 3a is last. If Phase 0-2 generates enough API value, MCP is optional |
| Agent LLM costs burn user's budget | 3b | Medium | Low | Usage dashboard shows cost. User sets their own API key limits at provider. |
| R not available on dev machine | 3a | High | Low | devtools-mcp degrades gracefully. Non-R tools still work. |
| Admin operator doesn't configure LLM key | 3b | Medium | Low | Admin agent shows "configure your key." Platform ops work without agent. |

---

## Key Decisions

| Decision | Rationale |
|---|---|
| **2 MCP servers, not 8** | Each omitted server duplicates existing API endpoints or does trivial filesystem work |
| **XAI ships as Plumber endpoints first** | Fastest path to users. API-first = any client can consume |
| **Domain verticals deferred** | Speculative. Validate demand before investing months of work |
| **User agent uses BYOK LLM** | User pays for their own LLM usage. Platform never holds an LLM key |
| **Admin agent also uses BYOK LLM** | Same rule. Admin operator configures their key in admin settings. |
| **MCP tools require api_key parameter** | Every call authenticated against PostgreSQL. No anonymous access. |
| **meta-MCP protocol mode replaces separate gateway** | One flag changes the tool surface. No duplicate infrastructure |
| **No LLM key in environment variables** | All LLM keys stored encrypted in user_settings. Decrypted per-request. |
| **Admin API on separate port (4005)** | Security isolation. localhost-only. Separate auth mechanism. |
| **No separate protocol spec document** | meta-MCP capability advertisement IS the protocol |
| **No adapter layer for external platforms** | No evidence anyone wants this. Defer. |
| **Rule refresh writes files, never amends commits** | Safer. No history rewriting. User stages changes manually. |
| **Phase 0 (stability) mandatory before MCP** | Wrapping an unreliable API in MCP multiplies debugging surface |

---

## File Change Summary

### New Files

| File | Phase | Purpose |
|---|---|---|
| `api/src/middleware/error-handler.ts` | 0 | Centralized error response format |
| `api/src/routes/health.ts` | 0 | Health + readiness + metrics endpoints |
| `api/src/routes/xai.ts` | 2 | Hono proxy routes for XAI endpoints |
| `api/src/routes/agent.ts` | 3b | User agent chat endpoint |
| `api/src/admin-index.ts` | 3b | Admin API entry point (port 4005) |
| `api/src/middleware/admin-auth.ts` | 3b | X-Admin-API-Key authentication middleware |
| `api/src/routes/admin/agent.ts` | 3b | Admin agent chat endpoint |
| `api/src/routes/admin/users.ts` | 3b | User management endpoints |
| `api/src/routes/admin/system.ts` | 3b | System config + maintenance endpoints |
| `api/src/routes/admin/jobs.ts` | 3b | Job management endpoints |
| `api/src/routes/admin/audit.ts` | 3b | Audit log query endpoints |
| `api/src/agent/planner.ts` | 3b | LLM-based step planning |
| `api/src/agent/executor.ts` | 3b | Step execution (calls Plumber API) |
| `api/src/agent/state.ts` | 3b | Conversation state management |
| `api/src/agent/prompts/system-prompt.txt` | 3b | User agent system prompt |
| `docs/openapi.yaml` | 0 | Full API specification |
| `R/xai/xai_importance.R` | 1 | Enhanced permutation importance |
| `R/xai/xai_shap.R` | 1 | SHAP values |
| `R/xai/xai_counterfactual.R` | 1 | Counterfactual what-if search |
| `R/xai/xai_explain.R` | 1 | Rule-based natural language summary |
| `R/xai/xai_llm.R` | 1 | Optional LLM fluency pass |
| `R/xai/xai_helpers.R` | 1 | Shared XAI utilities |
| `plumber/R/xai_endpoints.R` | 2 | 4 Plumber XAI endpoints |
| `plumber/R/xai_utils.R` | 2 | Shared Plumber XAI helpers |
| `packages/mcp/` (8 files) | 3a | Shared MCP library |
| `.opencode/mcp/sdm-mcp/` (16 files) | 3a | sdm-mcp server (14 tools) |
| `.opencode/mcp/devtools-mcp/` (10 files) | 3a | devtools-mcp server (8 tools) |
| `.opencode/mcp/meta-mcp/` (8 files) | 3a | Orchestrator + pipeline templates |
| `.opencode/mcp/scripts/install-hooks.ts` | 3a | Git hook installer |
| `api/tests/integration/auth-flow.test.ts` | 0 | Auth integration tests |
| `api/tests/integration/sdm-flow.test.ts` | 0 | SDM workflow integration tests |
| `api/tests/integration/climate-flow.test.ts` | 0 | Climate integration tests |
| `tests/testthat/test-xai-importance.R` | 1 | XAI unit tests |
| `tests/testthat/test-xai-shap.R` | 1 | XAI unit tests |
| `tests/testthat/test-xai-counterfactual.R` | 1 | XAI unit tests |
| `tests/testthat/test-xai-explain.R` | 1 | XAI unit tests |
| `frontend/src/app/(dashboard)/agent/page.tsx` | 3b | Agent chat UI |
| `frontend/src/app/(dashboard)/settings/llm/page.tsx` | 3b | LLM key configuration page |

### Modified Files

| File | Phase | Change |
|---|---|---|
| `plumber/R/plumber.R` | 0 | Structured errors, timeout monitoring, source xai_endpoints.R |
| `api/src/index.ts` | 0 | Mount health routes, version header, mount XAI routes |
| `api/src/services/encryption.ts` | 3b | LLM key encryption/decryption methods |
| `api/src/routes/settings.ts` | 3b | LLM config GET/PUT endpoints |
| `R/core/packages.R` | 1 | Add fastshap, kernelshap, shapviz |
| `plumber/Dockerfile` | 1 | Install 3 XAI packages |
| `DESCRIPTION` | 1 | Add 3 packages to Suggests |
| `renv.lock` | 1 | Pin package versions |
| `.github/workflows/platform-ci.yml` | 0, 3a | Integration test + MCP build jobs |
| `docker-compose.yml` | 0, 3b | Healthchecks, admin-api service |
| `packages/shared/src/types.ts` | 2 | XAI result types |
| `packages/shared/src/schemas.ts` | 0 | OpenAPI generation support |

---

This plan is ready for implementation. Each phase has specific files, acceptance criteria, risk mitigations, and performance budgets.
