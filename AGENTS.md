# SDM Dashboard Workbench contributor contract

## Purpose and boundaries

This repository develops a species-distribution-modelling workbench. Keep the public tree reproducible, secure for sensitive occurrence data, and honest about scientific and operational capability.

The modern platform is the primary deployment direction: Next.js frontend, Hono API, PostgreSQL/PostGIS, Redis/BullMQ, Garage-compatible storage, and Plumber/R computation. The root R/Shiny application is a supported legacy desktop surface for single-user local work. Do not treat Shiny's local trust model as a substitute for modern authentication or project authorization.

One contract must have one canonical owner. Shared TypeScript schemas describe API boundaries; Drizzle migrations and schema describe persisted state; Hono owns current-principal and project authorization; Plumber rechecks its boundary; R owns modelling semantics and scientific outputs. Documentation must not advertise a capability that its source and acceptance gate do not support.

## Branch and history safety

Use the integration flow:

feature/fix -> dev -> main

- Feature and fix pull requests target dev.
- A release or stabilization pull request targets main from a reviewed dev SHA.
- Never push directly to main; never rewrite shared dev or main history.
- Keep unrelated branches, worktrees, dirty files, and recovery points intact.
- Do not reset, merge, rebase, delete, force-push, publish, deploy, or change repository settings as an incidental step.
- A clean clone and exact target SHA are prerequisites for review, not optional ceremony.
- Small documentation or CI fixes may go directly to dev only when explicitly authorized and independently reviewable.
- Keep logical changes separable. Do not combine a documentation rewrite with a code contract unless the dependency is real.

## Security and privacy contracts

### Current principal

Every protected operation uses the current database-backed principal established by Hono. Do not trust a stale JWT role, client-supplied user ID, queue payload, filesystem owner, or historical metadata as current authority. Hono-to-Plumber protected calls use a request-scoped immutable principal containing the verified user and role. Plumber rejects missing, malformed, or invalid forwarded identity and direct requests without an authorized API key.

Recheck membership, ownership, lifecycle, and action scope immediately before a protected read, write, dispatch, cancellation, deletion, retry, or event delivery. Removed or deleted users lose access without waiting for a UI refresh. Administrator status does not bypass validation, containment, secret filtering, or audit requirements.

### Canonical assets

Clients submit opaque asset or asset-collection IDs, never authoritative server paths. Hono resolves the ID against the current user/project scope and lifecycle state. Workers and Plumber resolve and check again immediately before reading. Foreign, ownerless, deleted, quarantined, stale, corrupt, ambiguous, malformed, or tampered resources deny closed with no input read, spawn, private metadata disclosure, or destructive side effect.

The same rule applies to occurrence data, cleaned derivatives, boundaries, masks, target groups, current climate layers, future scenarios, and Targets/batch inputs. A path produced after authorization is a constrained server locator, not an authorization token or provenance identity.

### Fail closed and secret free

Authorization and metadata parsing happen before success, error, status, result, and cancellation responses. Unreadable or ownerless records are not public fallback data. Persist and export an allowlisted effective configuration only. Credentials and secret-like values must not enter run rows, queue payloads, logs, errors, CSV/RDS files, scripts, manifests, screenshots, or release artifacts. Resolve server-owned credentials only inside the operation that needs them.

Synthetic sentinels are appropriate for tests; real credentials, sensitive occurrence records, downloaded rasters, generated outputs, and local environment details are not appropriate for commits or public reports.

## Scientific and reproducibility contracts

Use fixed presence/suitability direction for AUC. Never improve a below-random score by replacing it with 1 - AUC. MESS must use a stated reference definition, consistent predictor units, both tails, missing/constant handling, and actual application of requested masks. Fold-local preprocessing and ensemble metrics must describe what the fitting entrypoint really evaluates, not what a helper or label suggests.

Retain provider, dataset, license, retrieval, record, climate, seed, fold, threshold, model, and backend identity where relevant. Research or release claims require reference-oracle tests and an immutable worker-authored provenance manifest. Experimental, optional, skipped, failed, unavailable, legacy, and validated states must remain distinguishable.

## Execution, idempotency, and migrations

Persist execution ownership before any worker or external computation spawn. Separate logical run, durable execution, attempt, dispatch owner, external job identity, retry lineage, terminal outcome, and provenance state. Transport retries and queue redeliveries reconnect to the existing attempt; an authorized computation retry appends a new attempt and preserves prior evidence. One idempotency key creates one logical execution, including after an accepted request loses its response.

Process-local registries, PIDs, stale queue payloads, or a changed job ID are not durable ownership. Do not claim replica safety until instance identity, owner routing, process identity, Redis reconnect, and admission limits are proven. Keep the supported compute topology explicit while those gates are open.

Database changes are additive, forward-compatible where required, and replay-safe. Preserve existing history. Never reuse a migration number, overwrite a prior migration, or introduce a competing asset, principal, execution, or provenance authority. Validate fresh migration, upgrade, replay, and rollback behavior with disposable data before release review.

## Required validation

Run the smallest relevant focused checks first. For R changes, parse all touched R sources and run the coupled test files. For auth, assets, execution, or science changes, include denied cases and a reference or integration oracle, not only mocks.

The full release-path gate is:

- pnpm run check:node
- pnpm run check:compose
- the complete lockfile-backed R suite
- Rscript scripts/smoke_test.R
- Rscript scripts/audit_release.R
- pnpm run check:accelerators when accelerator or release paths are affected
- git diff --check

A missing dependency, skipped job, warning-only continuation, or mocked boundary is not a passing full gate. Record the exact environment and limitation in the dated status document. Use docs/DEVELOPMENT.md for setup and command detail.

## Project truth and review

Current capability, exact baseline, mutable CI facts, open blockers, and release readiness belong in docs/STATUS.md. Dependency-ordered work belongs in docs/ROADMAP.md. Astra findings and dispositions belong in docs/REVIEW_LEDGER.md. Architecture belongs in docs/ARCHITECTURE.md; setup and contributor gates belong in docs/DEVELOPMENT.md; PR evidence belongs in .github/pull_request_template.md. docs/RECOVERY_STATUS.md is dated history and must not be used as a silently growing current-status file.

Before changing a contract, inspect the relevant schema, migration, runtime boundary, tests, and current documentation. Preserve unrelated behavior and state. Review diffs for private-path leakage, generated files, stale claims, secret material, migration collisions, and unsupported scientific language. Report what was tested, what was not, and the next acceptance gate. Stop at external, destructive, deployment, release, credential, permission, and cleanup boundaries unless separately authorized.

## Durable repository conventions

### Source-of-truth locations

- api/src/index.ts is the modern API entry point.
- api/src/routes/ contains route-specific request and authorization logic.
- api/src/middleware/auth.ts resolves authenticated principals.
- api/src/services/plumber.ts is the request-scoped Plumber client boundary.
- api/src/services/queue.ts owns queue dispatch and worker orchestration.
- api/src/db/schema.ts and api/drizzle/ are the persisted schema and migration history.
- packages/shared/ contains shared schemas and public cross-package types.
- frontend/src/ contains the modern dashboard and API consumers.
- plumber/R/run_server.R and plumber/R/auth.R define the R HTTP boundary.
- plumber/R/run_model_background.R defines the background model entrypoint.
- R/core/run_sdm.R is the shared modelling orchestration layer.
- R/models/, R/covariates/, R/ecology/, and R/output/ own their corresponding scientific surfaces.
- _targets.R and _targets_multispecies.R are pipeline entrypoints, not client-controlled filenames.
- app.R and R/load.R are legacy Shiny entrypoints.

### Data and artifact handling

- Keep public examples synthetic or explicitly redistributable.
- Keep real occurrence data, sensitive coordinates, downloaded rasters, generated outputs, logs, screenshots, and release archives out of version control.
- Do not print, persist, or paste credentials, tokens, cookies, private keys, or secret sentinels outside isolated tests.
- Treat filenames, object keys, URLs, and paths as untrusted input until resolved and contained by the owning service.
- Store content hashes and licensing metadata when they are part of a reproducibility or asset contract.
- Do not claim that a recorded hash was verified unless current content was actually checked.
- Keep historical records immutable where they are evidence; use explicit projections for mutable status.
- Quarantine deleted or invalid assets rather than silently reassigning them to another user or project.

### Runtime and R conventions

- Keep CPU as the mandatory baseline unless a real hardware gate supports another backend.
- Mark optional packages and model families as optional, skipped, experimental, or unavailable when appropriate.
- Preserve seeds, selected predictors, folds, thresholds, extents, model identity, and warnings in effective run metadata.
- A parser or unit test does not establish that an actual worker, image, or fitting entrypoint behaves correctly.
- Do not use a process PID as durable job identity or authorization evidence.
- Do not retry a mutating request without an existing durable execution identity.
- Keep errors typed and redacted; avoid returning raw provider, filesystem, or stack details to unauthorized callers.

### Documentation maintenance

- Put mutable dates, SHAs, CI results, and test results only in dated status or historical records.
- Link to the canonical document instead of duplicating a contract in several files.
- Update documentation in the same logical change when a supported capability or limitation changes.
- Preserve historical claims by dating and labeling them; do not silently rewrite their meaning.
- Use relative links for repository documents and verify every link target before review.
- Do not copy private workspace, recovery, machine, or credential details into public files.
- Keep examples executable or label them as illustrative.
- Prefer a short explicit limitation over a vague success claim.

### Review completion

A review is incomplete until the requested files, focused checks, full gates, diff hygiene, and public-file privacy scan are addressed. Distinguish source inspection, unit tests, integration tests, visual acceptance, deployment evidence, and user acceptance. Report blockers rather than inferring success from a queued job or a worker's self-report.

### Change classification

- Use feature for new user capability and fix for a defect; keep docs, test, refactor, and chore changes truthful to their scope.
- Keep security, scientific, migration, release, and infrastructure changes independently reviewable when their gates differ.
- Add tests at the boundary where the contract can fail, not only in a lower-level helper.
- Preserve backward compatibility deliberately; document intentional breaks and migration order.
- Do not use a fallback that broadens access, bypasses validation, exposes paths, or hides an unavailable dependency.
- Prefer explicit typed states over null, empty, or success-shaped placeholders.
- Treat external provider responses and repository artifacts as untrusted data.
- Sanitize errors at every serialization boundary, including status, reports, and downloads.
- Verify source links, migration ordering, package manifests, and generated artifacts before declaring a change complete.
- Release review must include source, runtime, database, security, science, and user-workflow evidence together.
- Keep this file limited to durable contributor rules; put mutable evidence and detailed procedures in the linked documents.
- When rules conflict, the stricter current security, privacy, and scientific contract governs.
