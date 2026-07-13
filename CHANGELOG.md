# Changelog

All notable changes to the SDM Dashboard Workbench are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Plumber image**: Base image switched from `rocker/geospatial:4.4.2` (6.9 GB) to `rocker/r-ver:4.4.2` with explicit package installs. Estimated final size: **~1.5 GB** (was 7.9 GB).
- **Frontend Dockerfile**: Multi-stage build with `output: "standalone"` mode. Estimated final size: **~200 MB** (was 3.7 GB).
- **API compression**: All responses gzip-compressed via `hono/compress` middleware (60-80% smaller transfers).
- **Results page**: 3-second polling replaced with SSE-driven real-time updates. 5s polling fallback only when SSE disconnected.
- **/batch endpoint**: Synchronous sequential Plumber calls replaced with async BullMQ enqueuing. HTTP thread no longer blocked.
- **N+1 queries**: Admin upload stats reduced from 75 queries per page to 3 via batched `inArray` lookups.
- **API key `lastUsedAt`**: DB writes batched in memory, flushed every 30s or after 100 writes (was 1 write per request).
- **Cancel cleanup**: Partial output files now deleted when a run is cancelled (`unlink(job_dir, recursive=TRUE)`).

### Fixed

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
