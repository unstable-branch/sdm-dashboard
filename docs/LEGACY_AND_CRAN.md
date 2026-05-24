# Legacy Shiny And CRAN Plan

## Legacy Shiny

The original Shiny-first application is preserved for desktop/local workflows and as a source of mature modelling code.

Current policy:

- The modern platform is the primary product direction.
- The legacy Shiny app remains available through `app.R`, `R/`, `pipeline.R`, and the Windows launcher artifacts during the beta release.
- The historical Shiny-first branch is preserved as `legacy-shiny` on `unstable-branch/sdm-dashboard`.
- New platform architecture decisions should not be constrained by Shiny UI structure.

The Shiny app has no built-in multi-user auth, API layer, queue isolation, or production access-control model. Treat it as a local desktop tool unless a future release explicitly changes that.

## Why CRAN Is Not The Current Platform

The full SDM Dashboard Workbench is not a CRAN-shaped package today. The modern platform includes:

- Next.js frontend
- Hono API
- Docker Compose
- PostgreSQL/PostGIS
- Redis/BullMQ
- Garage-compatible object storage
- Plumber service boundaries
- Browser auth and API-key flows

Those pieces are useful for a self-hosted modelling platform, but they are not appropriate for direct CRAN submission.

## Future CRAN Track

A realistic CRAN path is to extract a smaller R package from the reusable modelling/core code.

Likely package scope:

- Occurrence cleaning helpers
- Covariate preparation helpers that do not require bundled large rasters
- Model fitting wrappers for stable backends with portable dependencies
- Evaluation metrics and threshold helpers
- Ecology summary functions where dependencies are acceptable
- Small synthetic examples and fast tests

Likely exclusions:

- Next.js frontend
- Hono API
- Docker Compose
- Database migrations
- Object storage
- Long-running queues
- Large raster downloads
- External API credentials
- Shiny-only UI code

## CRAN Readiness Bar

Before attempting CRAN submission, the extracted R package should have:

- A clean package directory with `DESCRIPTION`, `NAMESPACE`, `R/`, `man/`, `tests/`, and examples.
- `R CMD build` success.
- `R CMD check --as-cran` success with no errors or warnings and only explainable notes.
- Examples and tests that are fast, deterministic, offline-friendly, and small.
- Clear dependency discipline, especially around heavy spatial packages and optional modelling backends.
- No writes to user home directories, package directories, or undeclared temp paths during examples/tests.
- No hidden dependency on Docker, Node.js, Postgres, Redis, Garage, or web services.

## Recommended Sequence

1. Stabilize and release the modern platform beta from `dev` to `main`.
2. Tag a beta release from `main`.
3. Create a separate package-extraction branch or repo.
4. Move reusable R-core functions behind package-style APIs.
5. Add minimal synthetic fixtures and tests.
6. Run local and CI `R CMD check --as-cran`.
7. Only then decide whether CRAN submission is worth the review overhead.
