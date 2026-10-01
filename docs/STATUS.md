# Project status

**Snapshot date:** 2026-09-20 AEST
**Integration base:** origin/dev at d5167a2 (full SHA d5167a289234af5020fa491139c2f6ebc1c9685f)
**Candidate branch:** security/phase2-canonical-inputs (local review candidate; not published)

This is a dated status snapshot. SHAs, CI results, dependency availability, and test outcomes must be refreshed before relying on them. The documentation commit that contains this snapshot is reported in review evidence rather than self-referenced here. This line is not a release candidate and makes no release-readiness claim.

## Supported today

- Modern authenticated platform architecture: Next.js, Hono, PostgreSQL/PostGIS, Redis/BullMQ, Garage-compatible storage, and Plumber/R.
- Legacy R/Shiny desktop workflow for private, single-user local use.
- Current-principal session handling and authenticated Hono-to-Plumber forwarding, with focused contract coverage.
- Canonical occurrence, boundary/mask, target-group, and current/future climate collection IDs on the direct and queued model paths. Inputs are re-resolved at dispatch with kind, project, lifecycle, lineage, content-identity, and containment checks.
- Authenticated climate discovery publishes immutable manifests, registers system-scoped collection IDs, and exposes only allowlisted metadata. Climate deletion is an administrator-only soft lifecycle transition by opaque collection ID; physical shared-file reclamation remains deferred.
- Secret-free execution configuration and sanitized status/output paths on the recovered execution path.
- Fixed-direction AUC and repaired reference-consistent MESS/masking behavior in the changed science paths, subject to the gates below.
- CPU is the mandatory compute target. CUDA, ROCm, Python backends, and advanced model families remain optional or experimental unless their specific image and hardware gates pass.

“Supported” here means the source contract is present. It does not mean every end-to-end, locked-environment, scientific, or production gate has passed.

## Known limitations and blockers

- Targets/batch execution remains deliberately unavailable until durable execution ownership and the provider-supervisor/effect harness are accepted; it must not be presented as a working execution path.
- Physical climate-file reclamation is intentionally unavailable until shared-member reference accounting is verified. Administrator deletion only marks the canonical collection unavailable.
- Durable execution ownership, append-only attempts, accepted-response recovery, idempotent mutation, and standalone Targets run mapping are not complete.
- SSE/WebSocket replay and delivery need current-authority checks through revocation, reconnect, and replica boundaries.
- Fold-local VIF at the actual fit entrypoint, aligned out-of-fold ensemble metrics, script export replay, immutable worker-authored provenance, and content-based cache verification remain open.
- PID-based cancellation and multi-replica event identity are not safe. Keep compute topology explicitly single-replica until proven otherwise.
- The full locked-R dependency gate is blocked at this snapshot. Local `renv::restore()` attempts could not retrieve pinned cito, torch, safetensors, and later cli sources from the configured repositories; pandoc is also absent for paws.common. The system-library suite therefore remains non-authoritative and fails where data.table is unavailable. Fast smoke, focused checks, parse/release checks, and Node/Compose results must not be described as a passing complete R gate. Re-run the complete lockfile-backed suite in an authoritative environment with the archived sources and required system tools available.
- Remote governance, branch protection, release version alignment, deployment, cleanup, and public tag policy remain separate decisions. No remote write, deployment, or release publication is implied here.

## Evidence recorded for this snapshot

The accepted recovery line is represented through the live dev baseline. Accepted local commit `6df341a` makes R quality tests resolve project root and runtime helper dependencies independently of test order. The live baseline and local stabilization line must be checked again before integration or publication.

Required full gates for a release review are pnpm run check:node, pnpm run check:compose, the complete lockfile-backed R suite, R smoke, release audit, affected accelerator contracts, and git diff --check. A passing focused gate cannot substitute for a missing full gate. Exact results belong in a refreshed dated status entry, not in AGENTS.md.

### Phase 2 local candidate evidence on 2026-09-20

- Shared tests passed: 153 tests. API tests passed: 42 files / 424 tests. Frontend tests passed: 34 files / 219 tests.
- Workspace typechecks and builds passed. Lint completed with existing non-fatal warning debt and no errors. `git diff --check` passed.
- The focused canonical-input, climate, authentication, and frontend contract tests passed, including unauthenticated target-group rejection and route-to-Plumber path translation. In the pinned CPU image `sdm-dashboard-plumber:phase2-test` (`sha256:e8177f839165556cbd14626babb81c12294916df235ffb97b2bd0a5372be52ff`), the checked-in attestation invocation `docker run --name phase2-attestation-check-20260920 --entrypoint Rscript -i -v "$PWD:/app" -w /app sdm-dashboard-plumber:phase2-test --vanilla -` with stdin `testthat::test_file("tests/testthat/test-execution-attestation.R")` exited 1 because `testthat` is not installed. The manual equivalent was run with `docker run --name phase2-attestation-manual-20260920 --entrypoint Rscript -v "$PWD:/app" -w /app sdm-dashboard-plumber:phase2-test --vanilla .phase2-attestation-manual.R` using a temporary local script mirroring the checked-in assertions and printed `manual equivalent attestation assertions: 5 passed`; this is not testthat-backed evidence.
- The seven Compose configuration invocations represented by `check:compose` passed with the corrected dummy `PLUMBER_EXECUTION_KEY`, and the pinned CPU Plumber image built successfully. The CPU image smoke gate passed. The exact image-mounted suite command `docker run --name phase2-suite-check-20260920 --entrypoint Rscript -v "$PWD:/app" -w /app sdm-dashboard-plumber:phase2-test --no-init-file tests/testthat.R` exited 1 with 81 `not ok` lines, 18 `Skipped:` lines, and a final `there is no package called ‘testthat’` error. The host `pnpm run check:node` command could not be invoked because pnpm is unavailable, although its constituent workspace checks were run directly. The Phase 2 candidate is therefore not release-accepted and must pass the complete authoritative gates.

### Phase 1 gate evidence at implementation SHA `671571c24838149c851d4b5406946afae87c31b7`

- Focused R Quality, strict-auth coupling, and changed-working-directory tests passed; 244 R files parsed.
- `pnpm run check:node` passed as an aggregate: shared/API/frontend typechecks and builds, API 37 files / 372 tests, and frontend 27 files / 209 tests. Existing lint warnings remain non-fatal.
- `pnpm run check:compose`, `pnpm run check:accelerators`, `Rscript --no-init-file scripts/smoke_test.R --tags=fast`, `Rscript --no-init-file scripts/audit_release.R`, and `pnpm run check:release` passed.
- The smoke gate reported optional maxnet and ranger backends unavailable and skipped their contracts.
- The complete lockfile-backed R gate did not run because restore failed as recorded above. A system-library `tests/testthat.R` run reached the repaired tests but failed on missing data.table and is not accepted as the locked gate.

## Update: 2026-09-28 AEST (after the dated snapshot above)

PR #105 merged the bounded plain-GLM VIF correction into `dev` at `2cf436b1f13ece89f1d52f64fcefa674172a78fd`. Direct GLM runs with VIF enabled select predictors on each CV fold's training rows, select final-fit predictors on sampled fitting rows, and align current/future suitability and MESS to the final feature set. The fixed-fold synthetic oracle tests held-out perturbations that change a leaked full-data selection. Unsupported multiple pseudo-absence replicates fail before direct-run setup. The staged/Targets GLM VIF path now **fails explicitly** instead of silently ignoring the option; its fit, projection, and MESS alignment remains a separate implementation gate. The 2026-09-20 statement above that fold-local VIF is wholly open is therefore superseded for the direct plain-GLM route only.

All six PR checks passed on exact head `e1a8561f749cdbb3ea066dd4fc55521bd0fc9fc2`; both post-merge Platform CI and R Quality Checks passed on exact `dev` SHA `2cf436b1f13ece89f1d52f64fcefa674172a78fd`. A network-isolated diagnostic R 4.4.2 run also passed the focused GLM/future/Group-S tests and fast smoke. These are bounded integration checks, **not** the complete lockfile-backed R 4.5 gate: CI installs R dependencies with `RENV_PROJECT=""`, and no accepted CPU/CUDA/ROCm candidate-model matrix or authenticated release journey was run. The environment, durable execution, request/effect attribution, ensemble out-of-fold metrics, staged feature alignment, operations rehearsal, and exact-candidate release gates remain open.

## Update: 2026-10-02 AEST — R package contract follow-up

This update supersedes the 2026-09-20 snapshot's R restore/status blocker for the exact image and lock stated here; it does **not** make the complete R test gate green.

- Reused the rootful Podman store and the immutable `docker.io/rocker/geospatial@sha256:e501f5e7e6128dd65ccf753c35f6a7aca85c9e62c3c2e0ab258fe3e28e562a80` image (linux/amd64; R 4.5.0; Podman 5.4.2). The fresh project library restored the final 204-record lock; all 204 DESCRIPTION versions matched their lock records. A separate `renv::status()` process reported `No issues found -- the project is in a consistent state.` and `status$synchronized=TRUE`.
- The lock gained only `sodium` 1.4.0, because the locked `plumber` package imports it. The prior 203 lock records and top-level R metadata were verified byte-preserved. `renv/settings.json` ignores exactly 28 source-scanned optional/development packages for the declared base profile; the hard-dependency checker and its 9-fixture self-test remain unchanged and passed (21 declared root hard dependencies, 204 lock records, none missing).
- CPU LibTorch is feasible but remains outside `renv.lock`. In a writable scratch `TORCH_HOME` with `CUDA=cpu`, `torch::install_torch()` downloaded LibTorch 2.8.0 CPU (170.6 MB) and Lantern 0.17.0 CPU (5.7 MB). A separate offline R process returned `torch::torch_is_installed()=TRUE`; a CPU tensor sum returned 6. The `r-quality` workflow exercises this CPU path; the CPU Plumber image separately builds a checksum-pinned runtime, CUDA has its own image, and ROCm uses Python PyTorch.
- After both package-status and LibTorch gates passed, the one network-disabled `Rscript tests/testthat.R` run exited 1. It reported four failures: `test-batch-parallel.R:352` and `:361` (both `build_crew_controller` results failed the expected `crew_controller` class assertion); `test-batch-targets.R:48` (expected `SDM_TARGETS_WORKERS` to equal `"4"`, got `""`); and `test-plumber-auth-denial-abort.R:194` (`testthat::expect_length()` rejected its `info=` argument as unused). This suite was not rerun; the complete R test gate remains blocked on these failures.
- Resource checks remained within the stated ceilings. During CPU installation, `/` retained 58,543,906,816 bytes free and measured growth from the task baseline was 2,732,843,008 bytes; after scratch cleanup `/` had 60,647,108,608 bytes free. The isolated Podman store had no remaining containers, and `netavark-dhcp-proxy` remained inactive.

## Update: 2026-10-02 AEST — R suite triage follow-up

This supersedes the preceding same-day statement that the complete R suite remained blocked and was not rerun; that statement records the pre-fix result. On `a152f18b86f925be517ff3173fd033348a52bfee`, the pinned R 4.5.0 image and 204-record lock restored with all locked DESCRIPTION versions exact and `renv::status()` synchronized.

- The four pre-fix failures were reproduced across three files. Both crew checks were test defects: locked `crew` 1.3.3 returns a `crew_class_controller` R6 object, not an object inheriting `crew_controller`. The Targets worker assertion was stale (`_targets.R` reads `SDM_CLUSTER_WORKERS`, not `SDM_TARGETS_WORKERS`); the helper also contradicted the unavailable-execution boundary by dispatching `tar_make()`. It now fails closed with `TARGETS_DURABLE_EXECUTION_UNAVAILABLE` before validation or side effects. The Plumber test passed unsupported `info=` to testthat 3.3.2 `expect_length()` and now asserts the same length through `expect_identical()`.
- The same focused files were run against `origin/dev` SHA `884dd6d486b21b10d59f97a6c2233492a8190882`: the two crew assertions and Plumber test failed there too; the four Targets tests skipped because the dev lock has 195 records and does not install `targets`. Dev locked DESCRIPTION versions matched, but `renv::status()` was not synchronized because that baseline also has source-scanned dependencies absent from the lock and a site-library `sodium` package not recorded there.
- Post-fix focused results: 0 failures, 0 errors, 3 skips (empty batch-parallel tests). The changed R sources parsed and `Rscript scripts/smoke_test.R --tags=fast` passed.
- After the lock-status and offline CPU LibTorch tensor gates passed, the single network-disabled `Rscript tests/testthat.R` run exited 0: 2,173 passed, 90 skipped, 223 warnings, and 0 failures/errors (2,486 total). Skips remain for optional backends, absent raster data, and hardware-specific cases. This is locked-suite evidence for this exact candidate, not release acceptance; review the warnings and remaining release gates separately.

## Update: 2026-10-02 AEST — PR #107 CLI boundary correction

- Restored the exact `--no-targets` legacy `future_lapply` route while keeping the default Targets route fail-closed before optional parsing, project loading, output creation, cluster environment mutation, or dispatch. `--help` explains that split; malformed `--no-targets=<value>` is rejected, and other invocations cannot default into Targets.
- Focused `test-batch-cli-unavailable.R` passed in the R 4.5.0 base test environment with `testthat` 3.3.2 and no `optparse`; the legacy route reports explicit optional-package guidance. It also passed in a separate scratch optional profile with `optparse` 1.8.2, where a real Rscript subprocess and controlled loader stubs proved exact `--no-targets` reaches `batch_run_parallel`, while an unknown option does not dispatch. Help and R parse smoke checks passed.
- No lock/settings or Targets-helper changes were made. The full locked R suite and CI were not rerun for this new candidate; run full CI against its new commit SHA before integration. Logs are preserved under `/root/spookys-workspace/reports/sdm/cli-boundary-fix-2026-10-02/`.

## Release posture

**Not release-ready.** The primary authenticated upload-to-clean-to-model-to-result workflow, durable lifecycle, scientific reference-oracle acceptance, immutable provenance, and complete environment gates are not jointly accepted. Do not advertise a validated production or research release from this snapshot.

See ARCHITECTURE.md, DEVELOPMENT.md, ROADMAP.md, REVIEW_LEDGER.md, and the dated recovery history in RECOVERY_STATUS.md.
