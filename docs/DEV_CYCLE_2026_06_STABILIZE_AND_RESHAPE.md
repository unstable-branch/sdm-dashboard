# SDM Dashboard Development Cycle - June 2026

This plan starts from the verified `dev` branch state on 2026-06-02 and is meant to get SDM Dashboard out of integration churn before more feature work is added.

## Verified Baseline

Remote and branch checks performed on 2026-06-02:

- Remote: `origin` is `https://github.com/unstable-branch/sdm-dashboard.git`.
- `git fetch origin --prune` completed before inspection.
- `git ls-remote origin refs/heads/dev` returned `9e38c958eacb7f046e30405fff5c693c82239318`.
- GitHub branch API for `dev` returned the same head SHA.
- GitHub events showed the latest `refs/heads/dev` push was by `mrcanofcatfood` at `2026-05-31T08:28:23Z`, with head `9e38c958eacb7f046e30405fff5c693c82239318`.
- Local `/root/projects/sdm-dashboard-integration` is branch `dev`, tracking `origin/dev`, clean, and at the same commit.
- Latest verified `origin/dev` commit:
  - `9e38c95 fix: resolve shared package duplicate properties`
  - Author/committer: `mrcanofcatfood <jfind44@protonmail.com>`
  - Date: `2026-05-31T18:28:15+10:00`
- `origin/main` is `d0f48dca9f40c3379631edcf7db36fe857d7103e`.
- Current `origin/main..origin/dev` delta is large: 384 files changed, about 48k insertions and 5.7k deletions.

Local worktree layout:

- `/root/projects/sdm-dashboard` is the primary checkout, currently on `api/agentic-contract-foundation`.
- `/root/projects/sdm-dashboard-integration` is the linked worktree for `dev`.
- `/root/projects/sdm-dashboard-pr8` is the linked worktree for `integration/pr8-overfitting`.

The `sdm-dashboard-integration` name is a worktree artifact, not a separate project. Git worktrees do not allow the same branch to be checked out in two directories at once, so `dev` lives in a separate directory while `/root/projects/sdm-dashboard` is occupied by another branch.

## Current Risk Assessment

`dev` should be treated as an integration branch under stabilization, not as a release candidate yet.

Confirmed local gate failures:

- `pnpm run check:node` fails because `frontend/src/lib/geodesic.ts` imports `geographiclib`, but TypeScript cannot resolve the module/types.
- `Rscript -e 'testthat::test_file("tests/testthat/test-multi-ensemble.R")'` fails because Rangebagging references an undefined `threshold` component.
- `plumber/R/plumber.R` contains a broken GBIF search endpoint path that references undefined `occ`, `csv_path`, and `job_id` values.

Structural hotspots:

- `plumber/R/plumber.R` is 3022 lines and mixes route definitions, auth helpers, job submission, occurrence handling, model execution wiring, climate routes, ecology routes, diagnostics, and output serving.
- `R/core/run_sdm.R` is 1236 lines and carries a large share of model-specific branching.
- `frontend/src/components/model/model-config-form.tsx` is 1405 lines and contains UI state, validation, model-specific controls, payload assembly, and submit behavior in one component.
- Model configuration mapping is duplicated across frontend form state, API request payloads, Plumber JSON parsing, worker script arguments, and `sdm_config()`/`run_fast_sdm()`.

The main complexity is not just one large R file. The real issue is that model-run contracts are spread across too many layers without one authoritative mapping.

## Cycle Goal

Make `dev` boring again:

- Restore green local gates for the modern stack.
- Put model request mapping behind explicit contract tests.
- Split `plumber.R` without changing behavior first.
- Finish or clearly fence multi-species DNN so it does not half-work through only one execution path.
- Prepare a clean path from `dev` to `main` using the existing release plan in `docs/DEV_MAIN_RELEASE_PLAN.md`.

Non-goals for this cycle:

- Do not rename public products or rewrite project positioning.
- Do not merge `dev` to `main` until gates and manual QA pass.
- Do not attempt a full CRAN/package extraction.
- Do not make federation or multi-node execution part of the immediate stabilization gate.

## Phase 0 - Branch And Workspace Hygiene

Use a feature/stabilization branch off verified `origin/dev`.

Recommended branch:

```bash
git switch -c stabilize/dev-gates-20260602 origin/dev
```

Recommended workspace cleanup after current work settles:

- Keep `/root/projects/sdm-dashboard` as the human-facing canonical repo directory.
- Put short-lived implementation branches under `/root/projects/sdm-dashboard-worktrees/<topic>`.
- Either keep `/root/projects/sdm-dashboard-integration` as the long-lived `dev` integration worktree, or later rename/recreate it as `/root/projects/sdm-dashboard-worktrees/dev`.
- Do not rename active worktrees while Jacob or Pacey has unpushed work in them.

Acceptance:

- Worktree status is clean before each phase starts.
- Branch target is clear: feature/fix branches target `dev`; release PR targets `main`.
- No direct commits to `main`.

## Phase 1 - Stop The Bleeding

Fix the current red gates before refactoring.

Tasks:

1. Fix `frontend/src/lib/geodesic.ts`.
   - Prefer the smallest compatible fix first: add an explicit local declaration or adjust the import/package dependency to match the installed module.
   - Run `pnpm run check:node`.

2. Fix Rangebagging inside multi-ensemble.
   - Remove the undefined `threshold` reference from the component model call.
   - Make threshold selection happen at the ensemble level, or pass a clearly named optional threshold only where the callee supports it.
   - Run `Rscript -e 'testthat::test_file("tests/testthat/test-multi-ensemble.R")'`.

3. Fix the GBIF search endpoint.
   - Decide whether it is a synchronous search endpoint or an async job submission endpoint.
   - If synchronous, return concrete occurrence/search results and stop returning a fake `job_id`.
   - If async, create the CSV artifact and enqueue the job through the same path used elsewhere.
   - Add a route-level regression test if Plumber test scaffolding exists; otherwise add a focused helper test around the extracted GBIF handler.

4. Re-run minimum gates:
   - `pnpm run check:node`
   - `pnpm run check:compose`
   - R parse check for `R/`, `plumber/R/`, `scripts/`, and `tests/`
   - Targeted R tests for DNN multi-species and multi-ensemble

Acceptance:

- No known failing baseline gate remains untracked.
- Any gate that cannot run locally has a specific environment reason recorded.
- No feature work starts until this phase is green or explicitly waived.

## Phase 2 - Model Contract Consolidation

Create one explicit model request contract for the modern stack.

Tasks:

1. Add a shared TypeScript model payload builder.
   - It should be used by normal model runs, async jobs, reruns, and batch/multi-species paths.
   - It should normalize camelCase UI names into API payload names once.

2. Add an R-side model request adapter.
   - Suggested location: `plumber/R/model_request_adapter.R` or `R/core/model_request_adapter.R`.
   - It should translate Plumber/API JSON into `sdm_config()` and `run_fast_sdm()` arguments.
   - It should be used by both `plumber/R/plumber.R` and `plumber/R/run_model_background.R`.

3. Add contract tests for tricky model modes.
   - `multi_ensemble`
   - `dnn`
   - `dnn_multispecies`
   - threshold settings
   - algorithm parameter lists
   - array fields that previously became comma-joined strings
   - climate/environmental raster references

Acceptance:

- There is one frontend/API payload builder and one R-side adapter.
- No route manually reconstructs the same model argument list in a different shape.
- Tests fail if `dnnMultispeciesArchitecture`, seed count, or multi-ensemble model list is dropped.

## Phase 3 - Split Plumber Without Behavior Change

Do the Plumber refactor as a mechanical extraction first.

Proposed modules:

- `plumber/R/bootstrap.R` for package loading, environment, and shared constants.
- `plumber/R/auth.R` for API-key/internal auth helpers.
- `plumber/R/job_store.R` for job registry, status, cancellation, logs, and process handling.
- `plumber/R/routes_health.R` for health and diagnostics.
- `plumber/R/routes_occurrences.R` for upload, cleaning, GBIF, and occurrence previews.
- `plumber/R/routes_models.R` for model submission, result lookup, prediction outputs, and model metadata.
- `plumber/R/routes_climate.R` for climate/environmental data routes.
- `plumber/R/routes_ecology.R` for ecology analysis routes.
- `plumber/R/routes_outputs.R` for download and artifact serving.
- `plumber/R/routes_admin.R` for any internal/debug-only endpoints.

Keep `plumber/R/plumber.R` as bootstrap/router assembly only.

Tasks:

1. Inventory every `#* @` route annotation before moving code.
2. Extract helpers first, routes second.
3. Preserve route paths and response shapes.
4. Add a route inventory test that parses route annotations and compares expected route/method pairs.
5. Run R parse checks after each extraction batch.

Acceptance:

- `plumber.R` is small enough to read as an entrypoint.
- Route inventory is unchanged unless a route is deliberately removed or renamed.
- Job state and output paths are not silently changed.

## Phase 4 - Multi-Species DNN Completion Or Fence

Decide whether multi-species DNN is part of the next beta or explicitly experimental.

Recommended immediate stance: experimental but end-to-end testable.

Contract:

- Input should be a single occurrence table with a `species` column unless a separate multi-file upload contract is explicitly designed.
- Minimum validation should require at least two species and enough records per species for the selected validation strategy.
- Backend should return a manifest with richness outputs and per-species outputs, not only loose files.

Tasks:

1. Frontend:
   - Pass `dnnMultispeciesArchitecture` and seed count into the model payload.
   - Disable or warn when the uploaded occurrence data lacks a `species` column.
   - Keep the control visually marked as experimental.

2. API:
   - Ensure the same payload path is used for sync, async, queued, and rerun flows.
   - Validate that multi-species-only fields are not silently dropped.

3. R:
   - Add a `dnn_multispecies` branch in `run_fast_sdm()` model-specific args.
   - Fix mismatched argument names between staged helper code and `fit_dnn_multispecies_sdm()`.
   - Avoid full-raster memory blowups where possible; use chunked prediction or document the limit.
   - Return output manifests with clear per-species and richness artifact paths.

4. Tests:
   - Unit test `build_community_matrix()`.
   - Contract test JSON/API payload to R adapter.
   - Synthetic small multi-species test that skips cleanly if optional DNN packages are unavailable.
   - Result manifest test.

Acceptance:

- A user can start a small multi-species DNN run through the UI and get a clear success or clear dependency/data error.
- Multi-species settings survive every layer: UI, API, Plumber, background worker, model function.
- If optional dependencies are missing, the error explains that instead of failing deep in model code.

## Phase 5 - Frontend Form Decomposition

Split the model form after the contract layer exists.

Proposed extraction:

- `model-config-form.tsx` remains orchestration and submit shell.
- `model-param-panel.tsx` owns model-specific controls.
- `model-validation.ts` owns field validation and data-shape checks.
- `model-payload.ts` owns request building.
- Small controls live by model family where needed: DNN, multi-ensemble, rangebag, MaxEnt, Random Forest, etc.

Acceptance:

- Submit behavior is covered by tests before and after extraction.
- The form does not rebuild model payloads inline.
- Adding a new model requires touching a known config surface instead of editing several unrelated branches.

## Phase 6 - Product And Science QA

Once the system is green and contracts are centralized, do a product/science pass.

Tasks:

- Make experimental features explicit in UI copy and docs.
- Verify default model settings are defensible for small sample sizes.
- Confirm threshold and evaluation metrics are consistently named across UI, API, R, and output summaries.
- Ensure overfitting warnings are helpful and not presented as absolute scientific conclusions.
- Confirm download artifacts do not leak local absolute paths.
- Run the manual QA routes in `docs/QA_RELEASE_CHECKLIST.md`.

Acceptance:

- Primary workflows feel like a coherent workbench, not a pile of demos.
- Scientific outputs identify assumptions and limitations.
- Users can tell when a failure is data quality, dependency, model convergence, or infrastructure.

## Phase 7 - Release Candidate Gate

Only start this once Phases 1-6 are accepted.

Tasks:

- Rebase or merge latest `origin/dev`.
- Run release gates from `docs/DEV_MAIN_RELEASE_PLAN.md`.
- Start a fresh `dev -> main` PR.
- Include exact SHAs, local gate results, CI links, manual QA summary, and known limitations.

Stop conditions:

- `dev` is red without a documented accepted reason.
- The modern stack cannot start from documented compose commands.
- Primary routes show broken layout or placeholder copy.
- Multi-species is presented as production-ready without passing end-to-end.
- `main` gains unique commits that are not reconciled.

## Suggested Worker Split For Implementation

Use workers only after Phase 1 tasks are clearly scoped.

- Worker A: R model gate fixes and multi-ensemble regression tests.
- Worker B: frontend typecheck fix and model payload builder tests.
- Worker C: Plumber route inventory and GBIF endpoint extraction/regression test.
- Worker D: R-side model request adapter design and tests.
- Main seat: architecture, integration, review, final gate selection, branch hygiene, and release judgement.

Workers should not independently redesign contracts. They should implement bounded slices against the contract chosen in this plan.

## First Concrete Batch

The first implementation batch should be small:

1. Create `stabilize/dev-gates-20260602` from verified `origin/dev`.
2. Fix the three known red items: `geographiclib`, Rangebagging threshold, GBIF endpoint.
3. Add or update targeted tests for each fix.
4. Run the minimum gates.
5. Commit only when the batch is green or when a remaining failure is understood and intentionally left for the next batch.
