# Development and verification

## Local setup

The modern stack requires Docker Compose, Node.js 22 or newer, pnpm 10.30.3 or newer, and a working R environment for local R gates. Use the repository's frozen lockfile for Node dependencies. R package installation and system-library requirements are documented by the existing installers and workflow files. Do not commit local environment files, caches, outputs, rasters, or credentials.

Install and start modern development services using the documented scripts and compose profiles. The root README covers the clean-clone quickstart; docker-compose.dev.yml defines development services. A normal local sequence is:

~~~text
pnpm install --frozen-lockfile
./scripts/dev-start.sh
# Terminal A
(cd api && pnpm dev)
# Terminal B
(cd frontend && pnpm dev)
~~~

Run API and frontend development servers from their package directories when needed. For the legacy desktop surface, install the documented R packages and run Rscript launch_app.R. The legacy app is launched separately and is not a substitute for the authenticated modern stack.

## Focused checks

Choose checks from the changed boundary:

- TypeScript schema, route, service, or queue work: build the shared package, then run affected API/shared/frontend tests and typechecks.
- Auth, principal, asset, or event work: include missing, foreign, removed, deleted, ownerless, corrupt, stale, malformed, and concurrent cases; verify no read, spawn, disclosure, or destructive side effect on denial.
- R or Plumber work: parse changed sources, run coupled testthat files, and run the fast smoke gate. Tests must load runtime dependencies explicitly rather than relying on source order or the caller's working directory.
- Scientific work: use known-answer/reference-oracle cases for direction, units, tails, masking, folds, missing values, and downstream labels.
- Migration work: test fresh apply, upgrade, replay, and failure recovery against disposable PostgreSQL.

## Phase 1A focused R checks

For the stabilization baseline, run these coupled files before the complete suite:

- tests/testthat/test-execution-config-security.R
- tests/testthat/test-handle-climate-cancel.R
- tests/testthat/test-plumber-runtime-correctness.R
- directly coupled authorization-helper tests selected by the changed runtime path

These checks validate project-root resolution and explicit runtime helper loading. They do not replace the complete lockfile-backed R gate.

## Required gates

Before a PR targeting dev, run as applicable:

1. pnpm run check:node for the complete modern Node gate.
2. pnpm run check:compose for all supported compose configurations.
3. Rscript scripts/smoke_test.R and the complete Rscript tests/testthat.R gate for R changes or release review.
4. Rscript scripts/audit_release.R for release/source-bundle changes.
5. pnpm run check:accelerators for accelerator or image-contract changes.
6. git diff --check for every PR.

The complete locked R suite is distinct from a fast smoke test, focused tests, or a parse check. Missing packages or system libraries must be reported as blocked, not converted to a skip or presented as green. CI results apply to the exact reviewed commit only.

## CI interpretation

A successful build does not prove authenticated workflow behavior, scientific validity, or release readiness. A mocked Plumber client does not prove Hono-to-Plumber identity forwarding. A test count does not prove coverage of SQL NULL semantics, concurrent refresh, restart, replica identity, or real asset containment. Hardware-specific GPU claims require corresponding hardware evidence.

Keep failures and skipped jobs visible. Do not weaken production authorization, retry writes automatically, or add compatibility fallbacks merely to make a test pass. Update docs/STATUS.md when a gate result or supported capability changes.

## Pull request shape

Use one focused story per PR and target dev for feature/fix work. Explain the user/scientific reason, security impact, scope, explicit non-goals, evidence, limitations, migration compatibility, and rollback. Use .github/pull_request_template.md. Do not include private paths or recovery-session details in public text.
