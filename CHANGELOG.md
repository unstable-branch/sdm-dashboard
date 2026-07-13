# Changelog

All notable changes to the SDM Dashboard Workbench are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0-beta.5] - 2026-07-14

### Fixed

- **Release workflow bootstrap**: Install R before running the accelerator-contract gate, which invokes `Rscript` to parse the CPU/ROCm runtime smoke scripts.
- **Release gate regression coverage**: The static release audit now rejects workflows that schedule the accelerator-contract gate before R setup.

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
