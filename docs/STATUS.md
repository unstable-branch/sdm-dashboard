# Project status

**Snapshot date:** 2026-09-17 AEST
**Implementation baseline for this documentation batch:** 6df341a672e15278408206c933a89ec5a551cd9f
**Live dev baseline:** origin/dev at 27ecdac (full SHA 27ecdac02aefc24d792740e83610239f01c4d5b8)
**Accepted local R test-fix commit:** 6df341a (full SHA 6df341a672e15278408206c933a89ec5a551cd9f)

This is a dated status snapshot. SHAs, CI results, dependency availability, and test outcomes must be refreshed before relying on them. The documentation commit that contains this snapshot is reported in review evidence rather than self-referenced here. This line is not a release candidate and makes no release-readiness claim.

## Supported today

- Modern authenticated platform architecture: Next.js, Hono, PostgreSQL/PostGIS, Redis/BullMQ, Garage-compatible storage, and Plumber/R.
- Legacy R/Shiny desktop workflow for private, single-user local use.
- Current-principal session handling and authenticated Hono-to-Plumber forwarding, with focused contract coverage.
- Canonical occurrence asset IDs through upload, cleaning, model, batch, retry, and relevant Targets paths.
- Secret-free execution configuration and sanitized status/output paths on the recovered execution path.
- Fixed-direction AUC and repaired reference-consistent MESS/masking behavior in the changed science paths, subject to the gates below.
- CPU is the mandatory compute target. CUDA, ROCm, Python backends, and advanced model families remain optional or experimental unless their specific image and hardware gates pass.

“Supported” here means the source contract is present. It does not mean every end-to-end, locked-environment, scientific, or production gate has passed.

## Known limitations and blockers

- Boundary, mask, target-group, and current/future climate-directory inputs still need canonical asset IDs and equivalent worker/direct-Plumber enforcement.
- Durable execution ownership, append-only attempts, accepted-response recovery, idempotent mutation, and standalone Targets run mapping are not complete.
- SSE/WebSocket replay and delivery need current-authority checks through revocation, reconnect, and replica boundaries.
- Fold-local VIF at the actual fit entrypoint, aligned out-of-fold ensemble metrics, script export replay, immutable worker-authored provenance, and content-based cache verification remain open.
- PID-based cancellation and multi-replica event identity are not safe. Keep compute topology explicitly single-replica until proven otherwise.
- The full locked-R dependency gate is blocked at this snapshot. A local `renv::restore()` attempt could not retrieve the lockfile versions of cito, torch, and safetensors from the configured repositories; pandoc is also absent for paws.common. The system-library suite therefore remains non-authoritative and fails where data.table is unavailable. Fast smoke, focused checks, parse/release checks, and any Node/Compose results must not be described as a passing complete R gate. Re-run the complete lockfile-backed suite in an authoritative environment with the archived sources and required system tools available.
- Remote governance, branch protection, release version alignment, deployment, cleanup, and public tag policy remain separate decisions. No remote write, deployment, or release publication is implied here.

## Evidence recorded for this snapshot

The accepted recovery line is represented through the live dev baseline. Accepted local commit `6df341a` makes R quality tests resolve project root and runtime helper dependencies independently of test order. The live baseline and local stabilization line must be checked again before integration or publication.

Required full gates for a release review are pnpm run check:node, pnpm run check:compose, the complete lockfile-backed R suite, R smoke, release audit, affected accelerator contracts, and git diff --check. A passing focused gate cannot substitute for a missing full gate. Exact results belong in a refreshed dated status entry, not in AGENTS.md.

## Release posture

**Not release-ready.** The primary authenticated upload-to-clean-to-model-to-result workflow, durable lifecycle, scientific reference-oracle acceptance, immutable provenance, and complete environment gates are not jointly accepted. Do not advertise a validated production or research release from this snapshot.

See ARCHITECTURE.md, DEVELOPMENT.md, ROADMAP.md, REVIEW_LEDGER.md, and the dated recovery history in RECOVERY_STATUS.md.
