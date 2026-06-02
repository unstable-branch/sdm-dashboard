# QA Release Checklist

Use this checklist before opening and merging the `dev -> main` release PR for the next beta.

## Release Goal

`v2.0.0-beta.3` should be a modern-platform rebaseline beta:

- users can understand the current project shape from README and docs;
- the modern stack boots from the documented Docker Compose path;
- browser auth, projects, upload/cleaning, model configuration, progress, results, storage, and settings behave as designed;
- known beta limitations are explicit;
- Shiny is preserved as legacy desktop, not presented as the primary platform;
- CRAN is described only as a future extraction track.

## Repository State

- `dev` contains the intended release work and is not behind `main`.
- `main` has no unique unreconciled commits.
- Stale feature PRs already contained in `dev` are closed.
- The historical Shiny-first line exists on remote branch `legacy-shiny`.
- README, `docs/DEPLOY.md`, `docs/SPEC.md`, `docs/RELEASE_AND_HOSTING.md`, and this checklist reflect the modern platform.
- GitHub repository description/topics describe the modern platform, not only the old Shiny app.
- `git diff --stat` has no accidental binaries, generated outputs, caches, local data, screenshots, release zips, or lockfile residue.
- `frontend/package-lock.json` is absent; pnpm is canonical through root `pnpm-lock.yaml`.

## Automated Gates

Run locally where possible:

```bash
pnpm install --frozen-lockfile
pnpm run check:node
pnpm run check:compose
Rscript scripts/smoke_test.R --tags=fast
Rscript tests/testthat.R
Rscript scripts/audit_release.R
git diff --check
```

Expected local exception: a lean machine without R spatial packages may fail the R smoke/testthat gate on missing packages such as `sf`, `terra`, or `httr`. Record this explicitly and rely on GitHub Actions for the R authority when needed.

GitHub Actions must be green or have a documented accepted exception:

- R Quality Checks
- Platform CI
- Backend determinism

Platform CI must build and health-check the modern stack images: frontend, API, and Plumber. Legacy Shiny remains available through source and Windows-ready artifacts, but it is not a blocking modern-platform container gate.

## Manual Modern-Stack QA

Start from a clean checkout or clean working tree:

```bash
docker compose -f docker-compose.yml --profile full up
```

Verify:

- frontend loads at `http://localhost:3000`;
- API health returns ok at `http://localhost:4000/health`;
- Plumber health returns ok at `http://localhost:8000/health`;
- API startup applies Drizzle migrations before serving;
- register/login works in the browser;
- dashboard initial empty state is coherent;
- create a project;
- upload `data/examples/synthetic_presence_data.csv`;
- occurrence preview/cleaning state is understandable;
- configure and start a small model run;
- progress updates are visible or failure state is actionable;
- results page loads for the run;
- downloads/manifests do not expose host-local absolute paths;
- settings, storage, model, projects, and results routes render without console errors;
- production compose refuses to start without required secrets.

Capture screenshots for:

- desktop `1440x1000`;
- laptop `1280x900`;
- tablet `768x1024`;
- mobile `390x844`.

Check screenshots for:

- horizontal overflow;
- clipped labels/buttons;
- overlapping UI;
- placeholder copy;
- misleading empty states;
- dark/light contrast issues.

## Documentation QA

- README quick start matches the actual compose profile command.
- `docs/DEPLOY.md` explains profiles, first boot, env vars, production secrets, and troubleshooting.
- Release notes explain the modern-platform shift since the last beta.
- Legacy Shiny instructions are still discoverable.
- CRAN language is restrained and future-facing.
- Public docs do not instruct users to expose Postgres, Redis, Garage admin, Prometheus, or Grafana publicly.
- Public docs do not mention private hosts, local runtime notes, or personal infrastructure.

## Codebase Tidy QA

- No generated frontend `.next` paths are committed.
- No `node_modules`, `dist`, coverage, logs, or local caches are tracked.
- No stale package-manager lockfile conflicts remain.
- Review/planning docs in `docs/` are either useful public context or moved/retired before stable release.
- No debug labels, temporary copy, or awkward UI states are left in primary routes.
- `.gitignore` and `.dockerignore` cover local data, rasters, generated outputs, and release artifacts.

## Release PR

Open a fresh `dev -> main` PR only after the gates above are satisfied.

The PR body should include:

- current `dev` and `main` SHAs;
- latest green CI links;
- local gate summary;
- manual QA summary;
- screenshot artifact path or links;
- known beta limitations;
- statement that `legacy-shiny` preserves the old desktop line;
- statement that CRAN is deferred to a future extracted R package.

## Release Decision

Merge to `main` only after CI is green or every failing check has a documented, accepted reason.

Tag from `main`:

```bash
git tag v2.0.0-beta.3
git push origin v2.0.0-beta.3
```

Let the release workflow create a draft release, then review artifacts and release notes before publishing.
