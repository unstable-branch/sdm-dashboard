# AGENTS.md — SDM Dashboard Workbench

## Git workflow

This repo uses a two-step integration flow:

```
feature branch -> dev -> main
```

- `main` is the stable branch. Do not push directly to `main`. It should move only by PR from `dev` after CI passes.
- `dev` is the integration branch. It should stay mostly working, but it is allowed to move faster than `main`.
- Bigger work happens on feature branches, then PRs into `dev`.
- Small docs/CI fixes may go straight to `dev` only when the change is low risk and the owner explicitly asked for it.
- Never rewrite shared branch history after pushing. No force-push to `main` or `dev`.
- Commit locally at logical checkpoints: a bug fixed, a feature working, a refactor complete, or a test added.
- Avoid committing broken states to `dev` or `main`. WIP belongs on a feature branch.
- Do NOT commit to local git until a substantial change is complete (multiple related fixes working together).
- After each substantial batch of work, ask the user if they want to commit to remote before pushing.

Branch names should use a short area or repo-local alias, then the topic. No real names needed.

- `ui/obs-records-table`
- `ci/release-audit`
- `data/gbif-import`
- `docs/workflow-guide`

Use conventional commit prefixes:

- `feat:` user-facing feature
- `fix:` bug fix
- `test:` tests or fixtures
- `docs:` documentation only
- `refactor:` internal restructure without behavior change
- `chore:` maintenance/tooling

PR targets:

- Feature/fix PRs target `dev`.
- Release/stabilization PRs target `main` from `dev`.
- If two people need the same files, split the work first or agree who owns that file slice.
- Keep PRs reviewable. Prefer several focused PRs over one giant mixed UI/model/docs/test change.

Before opening a PR:

1. Rebase or merge the latest target branch.
2. Run at least the smoke test or explain why it could not run.
3. Run `pnpm run check:node`, `pnpm run check:compose`, and the R release gates when the change touches the modern platform or release path.
4. Check `git diff --stat` for accidental large/binary/generated files.
5. Summarize user-visible behavior, test coverage, and known limitations.

## Run commands

### R/Shiny backend (legacy)
```bash
# Fast syntax check
Rscript -e 'files <- list.files(path = c("R", "scripts", "tests"), pattern = "[.][Rr]$", recursive = TRUE, full.names = TRUE); for (f in files) parse(f); parse("app.R"); parse("pipeline.R"); parse("launch_app.R")'

# Smoke test (always run before PR)
Rscript scripts/smoke_test.R

# Full testthat suite
Rscript tests/testthat.R

# Release/public bundle audit
Rscript scripts/audit_release.R

# Install dependencies
Rscript install_packages.R

# Parse all R sources (subdirectories included)
Rscript -e 'files <- list.files("R", pattern = "[.][Rr]$", recursive = TRUE, full.names = TRUE); for (f in files) try(parse(f))'

# Release audit (before shipping)
Rscript scripts/audit_release.R
```

### Modern stack (Next.js + Hono API + Plumber)
```bash
# Frontend dev
cd frontend && pnpm dev

# API dev
cd api && pnpm dev

# Run full stack via Docker Compose
docker compose -f docker-compose.yml up

# Full Node platform gate
pnpm run check:node

# Compose validation, including production required-secret validation with dummy values
pnpm run check:compose
```

If local R is unavailable, rely on GitHub Actions and say that local R was unavailable in the PR/check notes.

## Architecture

### Modern Stack (Next.js + Hono + Plumber)

```
Browser (Next.js 16)
  ↓ HTTPS
API Gateway (Hono BFF, port 4000)
  ├── JWT / API Key auth middleware
  ├── Rate limiting (BullMQ/Redis)
  ├── CSRF protection
  └── Route handlers
       ↓ X-Hono-Internal + X-Forwarded-User (for Plumber)
  Plumber R API (port 8000)
  ├── Auth gate (API key validation against PostgreSQL)
  ├── SDM computation (model run, climate, occurrence cleaning)
  └── Response proxies
       ↓
  PostgreSQL 16 + PostGIS (users, projects, runs, species, occurrences)
  Redis 7 + BullMQ (job queue, rate limiting)
  Garage S3-compatible (raster storage, output artifacts)
```

### Legacy R/Shiny Stack

The `app.R` file in the project root is a **Shiny-based SDM workbench**. It is maintained for local/desktop use but is **not the primary deployed architecture**. The Shiny stack runs with:

- `app.R` → `R/core/bootstrap.R` → `R/core/optimized_sdm.R` → `R/load.R` (80 modules)
- Port 3838 in production
- No built-in auth or API

---

## Boot-up process

### Modern stack (Docker Compose)

Docker Compose uses **profiles** to control which services start. Only enable what you need:

```bash
# Core only (postgres + redis) — for local API/frontend dev
docker compose -f docker-compose.dev.yml --profile core up -d

# Core + email (mailpit) — adds email inspection
docker compose -f docker-compose.dev.yml --profile core --profile email up -d

# Everything (core + email + storage + computation)
docker compose -f docker-compose.dev.yml --profile all up -d

# Production full stack (all services, no dev mounts)
docker compose -f docker-compose.yml --profile full up -d
```

The `scripts/dev-start.sh` script wraps this with sensible defaults:

```bash
./scripts/dev-start.sh           # core + email + local API + frontend
./scripts/dev-start.sh minimal   # postgres + redis only
./scripts/dev-start.sh full      # all Docker services
```

Services start in dependency order:
1. **postgres** — PostgreSQL + PostGIS, port 5432
2. **redis** — Redis 7, port 6379
3. **garage** — S3-compatible storage, port 3900
4. **plumber** — R/Plumber API, port 8000 (requires `PLUMBER_INTERNAL_KEY`)
5. **api** — Hono BFF, port 4000 (proxies to plumber, manages auth)
6. **frontend** — Next.js 16, port 3000

### API-only (local development)

```bash
# Terminal 1: Plumber R API
cd /path/to/sdm-dashboard
Rscript -e "pr <- plumber::pr('plumber/R/plumber.R'); plumber::pr_run(pr, host='0.0.0.0', port=8000)"

# Terminal 2: Hono API
cd api && pnpm dev

# Terminal 3: Frontend
cd frontend && pnpm dev
```

### Legacy Shiny (local desktop)

```bash
Rscript launch_app.R
# Opens Shiny UI at http://localhost:3838
```

---

## CI

### Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `.github/workflows/r-quality.yml` | All PRs + push to `dev`/`main` | R/Shiny smoke test, testthat, parse check, release audit |
| `.github/workflows/platform-ci.yml` | Push to `dev`/`main` + PRs targeting `dev`/`main` | Frontend, API, R, and Docker validation (parallel jobs) |
| `.github/workflows/release.yml` | Git tags `v*` + manual dispatch | Release audit, Docker image build+push, GitHub release creation |

### Platform CI jobs

- **`shared`** — Builds `@sdm/shared` TypeScript package once, uploads artifact
- **`frontend`** — Downloads shared artifact, then typechecks, lints, tests (with coverage), builds
- **`api`** — Downloads shared artifact, then typechecks, lints, tests (with coverage), builds
- **`r-quality`** — Parses R sources, runs smoke test, testthat suite, audit_release
- **`docker`** — Validates all 3 compose files, builds all 4 Dockerfiles, health-checks live services, runs Playwright e2e, Trivy scan

### Release workflow

Push a semver tag (`git tag v1.2.3 && git push --tags`) to trigger:
1. **audit** — Runs `audit_release.R` to validate release artifact integrity
2. **build-images** — Builds and pushes 4 images to GHCR (`sdm-plumber`, `sdm-api`, `sdm-frontend`, `sdm-shiny`)
3. **release** — Creates a draft GitHub release with `sdm-dashboard-*-source.zip` and `*-windows-ready.zip`

### Artifacts published

- `frontend-coverage/` — LCOV + text coverage report (14-day retention)
- `api-coverage/` — LCOV + text coverage report (14-day retention)
- `frontend-dist/` — Next.js build output (5-day retention)
- `api-dist/` — Compiled TypeScript output (5-day retention)
- `shared-dist/` — `@sdm/shared` compiled output (5-day retention)

---

## R/Shiny gotchas (legacy — for `app.R` maintenance only)

- **`observe()` does NOT accept `ignoreInit`** — only `observeEvent()` does.
- **`bslib::modal()` does not exist** — use `modalDialog()`.
- **`passwordInput()` does not accept `autocomplete`** — wrap with `tagAppendAttributes(..., autocomplete = "new-password")`.
- **`nzchar(NULL)` returns `logical(0)`** — use `nzchar(x %||% "")` or check `is.null(x)` first.
- **`callr::r_bg` runs in separate process** — `<<-` on Shiny reactives has no effect. Background downloads must source `bootstrap.R` before `optimized_sdm.R` in the child.
- **`rv$cleaned_occurrence` is a list** — `{df, source_counts, n_absent_excluded, original_rows}`. NOT a dataframe.
- **`rv$undo_stack` is a list** — capped at 10 states, used by Observation Records tab.
- **Numeric inputs can receive `Inf`/`NA`** — use `safe_numeric()` in `R/ui/ui_sidebar_controls.R`.
- **`sdm_default_cv_block_size_km` is `NA_real_`** — UI defaults to 50 when NA.

## Key conventions

### Climate data sources

| Source | Naming convention | Path |
|--------|-------------------|------|
| WorldClim current | `wc2.1_10m_bio_1.tif` ... `wc2.1_10m_bio_19.tif` | `Worldclim/` |
| WorldClim future (CMIP6) | `wc2.1_10m_bioc_1.tif` ... inside `GCM_SSP_Period/` subdirs | `Worldclim_future/` |
| CHELSA v2.1 | `CHELSA_bio01_1981-2010_V.2.1.tif` ... `CHELSA_bio19_1981-2010_V.2.1.tif` | `chelsa/` |
| CHELSA extras | `CHELSA_gdd5_1981-2010_V.2.1.tif`, `CHELSA_gsl_1981-2010_V.2.1.tif`, `CHELSA_npp_1981-2010_V.2.1.tif`, etc. | `chelsa/` |

**Note:** WorldClim v2.1 uses `wc2.1_<res>m_bio_<n>.tif` for current and `wc2.1_<res>m_bioc_<n>.tif` for CMIP6 future. CHELSA v2.1 uses `CHELSA_bio<nn>_<period>_V.2.1.tif` format with period `1981-2010` (not `1979-2013`).

- WorldClim cached in `Worldclim/`; CHELSA in `chelsa/`; future layers in `Worldclim_future/`. Do not commit downloaded rasters.
- Occurrence CSV must have `longitude`/`latitude` columns (or aliases: `lon`, `decimalLongitude`).
- Outputs go to `outputs/` by default. This directory is gitignored.
- Real occurrence datasets, downloaded rasters, generated outputs, logs, API keys, and screenshots must not be committed.
- `AGENTS.md` is allowed to be tracked, but release/source bundles must exclude it.

## Development priorities

- Keep the app usable for local desktop work first. Web/deployment polish is secondary unless explicitly scoped.
- Scientific outputs need honest labels: experimental, optional, skipped, failed, or validated. Do not imply a model/backend is production-ready because a UI control exists.
- Optional packages must fail gracefully with clear install hints and skipped tests.
- Prefer simple, inspectable R modules over broad rewrites. If a feature touches UI, model code, tests, and release scripts, split it unless the coupling is real.
- Preserve reproducibility: seeds, selected covariates, model id, thresholds, extents, and output paths should be recorded in reports/manifests where relevant.

## Review posture

For code review, prioritize:

- runtime crashes and Shiny reactive mistakes;
- incorrect SDM/statistical claims;
- broken CI/test assumptions;
- generated or private files accidentally tracked;
- mismatches between UI labels and actual backend behavior;
- large mixed commits that should be split before merge.

Do not accept a PR just because it is visually impressive. Check that it starts, the relevant workflow works, and CI passes.

### Offline / air-gapped deployment

Climate data directories and download behavior are configurable via environment variables:

| Env var | Default | Purpose |
|---------|---------|---------|
| `SDM_WORLDCLIM_DIR` | `Worldclim` | Directory for current WorldClim BIO layers |
| `SDM_CHELSA_DIR` | `chelsa` | Directory for CHELSA v2.1 BIO layers |
| `SDM_CHELSA_EXTRAS_DIR` | `chelsa` | Directory for CHELSA bioclim-plus extra variables |
| `SDM_FUTURE_WORLDCLIM_DIR` | `Worldclim_future` | Directory for CMIP6 future projections |
| `SDM_INTERNET_CHECK_ENABLED` | `true` | Set to `false` to disable connectivity probe before downloads |

**CHELSA URL** (configurable via `SDM_CHELSA_URL`): The default URL is `https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/bioclim`. The old envicloud.wsl.ch URL is deprecated and returns 404.

**Offline workflow:**
1. Place correctly-named `.tif` files in the climate directories (see naming conventions above)
2. In the Shiny UI, uncheck "Auto-download missing BIO layers"
3. The readiness panel confirms which BIO variables are found locally
4. No web upload for climate rasters — files must be placed directly on the filesystem

### Plumber vs targets pipeline

The project has **two execution engines** for SDM computation, each with a distinct role:

**Plumber** (`plumber/R/`) is the HTTP API gateway. Use it for:
- Single-species model runs (`POST /api/v1/models/run` → `run_model_background.R`)
- Interactive/blocking requests (health, config, check endpoints)
- Short-lived async jobs (occurrence cleaning, GBIF search, DwC-A parsing, climate/covariate download)
- Read-only post-run data retrieval (diagnostics, ecology, tiles, outputs, manifest)

**Targets** (`_targets.R`) is the pipeline orchestrator. Use it for:
- Multi-species batch runs (2+ species)
- Any workflow needing caching, incremental rebuild, or auto-resume after crash
- HPC/cluster computing via `crew` (SLURM, SGE, PBS, AWS Batch)
- Research-grade reproducible analyses with provenance tracking

Both engines call the same `sdm_stage_*()` functions in `R/core/run_sdm.R` — the shared computation foundation. `run_fast_sdm()` wraps them monolithically for single runs; `_targets.R` orchestrates them as a DAG for batch runs.

The legacy `batch_run_parallel()` (`R/output/batch_runner.R`) is Shiny-desktop-only for quick ad-hoc use — do not add new modern-platform code paths through it.

### biomod2 gating

Requires `options(sdm.enable_biomod2 = TRUE)` AND `requireNamespace("biomod2", quietly = TRUE)`. Never add to base packages.

### Spatial-block CV fallback

Fewer than 5 occurrence points → `cv_folds.R` warns and falls back to random k-fold.

### Synthetic example data

`data/examples/synthetic_presence_data.csv` — safe to commit; real occurrence data must never be committed.

### Lock file

`renv.lock` pins R package versions. Use `renv::restore()` on a new machine.

### Data output

`outputs/` directory is gitignored. All model run outputs go here by default.

### WSL access

WSL has no GUI browser. Access the Shiny app from a **Windows browser** at `http://<WSL-IP>:3838`. Get the IP:
```bash
hostname -I | awk '{print $1}'
```

---

## Security

### API authentication

The Hono API (port 4000) authenticates via:
- **JWT Bearer token** — `Authorization: Bearer <token>` header; validated against PostgreSQL `users` table
- **API Key** — `X-API-Key` header; SHA256 hash looked up in `api_keys` table

### Plumber auth gate

All computation endpoints on Plumber (port 8000) require authentication:
- **X-Hono-Internal** + **X-Forwarded-User** headers — used when Hono proxies a request that was already authenticated via JWT. Hono sets these when forwarding to Plumber.
- **X-API-Key** header — direct API key access to Plumber (bypasses Hono entirely)

**Open Plumber endpoints** (no auth required):
- `GET /health` — server health check
- `GET /ready` — readiness probe
- `GET /api/v1/models/runs` — list all model runs (read-only)
- `GET /api/v1/climate/scenarios` — list downloaded scenarios
- `GET /api/v1/config/defaults` — model config defaults
- `GET /api/v1/models` — available model list
- `GET /api/v1/future/scenarios` — future scenario discovery
- `GET /api/v1/ecology/:runId/*` — ecology data (read-only)
- `GET /api/v1/diagnostics/*` — diagnostics (read-only)

**Protected Plumber endpoints** (auth required):
- `POST /api/v1/models/run` — run SDM model
- `POST /api/v1/models/cancel/:jobId` — cancel a run
- `POST /api/v1/climate/download` — download climate data
- `POST /api/v1/occurrences/upload` — upload occurrence file
- `POST /api/v1/occurrences/clean` — clean occurrence data
- `POST /api/v1/occurrences/gbif/search` — GBIF search
- `POST /api/v1/occurrences/dwca` — parse Darwin Core Archive

Set `PLUMBER_AUTH_DISABLED=true` in development to bypass the Plumber auth gate.

### API key forwarding

When Hono proxies a request to Plumber on behalf of an authenticated user, it forwards:
- `X-Hono-Internal: <PLUMBER_INTERNAL_KEY>` — validates Hono is the caller
- `X-Forwarded-User: <user_id>` — the authenticated user's ID from Hono's JWT validation

The `PLUMBER_INTERNAL_KEY` must match between Hono's `PLUMBER_INTERNAL_KEY` env var and Plumber's env var.

---

## Package install quirks

### R packages

- `R/core/packages.R` defines 4 vectors: `sdm_required_packages` (minimal bootstrap), `sdm_setup_packages` (core UI deps), `sdm_app_packages` (all modelling backends), `sdm_optional_packages` (per-feature).
- Any package loaded via `library()` or `::` in `app.R` or `R/ui_*.R` **must** be in `sdm_setup_packages` to avoid first-launch failures.
- `install_packages.R` uses `sdm_setup_packages`; `scripts/windows_setup.R` uses `sdm_app_packages`.

### Node.js packages

All TypeScript packages use `pnpm` (workspaces defined in `pnpm-workspace.yaml`). Use `pnpm install --frozen-lockfile` in CI.

---

## CSS / UI conventions

- **Dark mode system:** `body.sdm-dark` + CSS variables in `www/sdm-theme.css`.
- **CSS fallback:** `app.R` (Shiny) injects CSS inline via `tags$style()` as backup for the external stylesheet.
- **Leaflet maps:** CartoDB Positron (light) + DarkMatter (dark) tile groups with `baseGroups` in layersControl.
- **Status dot classes:** `.status-dot-ok`, `.status-dot-warn`, `.status-dot-error`, `.status-dot-unknown`.
- **Get Data tab:** `.gd-section-summary`, `.gd-section-summary-compact`, `.gd-section-icon`, `.gd-section-body`.
- **Observation Records tab:** `.obs-metric-card`, `.obs-metric-value`, `.obs-metric-label`, `.flagged-actions`, `.btn-toolbar`, `.source-table-container`, `.obs-log-output`, `.obs-record-table`.
- **Flagged actions:** `btn-group btn-group-sm` toolbar with Remove flagged, Clear flags, Undo buttons.

---

## Important file locations

### Modern stack

| Path | Purpose |
|------|---------|
| `api/src/index.ts` | Hono server entry point (port 4000) |
| `api/src/routes/*.ts` | API route handlers (auth, admin, sdm, climate, ecology, occurrences, projects, results, settings, diagnostics, jobs) |
| `api/src/services/plumber.ts` | Plumber proxy client (forwards `X-Hono-Internal`, `X-Forwarded-User`) |
| `api/src/services/queue.ts` | BullMQ job queue worker |
| `api/src/services/websocket.ts` | WebSocket server (real-time job progress) |
| `api/src/services/job-events.ts` | Job event bus (broadcasts SSE events to WebSocket) |
| `api/src/middleware/auth.ts` | JWT + API key auth middleware |
| `api/src/db/schema.ts` | Drizzle ORM schema (users, projects, api_keys, species, runs, occurrences) |
| `frontend/src/app/` | Next.js 16 app router pages |
| `frontend/src/components/` | React components by domain |
| `frontend/src/services/api.ts` | Centralized fetch client (`apiGet`, `apiPost`, `apiDelete`, `apiPut`) |
| `frontend/src/services/types.ts` | Shared API type definitions |
| `frontend/src/hooks/useJobProgress.ts` | WebSocket hook for real-time job progress |
| `frontend/src/stores/` | Zustand stores (auth-store, sdm-store) |
| `plumber/R/plumber.R` | Plumber R API endpoints |
| `plumber/R/auth.R` | Plumber API key validation |
| `plumber/R/run_server.R` | Plumber server entry point with auth filter |
| `plumber/R/run_model_background.R` | Background model run script (spawned by callr) |
| `plumber/R/climate_download.R` | Background climate download script |
| `plumber/R/middleware.R` | Plumber middleware helpers |

### Legacy R/Shiny

| Path | Purpose |
|------|---------|
| `app.R` | Shiny UI entry point |
| `R/load.R` | Module loader (80 modules) |
| `R/core/bootstrap.R` | Project root detection |
| `R/core/config.R` | All `sdm_default_*` constants |
| `R/core/run_sdm.R` | `run_fast_sdm()` orchestration |
| `R/data/occurrences.R` | Occurrence cleaning (CoordinateCleaner integration) |
| `R/covariates/covariates_climate.R` | WorldClim/CHELSA download + load |
| `R/models/model_glm.R` | Primary GLM model backend |
| `R/ecology/eoo_aoo.R` | EOO/AOO calculations |
| `R/output/plots.R` | `render_suitability_leaflet()` map rendering |

---

## PR Checklist Template

Use this in every PR description:

```markdown
## Summary
What does this PR add/fix?

## Scientific / user reason
Why does this matter for SDM users?

## Scope
Files changed:
- ...

Out of scope:
- ...

## User-visible behavior
What changes in the app or outputs?

## Tests
- [ ] R sources parse (if R changed)
- [ ] scripts/smoke_test.R passes (if R changed)
- [ ] tests/testthat.R passes (if R changed)
- [ ] Added/updated tests for this feature

## Dependencies
- [ ] No new dependency
- [ ] New optional dependency, with clean skip/install hint
- [ ] New hard dependency, documented in DESCRIPTION and installer

## Reproducibility/reporting
- [ ] Seed/parameters recorded where relevant
- [ ] Output/report metadata updated where relevant

## Screenshots / outputs
Attach if UI or report changed.

## Known limitations
What should reviewers know?
```
