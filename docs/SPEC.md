# SDM Dashboard - Current Specification

## Project Shape

SDM Dashboard is a species distribution modelling platform: Next.js 16 frontend, Hono API, Plumber R computation service, PostgreSQL/PostGIS, Redis/BullMQ, Garage S3-compatible storage, and Docker Compose.

The original single-user Shiny app was removed in 3.0. `v1.0.0` is its final release.

## Architecture

```text
Browser (Next.js 16)
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
| `frontend/` | Next.js 16 application and dashboard UI |
| `api/` | Hono API, auth middleware, Drizzle schema, queues, storage, Plumber proxy |
| `packages/shared/` | Shared TypeScript schemas and constants |
| `plumber/` | R/Plumber API wrapper around modelling modules |
| `R/` | SDM modelling, covariate, ecology and output modules |
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

Release candidates should be tagged from `main` using semver prerelease tags such as `v2.0.0-beta.3`. The historical `v0.x`/`v1.0.0` tags belong to the Shiny-first line. The release workflow creates draft GitHub Releases, source/Windows-ready zips, and GHCR container images for the modern platform services.

See `docs/RELEASE_AND_HOSTING.md` for packaging, release, and self-hosting policy.

The release flow is described in `CONTRIBUTING.md`.

## CRAN Track

The current repository is not a CRAN package candidate as-is. A CRAN path should be a later extraction of reusable pure-R modelling/core functions with fast tests, portable dependencies, and no dependency on Docker, Node.js, Postgres, Redis, Garage, or the browser platform.

## Current Limitations

- Some R backends are conditional on optional packages and should skip gracefully when unavailable.
- Production hosting requires operator-managed secrets, backups, TLS, and access controls.
