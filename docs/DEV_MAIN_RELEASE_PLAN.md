# Dev To Main Release Plan

This plan defines the release-candidate path for promoting `dev` to `main`.

## Release Goal

Ship the modern SDM Dashboard Workbench as a credible beta platform, not just a large branch merge. The release should make the current project shape clear:

- Modern platform is primary: Next.js frontend, Hono API, Plumber R engine, PostgreSQL/PostGIS, Redis/BullMQ, Garage-compatible object storage, and Docker Compose.
- Legacy Shiny desktop remains preserved and usable, but it is no longer the architecture driver for new platform work.
- CRAN is a future extraction track for a smaller pure-R modelling/core package, not the current web platform.

## Current Branch State

- `dev` is the integration branch for the modern platform.
- `main` is the stable public branch.
- `legacy-shiny` preserves the old Shiny-first line from `legacy-5p00kyy-main`.
- Stale feature branches already contained in `dev` should not be merged separately.

## Phase 1 - Preservation And Public Framing

Required before opening the release PR:

- Preserve the historical Shiny-first code as a remote branch named `legacy-shiny`.
- Keep root `app.R`, `R/`, `pipeline.R`, and Windows launch artifacts available in `dev` for the beta release.
- Update README, spec, release docs, citation metadata, and GitHub repository metadata to describe the modern platform accurately.
- Avoid claiming CRAN readiness until a real package split exists and passes `R CMD check --as-cran`.

Acceptance:

- GitHub repo description no longer says the project is only an R/Shiny workbench.
- Docs link readers to the legacy and CRAN plan.
- No release notes imply that the full Docker/web stack is CRAN-submittable.

## Phase 2 - Automated Gates

Run the normal gates locally and in GitHub Actions:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

GitHub Actions must be green for:

- R Quality Checks
- Platform CI

If a local R gate fails because the local machine lacks system spatial libraries, record that explicitly in the PR and use GitHub Actions as the release authority for that gate.

The Plumber image installs CRAN dependencies through `R_CRAN_REPO`, which defaults to Posit Package Manager's Ubuntu Noble Linux binary repository. This keeps cold Docker builds from compiling large packages from source when binaries are available. Override the build arg only when deliberately testing another CRAN mirror.

## Phase 3 - Modern Stack Product QA

Run the modern stack from a clean-ish local state:

```bash
docker compose -f docker-compose.yml --profile full up -d
```

Then verify:

- Frontend loads at `http://localhost:3000` without browser console errors.
- Register/login flow works.
- Dashboard, projects, species, data, model, evaluate, ecology, downloads, and settings routes render without broken layout.
- Empty state copy is useful and does not look like scaffolding.
- Synthetic occurrence upload path is understandable.
- Small model-run path either completes or fails with an actionable user-facing error.
- API health and Plumber health are both reachable through the expected compose network.
- Empty volumes bootstrap Garage single-node dev storage plus API tables cleanly, and do not leave API logs full of missing-relation or object-storage setup errors.

Screenshot QA should cover at least:

- Desktop `1440x1000`
- Laptop `1280x900`
- Tablet `768x1024`
- Mobile `390x844`

Acceptance:

- No horizontal overflow.
- No text collisions or cropped button labels.
- No obviously placeholder product copy on primary routes.
- Dashboard first screen shows a coherent workbench even before data exists.

## Phase 4 - Production/Self-Hosting Gate

Before the release PR is merged:

- `docker-compose.prod.yml` must fail closed when required secrets are absent.
- Production docs must list required secrets and exposed services.
- No dev fallback keys may silently activate in production mode.
- No public docs should instruct users to expose Postgres, Redis, Garage admin, Prometheus, or Grafana without access control.
- Release workflow must build draft releases and GHCR images from tags only.

## Phase 5 - PR And Merge

Open a fresh `dev` to `main` PR only after Phases 1-4 are satisfied.

The PR body should include:

- Current branch SHAs.
- Confirmation that `main` has no unique commits or a short explanation if that changes.
- Links to latest green R Quality Checks and Platform CI.
- Local gate output summary.
- Manual QA summary with screenshot path.
- Explicit statement that `legacy-shiny` preserves the old desktop line.
- Explicit statement that CRAN is deferred to a future extracted R package.

Do not squash in unrelated cleanup after PR review starts. If substantial follow-up is needed, fix it on `dev`, rerun gates, and let the PR update normally.

## Stop Conditions

Do not merge if any of these are true:

- `main` gains unique commits that have not been reconciled.
- CI is red without a documented and accepted reason.
- The app cannot be started from the documented compose path.
- Empty-volume bootstrap fails.
- Primary pages look unfinished, broken, or misleading.
- Public repo metadata still describes the old Shiny-only project.
- The release would imply CRAN readiness for the current platform.
