# QA Release Checklist

Use this checklist for the `dev -> main` release PR.

## Repository State

- `dev` contains the intended release work and is not behind `main`.
- Stale feature PRs already contained in `dev` are closed.
- `git diff --stat` has no accidental binaries, generated outputs, caches, local data, or release zips.
- README, `docs/SPEC.md`, production docs, and release notes reflect the modern platform as primary and Shiny as legacy desktop.

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

## Manual QA

- Start the modern stack with `docker compose -f docker-compose.yml up`.
- Run API migrations.
- Register or log in through the browser UI.
- Create a project and verify the dashboard loads without console errors.
- Upload the synthetic occurrence example and verify cleaning/preview state.
- Start a small model run and verify progress, completion state, and result page navigation.
- Verify downloads do not leak local absolute paths.
- Confirm production compose refuses to start without required secrets.

## Release Decision

Merge to `main` only after CI is green or every failing check has a documented, accepted reason. Tag from `main`, let the release workflow create a draft release, then review artifacts before publishing.
