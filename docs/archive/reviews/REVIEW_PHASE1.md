# Phase 1 — Architecture and Modularity

## Request Path Diagram

```
Browser
  │ https://hostname:3000
  ▼
Next.js (port 3000)
  ├── Routes: `/` dashboard, `/data`, `/model`, `/results/:runId`, `/ecology`,
  │           `/batch`, `/evaluate`, `/settings`, `/profile`, `/projects`,
  │           `/admin/*`, `/downloads`, `/species`
  ├── Auth guard: `auth-guard.tsx` wraps (dashboard) routes
  ├── State: Zustand stores (auth, sdm, settings)
  ├── API client: `services/api.ts` → fetches to `NEXT_PUBLIC_API_URL`
  └── WebSocket: `/ws?token=<jwt>` for real-time job progress
       │
       │ proxy_pass /api/* → http://api:4000
       ▼
Hono API (port 4000)
  ├── Middleware stack (applied in order):
  │   ├── CORS (whitelist from FRONTEND_URL)
  │   ├── Compression
  │   ├── Logger
  │   ├── Memory monitor
  │   ├── CSRF (on POST/PUT/PATCH/DELETE to /api/v1/sdm/*, data/*, climate/*, ecology/*, projects/*)
  │   ├── Rate limiting (per-route, Redis-backed with in-memory fallback)
  │   └── Auth (JWT Bearer or X-API-Key in header)
  │
  ├── Route groups:
  │   ├── `/api/v1/sdm/*`       → `routes/sdm.ts` (model run, status, cancel, batch, config)
  │   ├── `/api/v1/data/*`      → `routes/occurrences.ts` (upload, clean, GBIF, DwCA)
  │   ├── `/api/v1/results/*`   → `routes/results.ts` (result files, downloads)
  │   ├── `/api/v1/climate/*`   → `routes/climate.ts` (scenarios, download, check)
  │   ├── `/api/v1/ecology/*`   → `routes/ecology.ts` (EOO/AOO, AOA, niche overlap)
  │   ├── `/api/v1/diagnostics/*` → `routes/diagnostics.ts` (VIF, response curves, etc.)
  │   ├── `/api/v1/auth/*`      → `routes/auth.ts` (register, login, API keys)
  │   ├── `/api/v1/projects/*`  → `routes/projects.ts` (CRUD + members)
  │   ├── `/api/v1/settings/*`  → `routes/settings.ts` (user preferences)
  │   ├── `/api/v1/admin/*`     → `routes/admin.ts` (admin panel)
  │   ├── `/api/v1/jobs/*`      → `routes/jobs.ts` (SSE, status)
  │   └── `/health`             → inline (proxy health)
  │
  ├── Services:
  │   ├── `plumber.ts`          → PlumberClient (proxies to Plumber with X-Hono-Internal header)
  │   ├── `plumber-sync.ts`     → Poll-based sync engine (DB updates, file uploads)
  │   ├── `queue.ts`            → BullMQ queue + worker (Redis-backed)
  │   ├── `websocket.ts`        → WebSocket server (JWT-authenticated)
  │   ├── `job-events.ts`       → Event emitter bus (bridges queue → WS)
  │   ├── `storage.ts`          → Garage S3 client
  │   ├── `encryption.ts`       → AES-256-GCM file encryption at rest
  │   ├── `access.ts`           → Project-scoped access control
  │   └── `audit.ts`            → Audit logging
  │
  ├── DB: Drizzle ORM → PostgreSQL (schema: users, api_keys, projects, species, runs, occurrences)
  │
  └── Proxy to Plumber:
       │ X-Hono-Internal: <PLUMBER_INTERNAL_KEY>
       │ X-Forwarded-User: <user_id>
       ▼
Plumber R (port 8000)
  ├── Auth filter (plumber/R/auth.R):
  │   ├── Open endpoints: /health, /ready, GET /api/v1/models/runs, GET /api/v1/climate/scenarios, etc.
  │   ├── X-Hono-Internal trusted path (bypasses API key check)
  │   └── X-API-Key direct auth path (SHA256 → PostgreSQL)
  │
  ├── Endpoints:
  │   ├── GET  /health
  │   ├── POST /api/v1/occurrences/upload
  │   ├── POST /api/v1/occurrences/clean         (async)
  │   ├── POST /api/v1/occurrences/gbif/search    (async)
  │   ├── POST /api/v1/occurrences/dwca           (async)
  │   ├── POST /api/v1/models/run                 (async via callr::r_bg)
  │   ├── POST /api/v1/models/cancel/:jobId
  │   ├── POST /api/v1/models/delete/:jobId
  │   ├── GET  /api/v1/models/runs
  │   ├── GET  /api/v1/models/status/:jobId
  │   ├── POST /api/v1/climate/download            (async)
  │   ├── GET  /api/v1/future/scenarios
  │   ├── GET  /api/v1/climate/scenarios
  │   └── GET  /api/v1/jobs/status/:jobId
  │
  ├── Engine: sources `R/engine_load.R` → same core as Shiny (minus UI modules)
  │   └── Calls `run_fast_sdm()` from `R/core/run_sdm.R`
  │
  └── Outputs: filesystem (`outputs/jobs/<jobId>/`) + manifest.json
```

## Architecture Verdict

**Soundness:** The macro architecture is well-designed. Each layer has a clear responsibility, and the proxying between Hono and Plumber is correctly implemented (internal key validation, user forwarding). The separation of auth middleware, rate limiting, CSRF, and route handlers follows modern web API best practices.

**Weakest link:** The Plumber sync (`plumber-sync.ts`) uses polling (5s interval) rather than webhooks or a push mechanism. This is fine for development but adds latency and unnecessary load for production. The sync also duplicates state management logic that already exists in the queue worker.

## Modularity Verdicts

### Model Backends — PLUGGABLE
- `R/models/model_registry.R` implements a formal `register_sdm_model()` function.
- Adding a new backend requires: (1) a new file with `fit_<name>_sdm()` and `predict_<name>_suitability()`, (2) one `register_sdm_model()` call.
- Current backends: GLM, GAM, rangebag, ensemble_glm_rangebag, multi_ensemble, biomod2, maxnet, esm_glm, esm_maxnet, rf, xgboost, dnn.
- Conditional registration (`if (requireNamespace(...))`) is used for packages that may not be installed — clean degradation.
- Test: `R/models/model_helpers.R` can be removed (hypothetically) and only the registry-based dispatch would break. The `register_sdm_model()` calls in `model_registry.R` are the single source of truth.

### Data Sources — CONVENTIONAL, not pluggable
- Occurrence data comes from: file upload, GBIF search, DwCA parsing.
- Each is a separate code path in `plumber/R/plumber.R` (upload handler branches on file extension) and `api/src/routes/occurrences.ts`.
- No registry or plugin interface for adding new data sources (e.g., iNaturalist, ALA, VertNet).
- Adding a new source requires changes to at least 4 files: API route, Plumber endpoint, frontend component, and possibly the DB schema.
- Current dispatch is adequate for the 3 supported sources but not extensible without touching unrelated code.

### Ecology Toolkit — CONVENTIONAL
- `R/ecology/` modules are independent files with no registry.
- Each exports functions called by the Plumber endpoints and (potentially) by the Shiny app.
- Adding a new ecology tool: write a new file in `R/ecology/`, add a new Plumber endpoint, add a new API route, add a frontend page/component.
- `R/ecology/climate_matching.R`, `eoo_aoo.R`, `aoa.R`, `niche_overlap.R`, etc. are self-contained.
- No shared interface contract, but the low number of modules (7) keeps this manageable.

### Output Formats — CONVENTIONAL
- `R/output/` files are independent: metrics, response curves, plots, reports (ODMAP), manifest, diagnostics, batch runner, script export.
- No output format registry. Adding a new output type requires a new file + wiring it into `run_model_background` in `plumber/R/plumber.R`.
- The COG (Cloud Optimized GeoTIFF) writing is hardcoded in the model run function, not plugged into a format pipeline.

### Covariate Sources — CONVENTIONAL
- `R/covariates/` modules for climate, elevation, soil, NDVI, UV, vegetation, LULC, HFP, drought, etc.
- Each is independently loadable but they share configuration through `R/core/config.R` constants.
- Adding a new covariate source: new file + config defaults + UI checkbox.

## Modern Stack vs Legacy Shiny

**Verdict: They share the modelling core correctly.**

- `engine_load.R` (used by Plumber) sources exactly the same modules as `load.R` (used by Shiny), **minus** `R/ui/` and `R/modules/` (8 files total excluded).
- The Plumber entry point (`plumber/R/plumber.R:22-34`) sources `bootstrap.R` then `engine_load.R`. The Shiny app (`app.R`) sources `load.R`.
- Both call `run_fast_sdm()` from `R/core/run_sdm.R`.
- The `engine_load.R` pattern is the correct design: one source of truth for the modelling core, with a separate loader for the UI layer.

**Risk areas:**
- `app.R` and `R/load.R` could drift from `engine_load.R` if a new module is added to only one loader (e.g., a new Shiny-only module wouldn't break Plumber, but a new computation module added only to `load.R` would be invisible to the modern stack). Both loaders need to be updated — but they're adjacent files, so this is low risk.
- Some Shiny-UI files (`R/modules/mod_results.R`, `R/modules/mod_model_run.R`) contain computation logic that is duplicated in the Plumber endpoints. The exact duplication scope should be verified in Phase 3.

## Shared Types / API Contract

**Verdict: Hand-maintained with drift risk.**

- `packages/shared/src/types.ts` defines: `ModelBackend`, `Run`, `JobStatus`, `RunMetrics`, `BiovarChoice`, `Species`. These are used by both `api/` and `frontend/` via `@sdm/shared`.
- However, `frontend/src/services/types.ts` defines its own types (`RunSummary`, `RunDetail`, `VifData`, `ImportanceData`, `CurvePoint`, etc.) that partially overlap with `@sdm/shared` but are hand-maintained.
- The PlumberClient in `api/src/services/plumber.ts` defines its own response types (`ModelRunResponse`, `ModelStatusResponse`, `AsyncJobStatusResponse`, etc.) that are not shared with the frontend.
- **Drift risk example:** `@sdm/shared` `RunMetrics` has `auc`, `tss`, `cbi`; the frontend `RunSummary` has `metrics: Record<string, unknown> | null` — the frontend type is opaque, meaning the frontend doesn't benefit from type safety on what Plumber returns.
- The type errors found during `pnpm run check:node` confirm this: `ModelStatusResponse` and `AsyncJobStatusResponse` are not assignable to `Record<string, unknown>` in `queue.ts`.

## Frontend Architecture

- **Page routing:** Next.js 15 App Router with route groups: `(auth)` for login/register, `(dashboard)` for all authenticated pages (wrapped by `auth-guard.tsx`).
- **State management:** Zustand with `persist` middleware for auth (token excluded from persistence intentionally). SDM workflow state in a separate store without persistence.
- **API client:** Generic `apiGet<T>`, `apiPost<T>`, `apiUpload<T>` in `services/api.ts`. Uses `fetch` with `AbortSignal.timeout`. Token sent via `Authorization: Bearer` header. 401 → redirect to `/login`.
- **WebSocket:** `useJobProgress` hook at `hooks/useJobProgress.ts`. Connects via `ws://hostname/ws?token=...`. Has reconnection logic (3s backoff). Falls back to REST polling if WS unavailable.
- **Raster rendering:** `useRasterData` hook at `hooks/useRasterData.ts` loads GeoTIFF via `geotiff` library directly in the browser. Skip-loads rasters >5Mpx.
- **Components:** Domain-organized (data/, diagnostics/, ecology/, evaluate/, jobs/, climate/, batch/).
- **TypeScript errors found:** `sdm.ts:595` missing `deleteModelOutputs` on PlumberClient, `queue.ts:264` type incompatibility with `Record<string, unknown>`.

## Key Architectural Findings

1. **Plumber run_model_background is self-contained but verbose** (plumber.R:380-765). It sources `engine_load.R` fresh in a `callr::r_bg` child process. This is correct for process isolation but means the entire module loading trace runs in every child. Could be optimized with a pre-loaded session.

2. **Plumber-sync and queue worker share responsibility** for tracking run status. `plumber-sync.ts` polls Plumber's `/api/v1/models/status/:jobId` and updates the DB, while `queue.ts` also manages job lifecycle. This dual-path creates potential race conditions (both could try to write `completed_at`).

3. **The encryption at rest** (`encryption.ts`) for uploaded occurrence files is a notable security feature — files are AES-256-GCM encrypted on disk and decrypted transparently by the API before forwarding to Plumber. This is above average for a beta-stage SDM platform.

4. **Docker Compose profiles** (core, storage, computation, proxy, dev, full) allow granular service selection. The `check:compose` script validates all three compose files, including production with dummy secrets.

5. **No shared `@sdm/shared` types for Plumber responses.** The Plumber R endpoints return JSON with snake_case keys (`job_id`, `model_id`, etc.). The API proxies them through to the frontend. The shared types in `@sdm/shared` use camelCase (`jobId`, `modelId`). The conversion happens ad-hoc in route handlers — there's no automated mapping layer.
