# SDM Dashboard Workbench - Current Specification

## Project Shape

SDM Dashboard Workbench is now a beta species distribution modelling platform with two supported surfaces:

- **Modern platform:** Next.js frontend, Hono API, Plumber R computation service, PostgreSQL/PostGIS, Redis/BullMQ, Garage S3-compatible storage, and Docker Compose.
- **Legacy desktop app:** root-level R/Shiny app for local single-user workflows.

The modern platform is the primary direction for development and deployment. The Shiny app remains useful as a desktop fallback and as a source of mature modelling code, but it should not drive repo architecture decisions.

## Architecture

```text
Browser (Next.js 15)
  -> Hono API/BFF (auth, projects, queues, cache, storage)
     -> Plumber R API (SDM computation endpoints)
        -> R modules under R/
     -> PostgreSQL/PostGIS (users, projects, species, runs, occurrences)
     -> Redis/BullMQ (queues, rate limits, cache)
     -> Garage S3-compatible storage (rasters and exports)
```

The Hono API authenticates users with JWTs or API keys. Requests from Hono to Plumber use `PLUMBER_INTERNAL_KEY`; direct Plumber mutation endpoints require API key authentication.

## Entry Points

| Path | Purpose |
|------|---------|
| `frontend/` | Next.js 15 application and dashboard UI |
| `api/` | Hono API, auth middleware, Drizzle schema, queues, storage, Plumber proxy |
| `packages/shared/` | Shared TypeScript schemas and constants |
| `plumber/` | R/Plumber API wrapper around modelling modules |
| `R/` | SDM modelling, covariate, ecology, output, and legacy Shiny modules |
| `app.R` | Legacy Shiny desktop entry point |
| `pipeline.R` | Legacy non-interactive R pipeline |
| `docker-compose.yml` | Full local stack |
| `docker-compose.dev.yml` | Backing services for local development |
| `docker-compose.prod.yml` | Self-hosted production stack |

## Functional Scope

The platform supports occurrence upload/cleaning, project and species management, climate and environmental covariate handling, model runs, job progress, result diagnostics, ecology summaries, downloads, and comparison workflows.

Stable or actively wired model backends include GLM, GAM, MaxNet, random forest, XGBoost/BRT, ESM variants, and multi-model ensembles when their R packages are available. Conditional or experimental backends include DNN, HMSC/JSDM, rangebagging, and biomod2 integration.

Ecology and interpretation tooling includes EOO/AOO, climate matching, AOA, niche overlap, species richness stacking, dispersal simulation, CLIMEX import, range-size change, calibration plots, response curves, permutation importance, MESS/MOD extrapolation checks, and ODMAP-style reporting.

## Data And Privacy

The public repository should contain only source code, docs, templates, and small synthetic examples. Do not commit real occurrence data, downloaded rasters, `.env`, `.Renviron`, API keys, model outputs, logs, screenshots, release zip artifacts, or deployment-specific secrets.

Generated working folders such as `outputs/`, `checkpoints/`, `logs/`, `Worldclim/`, `Worldclim_future/`, `covariates/`, and Docker volumes are local state.

## Verification Gates

Use these gates before merging `dev` to `main`:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

`Rscript scripts/smoke_test.R --tags=fast` expects hard R dependencies such as `sf` in environments that run EOO/AOO checks. GitHub Actions installs those system and R dependencies; a lean local container may need dependency installation before the R gate can complete.

## Branch And Release Policy

`dev` is the integration branch. `main` is stable and should move by PR from `dev` after CI passes. Stale feature branches that are already contained in `dev` should be closed rather than merged directly.

Release candidates should be tagged from `main` using semver prerelease tags such as `v0.4.0-beta.1`. The release workflow creates draft GitHub Releases, source/Windows-ready zips, and GHCR container images for the platform services.

See `docs/RELEASE_AND_HOSTING.md` for packaging, release, and self-hosting policy.

## Current Limitations

- The modern platform is beta; APIs and UX may change before `v1.0.0`.
- Some R backends are conditional on optional packages and should skip gracefully when unavailable.
- Production hosting requires operator-managed secrets, backups, TLS, and access controls.
- The legacy Shiny app has no built-in auth and should remain local/private.
