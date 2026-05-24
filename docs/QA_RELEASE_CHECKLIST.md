# QA Release Checklist

Use this checklist for the `dev -> main` release PR.

## Repository State

- `dev` contains the intended release work and is not behind `main`.
- Stale feature PRs already contained in `dev` are closed.
- The historical Shiny-first line is preserved on remote branch `legacy-shiny`.
- `git diff --stat` has no accidental binaries, generated outputs, caches, local data, or release zips.
- README, `docs/SPEC.md`, production docs, and release notes reflect the modern platform as primary and Shiny as legacy desktop.
- GitHub repository description/topics reflect the modern platform, not the old Shiny-only app.
- CRAN is described only as a future extracted R package track, not as a property of the current platform.

## Automated Gates

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

Expected local exception: a lean machine without R spatial packages may fail the R smoke/testthat gate on missing packages such as `sf`. GitHub Actions installs the hard R dependency set and is the final R authority for the PR.

Platform CI builds and health-checks the modern stack images: frontend, API, and Plumber. The legacy Shiny image is a release artifact, not a blocking modern-platform integration gate, because its full CRAN/R spatial image build is slow and already covered by R source/tests plus the release workflow.

## Manual QA

- Start the modern stack with `docker compose -f docker-compose.yml up`.
- Confirm API startup applies Drizzle migrations before the server starts.
- Register or log in through the browser UI.
- Create a project and verify the dashboard loads without console errors.
- Upload the synthetic occurrence example and verify cleaning/preview state.
- Start a small model run and verify progress, completion state, and result page navigation.
- Verify downloads do not leak local absolute paths.
- Confirm production compose refuses to start without required secrets.
- Capture desktop, tablet, and mobile screenshots for the primary routes and check for horizontal overflow, clipped labels, placeholder copy, and broken empty states.

## Release Decision

Merge to `main` only after CI is green or every failing check has a documented, accepted reason. Tag from `main`, let the release workflow create a draft release, then review artifacts before publishing.
