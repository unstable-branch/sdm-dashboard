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
- The focused canonical-input, climate, authentication, and frontend contract tests passed, including unauthenticated target-group rejection and route-to-Plumber path translation. The R execution-attestation file passed all 5 tests in the pinned CPU image environment.
- The seven Compose configuration invocations represented by `check:compose` passed with the corrected dummy `PLUMBER_EXECUTION_KEY`, and the pinned CPU Plumber image built successfully. The CPU image smoke gate passed; the complete image-mounted R testthat suite reported 10 failures in crew/CoordinateCleaner/ESM/FDA tests. The host `pnpm run check:node` command could not be invoked because pnpm is unavailable, although its constituent workspace checks were run directly. The Phase 2 candidate is therefore not release-accepted and must pass the complete authoritative gates.

### Phase 1 gate evidence at implementation SHA `671571c24838149c851d4b5406946afae87c31b7`

- Focused R Quality, strict-auth coupling, and changed-working-directory tests passed; 244 R files parsed.
- `pnpm run check:node` passed as an aggregate: shared/API/frontend typechecks and builds, API 37 files / 372 tests, and frontend 27 files / 209 tests. Existing lint warnings remain non-fatal.
- `pnpm run check:compose`, `pnpm run check:accelerators`, `Rscript --no-init-file scripts/smoke_test.R --tags=fast`, `Rscript --no-init-file scripts/audit_release.R`, and `pnpm run check:release` passed.
- The smoke gate reported optional maxnet and ranger backends unavailable and skipped their contracts.
- The complete lockfile-backed R gate did not run because restore failed as recorded above. A system-library `tests/testthat.R` run reached the repaired tests but failed on missing data.table and is not accepted as the locked gate.

## Release posture

**Not release-ready.** The primary authenticated upload-to-clean-to-model-to-result workflow, durable lifecycle, scientific reference-oracle acceptance, immutable provenance, and complete environment gates are not jointly accepted. Do not advertise a validated production or research release from this snapshot.

See ARCHITECTURE.md, DEVELOPMENT.md, ROADMAP.md, REVIEW_LEDGER.md, and the dated recovery history in RECOVERY_STATUS.md.
