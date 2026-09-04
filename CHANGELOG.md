# Changelog

All notable changes to the SDM Dashboard Workbench are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Performance (Group M: D10, D7, D4, D9, D2, D5, D3)

- `R/data/occurrences.R` `flag_geographic_outliers` now uses `data.table` for O(n) flagging instead of nested `lapply` O(n²) loop (D10).
- `R/data/gbif.R` `search_gbif_first` now caches results by `(species, datasetKey, continent)` triple; concurrent requests for the same species no longer spawn duplicate GBIF API calls (D7).
- `R/covariates/covariates_climate.R` `load_bioclim_tiles` now passes `terra::rast(spatRaster)` instead of a full `SpatExtent` object to `terra::crop` — crop now works correctly with named extent objects (D4).
- `R/output/raster.R` `stack_spatial_blocks` chunking loop now calls `lapply(seq_along(chunks), \(i) do.call(c, chunks[[i]])` instead of `do.call(c, chunks)` which materializes the entire list at once (D4).
- `R/ecology/eoo_aoo.R` `compute_aoo_km2` now weights each grid cell by `1/n_cells_in_occurrence_group` instead of `1/1` for equal-weighting across presence records (D2).
- `R/models/cv_engine.R` `run_single_core_cv` now catches errors in `fit_fun` and returns `NULL` for failed folds instead of propagating the error to the parallel worker, which would crash the entire CV (D5/D3).

### Cross-validation robustness (Group J: blockCV package-level scoping)

- `R/models/cv_engine.R` `cv_spatial_block` now sources `blockCV` from the global environment rather than relying on package-level scoping — the `createBlock` function was being called in the wrong environment, causing block creation to fail silently on some platforms.

### SDM prediction honesty (Group K: pdf marginal probabilities)

- `R/models/model_glm.R` `predict_sdm_fit` now uses `type = "prob"` for binomial GLM models when `any(present > 0)` (presence data), instead of `type = "response"`. The latter returns odds for logit-link binomial GLMs; `type = "prob"` correctly returns probabilities. Pseudo-absence only runs continue to use `type = "response"`.

### VIF collinearity (Group L: training-fold VIF computation)

- `R/models/model_helpers.R` `compute_vif` now computes VIF on `env_train` only (the training fold), not the full dataset. This prevents information leakage from validation fold into covariate selection and gives honest collinearity estimates for block-CV folds.

### GLM/GAM correctness (Group N: case_weight_sdm scoping fixed)

- `R/models/model_glm.R` `fit_fast_sdm`: `weights` argument now passed as local variable `cw` (computed via `class_balance_weights(model_fit_data$presence)`) instead of bare `case_weight_sdm` symbol. `environment(formula) <- environment()` is set after `make_sdm_formula()` to restore the formula's evaluation environment to `fit_fast_sdm`'s frame, so `glm()`'s internal `model.frame.default` evaluation finds `cw`. Same fix applied to `cross_validate_glm` fold fitting.
- `R/models/model_gam.R` `fit_gam_sdm` and `cross_validate_gam`: same pattern — `weights = cw` (local variable) with `environment(formula) <- environment()` after `make_gam_formula()` to override the `asNamespace("mgcv")` assignment.
- `R/models/model_registry.R` `fit_sdm_model`: `fit_fun`'s enclosing environment is now rebound to `fit_sdm_model()`'s call frame before invocation — ensures model backends called through the registry have the correct lexical scope for local variable resolution.

### Cleanup (Group N follow-up)

- `R/models/cv_engine.R`: removed dead `cluster_exports` and `cluster_setup_fn` parameters. These were declared in `cross_validate_model()` but never read — `mclapply` (fork-based) inherits the full environment, so no explicit cluster export is needed on Linux/macOS. Removed from 13 call sites across `model_glm.R`, `model_gam.R`, `model_maxnet.R`, `model_nnet.R`, `model_earth.R`, `model_mda.R`, `model_rpart.R`, `model_gbm.R`, `model_rf.R`, `model_bart.R`, `model_xgboost.R`, `model_rangebag.R`. Windows silently falls back to serial CV regardless (pre-existing behavior, documented).

### Frontend

- `frontend/src/lib/map-styles.ts`: basemap switched from CARTO raster PNG tiles to CARTO Streets v1 vector tiles (MVT) — sharper at all zoom levels, no API key required, same free CDN.

### Security (Group C: 12 ownership/authz holes closed)

- `PATCH /uploads/:fileId` now requires `eq(uploads.userId, user.id)` — was rewriting other users' `is_cleaned` flag and `cleaned_file_path` by guessed `fileId`.
- `DELETE /uploads/:fileId` fallback path now filters by `userId` — was wiping other users' on-disk `.enc` and decrypted siblings.
- `/occurrences/clean/result` now calls `assertUserOwnsUploadPath` before reading any cleaned file — was leaking coordinate data, source counts, and CC log across users via guessed `fileId`.
- `/boundary/delete/:id` now enforces ownership via a `.owner` sidecar file written at upload — any user could previously delete another user's boundary by path.
- Admin `reset-password` now uses the shared `validatePassword` (uppercase+lowercase+digit) and revokes all active `refreshTokens` rows for the target — was setting arbitrary 8-char strings without revoking sessions.
- `services/access.ts canAccessRun` now does UUID vs Plumber-jobId detection — Group B's fix in `routes/results.ts` was not propagated to ecology/diagnostics/websocket. All four callers now use the canonical version.
- Plumber `auth.R` `open_patterns` list no longer marks ecology/diagnostics as public — these endpoints now require authentication. 20 Plumber handler signatures updated to take `(req, res, ...)` so `sdm_verify_run_owner` can enforce per-run ownership against `meta$user_id`.
- Cancel handlers (`handle_climate_cancel`, `handle_job_cancel`, `handle_model_cancel`) now use `inherits(proc, "process")` (lowercase) — the previous `"Process"` (capital) check never matched `callr::r_bg` / `processx` objects whose class chain is `c("process", "R6")`. The graceful `proc$kill()` + 30×100ms poll path was being skipped, falling through to SIGKILL and leaking the registry entry.
- `plumber/R/run_server.R` rate-limit bucket key is now `substr(digest::digest("apikey:" + api_key, "sha256"), 1, 32)` instead of the raw API key — was using the secret as an environment binding name (visible via `ls(rate_limit_buckets)` and stack traces).
- Frontend `auth-guard.tsx` waits for `useAuthStore.persist.onFinishHydration` before deciding on the redirect — was bouncing returning users to `/login` on every page reload because the `partialize` excludes `token` (the SSR snapshot has `token=null` until rehydration completes).
- Frontend `_redirecting` window in `services/api.ts` tightened from 30 s to 5 s — was suppressing 401-driven `/login` redirects across all tabs for half a minute after the first one.
- `register/page.tsx` no longer calls `setAuthToken` then `setAuth` (which briefly cleared localStorage/cookie between the two writes) — single source of truth via `setAuth`.

### Robustness (Group B: Plumber outages, false-positive missing, Redis transients)

- `services/api/src/routes/climate.ts` `GET /scenarios` and `GET /check` no longer swallow Plumber failures with HTTP 200 + empty payload — now return `502 + { code: "PLUMBER_UNAVAILABLE" }`. The compose-level `longCache` middleware was caching the empty payload for 3600 s on first failure.
- `services/queue-climate-worker.ts handleCovariateJob` fails fast with `error_code: "PLUMBER_UNREACHABLE"` after `CLIMATE_DOWNLOAD_MAX_CONSECUTIVE_POLL_ERRORS` (default 5) consecutive poll errors instead of spinning for the full 30 min.
- `max_tss` threshold for `covariate_download` returns `{ status: "partial_success", failed_vars: [...] }` instead of silently masquerading as full success. Backend surfaces an explicit `state: "warning"` SSE event with the failed layer IDs.
- `services/queue.ts isRedisDownError` is now distinct from `isRedisUnavailableError` — `disableRedis()` is now only triggered by `ECONNREFUSED`/`ENOTFOUND`/`EHOSTUNREACH` (genuine Redis down). Transient `ECONNRESET`/`ETIMEDOUT`/`EPIPE` no longer disable the queue and return 503 for the next 10 s.

### Climate / covariate download flow (Group A)

- `services/routes/climate.ts` `POST /download` and `services/routes/covariates.ts` `POST /download_bg` now write `user_id` to `meta.json`. The Plumber `handle_climate_cancel` / `handle_job_cancel` / `handle_climate_download_bg` / `handle_covariates_download_bg` now enforce per-user ownership before cancel/download. `X-Forwarded-For` and `X-Real-IP` are no longer trusted by default — only honoured when the immediate socket peer is in `TRUSTED_PROXY_CIDRS`.

### Scientific output honesty (Group D)

- `R/core/run_sdm.R:395-396` no longer NULLs `env$env_train` 700 lines before `project_future_suitability` runs. The future-projection path was silently producing no output for every run with `future_projection=TRUE`. Now captured into a `mess_train_data` parameter and passed explicitly.
- `max_tss` threshold adds explicit `nnet` and `ranger` branches; any fallback failure logs a `WARN: max_tss could not be computed for backend 'X'` and leaves threshold as `NA_real_`. The companion `select_threshold` returns `NA_real_` instead of `0.5` when `N < 3` in either presence or background.
- `cleaned$raw <- NULL` (line 269) no longer leaves the manifest's `attr(cleaned$raw, "dwca_datasets")` permanently NULL — the manifest now reads `cleaned$dwca_datasets`, `cleaned$dwca_issues`, `cleaned$gbif_doi` which are preserved before NULL'ing.
- 7 model backends (`bart`, `earth`, `gbm`, `maxnet`, `mda`, `nnet`, `rpart`) replaced the `if (!all(is.finite(vals))) return(rep(NA_real_, nrow(vals)))` pattern with a shared `sdm_apply_predict` helper in `R/models/model_helpers.R` that masks row-wise — one bad cell no longer NA's out an entire chunk.
- `R/covariates/covariates_climate.R find_worldclim_files` now filters matched candidates with `is_valid_geotiff` — was returning cached paths even for stale 404.html pages saved with `.tif` extensions.

### Infrastructure hardening (Group E)

- `email.ts sendPasswordResetEmail` no longer prints the full resetUrl to stdout in production — only logs a NODE_ENV-gated summary line. `seed-admin.ts` only prints the generated `ADMIN_PASSWORD` when `process.stdout.isTTY` (CI/pipe runs see a "hidden" placeholder).
- `plumber/R/run_server.R` rate-limit bucket key is now SHA-256-hashed (see Security above).
- `docker-compose.prod.yml` Plumber env now sets both `DATA_ENCRYPTION_KEY` and `SDM_ENCRYPTION_KEY` to the same value — `R/core/crypto.R` reads `DATA_ENCRYPTION_KEY` first, the TypeScript `encryption.ts` had been reading `DATA_ENCRYPTION_KEY` only. Plumber previously encrypted with one key and the API decrypted with another.
- `garage.toml` no longer has `CHANGEME-run-openssl-rand-hex-32-...` literal secrets checked into the repo — the file now points operators at the env-var override path (`GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, `GARAGE_METRICS_TOKEN`) for production.
- All 6 Dockerfiles (`Dockerfile`, `Dockerfile.api`, `Dockerfile.frontend`, `plumber/Dockerfile{,.cuda,.rocm}`) now have `HEALTHCHECK` directives matching the compose-level probes.
- New `api/src/middleware/client-ip.ts getClientIp(c)` only honours `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` when the immediate socket peer is in `TRUSTED_PROXY_CIDRS` (comma-separated CIDR list, env var). Without it, returns `"unknown"` for audit and rate-limit key (forcing single shared bucket — safer than spoofable per-attacker buckets).

### Type contract (Group F)

- `packages/shared/src/plumber-types.ts` no longer contains the 13 hand-written interface drift sources. Now only `PlumberUploadResponse` and `PlumberJobLogs` (the two with live consumers). The auto-generated `PlumberSchemas` map (from Plumber's actual OpenAPI components) plus per-endpoint discriminated-union response types are the source of truth.
- `api/scripts/generate-plumber-types.ts` no longer hand-writes a tail of response interfaces that drifted from runtime (e.g. `PlumberHealthResponse` declared 3 fields while `handle_health()` returns 6; `PlumberClimateStatus` declared `job_id` while `handle_climate_status()` returns `id`).
- `api/src/services/plumber.types.contract.test.ts` greps the R source to assert runtime fields exist, and greps the generator to assert no hand-written drift-prone interfaces remain.

### Observability (Group H)

- `api/src/services/metrics.ts setActiveRequests(1)` replaced with `incActiveRequests` / `decActiveRequests` backed by a real module-local counter (prom-client Gauge has no `inc`/`dec` — only `set`). The Hono metrics middleware in `api/src/index.ts` now wraps in `try/finally` so even a thrown handler decrements the counter. The gauge was stuck at 1 forever; now reflects true in-flight count.
- New `api/src/middleware/request-id.ts` reads `X-Request-ID` (or generates UUID v4), stores on `c.var.requestId`, echoes on response. `extractClientInfo` in `api/src/services/audit.ts` threads it into `audit_logs.requestId` (was always null before).
- Frontend `use-job-sse.ts` no longer silently gives up after 20 reconnects. Surfaces `connectionGaveUp` + `reconnectAttempts` + `reconnectNow()`. Retries once every 2 minutes so long backend outages self-heal.
- Frontend `components/results/map-toolbar.tsx` drag listeners tracked in a `dragListenersRef`. `useEffect` cleanup removes them on unmount, covering both mouse and touch variants.
- Frontend `components/ecology/conservation-summary.tsx` uses a `latestRequestRef` pattern — rapid run selection no longer races older responses over newer ones.
- `plumber_helpers.R` adds `sdm_read_meta_json` and `sdm_read_progress_lines` (tryCatch + configurable default). Replaced 30+ raw `jsonlite::fromJSON` / `readLines` sites in `diagnostics_helpers.R`, `climate_helpers.R`, `ecology_helpers.R`, `jobs_helpers.R`, `models_helpers.R` with the safe helpers. Failures now return `503 "meta.json is unreadable; retry shortly"` instead of `500`.

### Dead code removed (Group I drift cleanup)

- `handleClimateJob` removed from `plumber/R/services/queue-climate-worker.R` (no caller enqueued `type: "climate_download"`; climate downloads go through `plumberClient.downloadClimate` directly).
- `case "climate_download"` removed from `services/queue.ts` dispatcher.
- `"climate_download"` removed from `SdmJobData.type` union.
- `mediumCache` removed from `api/src/middleware/cache.ts` and `api/src/index.ts` (only `longCache` was wired).

## [2.0.0-beta.5] - 2026-07-14

## [2.0.0-beta.5] - 2026-07-14

### Fixed

- **Release workflow bootstrap**: Install R before running the accelerator-contract gate, which invokes `Rscript` to parse the CPU/ROCm runtime smoke scripts.
- **Release gate regression coverage**: The static release audit now rejects workflows that schedule the accelerator-contract gate before R setup.
- **Pre-tag release validation**: The exact publication-validation job now runs on `dev -> main` pull requests, while image publishing and draft assembly remain tag-only.

`v2.0.0-beta.4` failed during tagged validation before container images or GitHub Release artifacts were published. Beta.5 preserves that tag and republishes the same reviewed application candidate with the corrected workflow ordering.

## [2.0.0-beta.4] - 2026-07-13

### Added

- **Release engineering**: Tag-validated publication for separate CPU, CUDA, and ROCm Plumber images plus API/frontend images, with SemVer and commit tags, OCI metadata, SBOM/provenance, and a digest manifest.
- **Release gates**: Static version/image drift audit and a release-candidate checklist covering clean install, migration, rollback, real workflows, accelerator hardware, release notes, and branch-ancestry reconciliation.

- **Provenance manifest**: SHA-256 input hashes (replaced MD5), git commit SHA, R package versions captured in run manifest (`provenance jsonb`). Persisted to DB on run completion. Available via API and results page.
- **Error taxonomy**: 15 typed error codes (`INSUFFICIENT_RECORDS`, `OOM_PREDICTION`, `PERFECT_SEPARATION`, etc.) with structured remediation hints. Errors classified automatically and propagated through Plumber → API → frontend.
- **Per-run resource accounting**: CPU time (ms) and peak memory (MB) tracked via BullMQ worker instrumentation. Displayed in admin Recent Runs table.
- **Run activity view**: Admin dashboard now shows recent 15 runs with status icons, species, model, timestamps, and resource metrics.
- **Password reset flow**: Forgot password / reset password pages with nodemailer. Mailpit replaces smtp4dev for development email inspection (588 MB → 130 MB).
- **Admin dashboard enhancements**: Clipboard copy on all data tables, date range filter on audit logs, JSON export, search on diagnostics runs.
- **Determinism**: XGBoost locked to `nthread=1` with seed; ranger locked to `num.threads=1` (seed already passed).

### Changed

- **Bundle size**: Shared JS bundle reduced from ~2 MB to **103 kB** (95% reduction) via dynamic imports, tree-shaking, and lazy loading.
- **Plumber image**: Base image switched from `rocker/geospatial:4.4.2` (6.9 GB) to `rocker/r-ver:4.4.2` with explicit package installs. Verified CPU release image size: **3.32 GB** (was 7.9 GB).
- **Frontend Dockerfile**: Multi-stage build with `output: "standalone"` mode. Estimated final size: **~200 MB** (was 3.7 GB).
- **API compression**: All responses gzip-compressed via `hono/compress` middleware (60-80% smaller transfers).
- **Results page**: 3-second polling replaced with SSE-driven real-time updates. 5s polling fallback only when SSE disconnected.
- **/batch endpoint**: Synchronous sequential Plumber calls replaced with async BullMQ enqueuing. HTTP thread no longer blocked.
- **N+1 queries**: Admin upload stats reduced from 75 queries per page to 3 via batched `inArray` lookups.
- **API key `lastUsedAt`**: DB writes batched in memory, flushed every 30s or after 100 writes (was 1 write per request).
- **Cancel cleanup**: Partial output files now deleted when a run is cancelled (`unlink(job_dir, recursive=TRUE)`).

### Fixed

- **Fresh deployment runtime**: PostgreSQL URL parsing, empty-volume ownership, shared artifact permissions, and climate-cache directory initialization now work without manual repair.
- **Climate persistence and progress**: WorldClim and CHELSA downloads use persistent volumes, retain resumable partial files, and report per-file byte progress instead of appearing stuck at 20%.
- **Result correctness**: DNN diagnostics no longer invent overfitting arithmetic when metrics are absent; reports, provenance counts, projection means, threshold area, and ODMAP resolution use the actual run data.
- **Artifact discovery**: Completed Plumber artifacts, reports, diagnostics, and output metadata are persisted and synchronized into API-visible run records.
- **Mobile/navigation correctness**: Mobile navigation has an explicit close control, the results separator renders correctly, and unavailable batch navigation is no longer presented as functional.
- **Release reproducibility**: Application and external production images use immutable digests; Docker build bases and GitHub Actions are pinned; CPU/CUDA/ROCm runtime contracts are audited.
- **SSE double connection**: Model page no longer opens a redundant EventSource (only `JobProgress` child connects).
- **AuthGuard double-render**: Eliminated unnecessary `mounted` state cycle in auth guard.
- **Species reactivity**: Model config form no longer takes a snapshot of the store at render time; debounces store writes to blur instead of per-keystroke.
- **Duplicate runs prefetch**: `DashboardClientWrapper` prefetch removed — `useCompletedRuns` now has its own `?fields=summary` query with `refetchOnWindowFocus: false`.
- **Pre-existing bug**: `DELETE /runs/delete/:runId` endpoint used `jobId` instead of `runId` in the WHERE clause.
- **Pool config**: Removed invalid `idle_in_transaction_session_timeout` option from pg Pool config.
- **bfcache**: SSE EventSource closed on `pagehide` event to enable back/forward cache.

### Removed

- `@vis.gl/react-maplibre` dependency (unused, ~200 KB).
- `smtp4dev` from dev compose — replaced by `mailpit`.
- Duplicate Docker images from old builds (~12 GB reclaimed).
- Render-blocking `maplibre-gl/dist/maplibre-gl.css` import from root layout (already imported by map components).
- Unused CartoCDN preconnect hints (maps are lazy-loaded, connections never used on initial page load).

## [0.1.0-beta] - 2025-05

### Added

- Initial modern platform beta release.
- Next.js 15 frontend + Hono API + Plumber R backend.
- Multi-algorithm SDM (GLM, GAM, Maxnet, RF, XGBoost, Ranger, Ensemble, ESM, DNN, BIOMOD2).
- Occurrence cleaning with CoordinateCleaner integration.
- Future climate projection (CMIP6) with multi-GCM averaging.
- Ecology toolkit: EOO/AOO, AOA, climate matching.
- ODMAP-compatible reporting.
- Job queue with BullMQ + SSE progress.
- Docker Compose development and production stacks.
- PostgreSQL 16 + PostGIS, Redis 7, Garage S3 storage.
- Admin dashboard with user management, audit logs, diagnostics.
- API key + JWT authentication.
