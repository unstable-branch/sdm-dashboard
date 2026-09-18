# Recovery status and direction

_Last updated: 2026-09-18_

This branch is a staged recovery of the reviewed `main` snapshot. The architecture is being retained: the work is repairing contracts between Next.js, Hono, Plumber, PostgreSQL, queues, and the R modelling pipeline rather than replacing them.

## What is already improved

1. **Trustworthy baseline**
   - Corrected the broken GitHub Actions checkout pin.
   - Repaired stale API mocks and assertions around role forwarding.
   - Restored reliable Node, build, workflow, compose, and release checks.

2. **Current account and session authority**
   - JWT and API-key requests resolve the current database-backed principal.
   - Password recovery, password changes, and revoke-all invalidate browser sessions.
   - Refresh-token rotation is atomic and migration cutover forces reauthentication.
   - WebSocket authentication uses the same current-principal rules.

3. **Secret-free execution configuration**
   - Raw provider credentials are rejected recursively at request boundaries.
   - Only explicitly supported science configuration is persisted or executed.
   - Historical retries are revalidated instead of replaying arbitrary JSON.
   - R workers, targets CSVs, metadata, status, logs, manifests, scripts, and provider-error paths apply the same containment rules.

4. **Canonical input assets and protected execution**
   - Added an additive canonical asset registry with opaque IDs, immutable content identity, scope, kind, lifecycle state, and derivative lineage.
   - Occurrence upload, generation, cleaning, frontend state, synchronous and queued model execution, targets, batch and retry paths now resolve current asset authority before use.
   - Protected Hono-to-Plumber calls carry immutable current-principal clients; direct R status, cancellation and deletion authorization denies missing, corrupt, ownerless and unauthorized metadata before side effects.
   - Custom-boundary and target-group inputs now use canonical asset IDs through submission, queue, retry, batch, Targets and final R dispatch.
   - Mask and climate-directory inputs still require canonical-asset cutover.

## Security policy being implemented

- Uploads are creator-private until explicitly shared with a project.
- Project viewers may read enumerated safe outputs; editors may create and use project inputs; project admins manage project resources.
- Removed members immediately lose project input, result, retry, and event access.
- Ownerless, corrupt, ambiguous, or tampered legacy resources fail closed.
- Server-owned provider credentials never belong in run requests or reproducibility artifacts.
- Administrator access remains audited and never bypasses validation, path safety, or secret filtering.

## Current milestone

**Milestone 2: security boundaries** remains active. The next coherent slices are:

1. Canonicalize mask and climate-directory inputs after their collection and lifecycle contracts are approved.
2. Add durable execution ownership for standalone runs and targets so restart reconciliation never invents creator authority.
3. Revalidate current account/project authority for open SSE and WebSocket delivery.
4. Run the auth-enabled two-user, project-member, revoked-member, administrator, API-key, direct-Plumber and failure-path acceptance matrix.
5. Preserve unavailable monitoring as unavailable until an explicitly authorized service-metrics path exists.

This branch is intentionally not presented as a finished security milestone yet. The reviewed local candidate also carries the isolated Plumber workaround documentation and a full-suite path correction; these do not close the remaining security or environment gates.

## Later milestones

- **Scientific correctness:** fixed-direction AUC, ENMeval/ensemble ranking and empirical-percentile MESS with exported masking are repaired; fold-local VIF, remaining ensemble semantics and broader known-answer/image gates remain.
- **Immutable provenance:** sealed effective configuration, canonical input and artifact hashes, runtime/package/code identity, metric semantics version, and honest reproducibility claims.
- **Lifecycle and scale:** packaged Targets execution, idempotent submission, restart reconciliation, truthful cancellation, and explicit single-replica limits until ownership is safe.
- **Interface acceptance:** narrow visual and human-flow testing after the underlying contracts are stable.

## Known limitations at this checkpoint

- Mask and climate-directory inputs are not yet canonicalized. Climate work is blocked on migration-metadata reconciliation and explicit collection, lifecycle and scientific-compatibility decisions.
- Standalone run and standalone Targets restart reconciliation is deliberately blocked until durable execution ownership exists.
- Existing path-based historical records are not automatically trusted or reassigned.
- Target-group quota reservation and canonical asset persistence are not transactionally coupled; commit-response ambiguity remains an explicit accounting residual pending the durable execution/idempotency design.
- The lockfile-backed full R suite is not available locally because required packages such as `data.table`, ENMeval and torch are absent. Fast smoke, focused changed-path tests and release audit pass; the attempted broad system-library suite fails on missing dependencies and is not represented as green.
- Live PostgreSQL/Plumber target-group integration and migration replay/rollback evidence remain open.
- No further remote branch, tag, workflow, protection, release or deployment change is authorized by this checkpoint.

## Review guidance

Review the commits in order. Each commit is intended to establish one contract and remain understandable independently. Please treat missing integration as an open slice rather than filling it with a permissive compatibility fallback. In particular, do not restore client-controlled paths, stale JWT authority, raw credential fields, ownerless legacy access, or unaudited administrator bypasses.

## Initial recovery checkpoint — 2026-09-16

The first reviewable checkpoint now reaches canonical occurrence upload and cleaning integration. The exact local implementation tip before this documentation update is `97310b3ccac4c40d959b26c9615b3e1db05c3944`. No recovery commits have been pushed at the time of writing.

### Included commits

- `3f16d7a` ci: restore trustworthy baseline checks
- `a1c8607` fix: enforce current session principals
- `6af5de5` fix: reject secrets from execution config
- `1c01369` fix: contain execution credentials in R runtime
- `e0f30b4` feat: establish canonical input assets
- `f52efca` docs: record recovery direction and checkpoint
- `97310b3` security: bind occurrence flows to canonical assets

### What this checkpoint establishes

- deterministic baseline and release hygiene
- hardened sessions, authentication and current-principal checks
- secret-free TypeScript and R/Plumber ingress, persistence and egress
- canonical UUID input assets with scope, state, immutable identity and lineage
- occurrence uploads, generated data and cleaning jobs using opaque canonical asset IDs
- durable async cleaning ownership and canonical cleaned-asset finalization
- fail-closed project membership, storage containment, deletion quarantine and failed-output cleanup
- frontend state migrated away from raw server filesystem locators for occurrence workflows

### Verification

- complete Node gate passed: shared build; API/frontend typecheck, lint, tests and production builds
- API: 34 files / 347 tests passed after final lifecycle/accounting repair
- frontend: 27 files / 209 tests passed
- shared contracts: 152 tests passed
- focused canonical occurrence/asset regressions: 36 tests passed
- PostgreSQL 17: migrations 0038 and 0039 applied successfully and 0039 replayed idempotently
- diff hygiene and production raw-path exposure scans passed
- lint exits successfully with pre-existing warning debt
- full locked R verification remains unavailable because the local `renv` library is missing required packages; focused R security and release gates are recorded separately and this limitation is not represented as a passing full-suite result

### Collaboration and integration

The live branch inventory has been reconciled: PR #94's final `dev` tree is identical to current `main`, while the remote `dev` ref no longer exists. Publish this recovery branch in isolation first. Recreating `dev` at the reviewed `main` SHA and proposing recovery into it are later explicit remote operations. Do not reset, overwrite, force-push or delete contributor branches. `main` remains a later stable-release destination.

### Still open after this checkpoint

- canonicalize remaining boundary, mask, target-group and climate-directory inputs
- add durable standalone execution ownership and finish restart/event authorization
- repair and verify remaining scientific correctness findings beyond AUC and MESS
- implement immutable provenance and tamper-evident run identity
- finish lifecycle, retention, scale and operational acceptance
- restore the locked R environment and run the complete R suite

## First remote-candidate checkpoint — 2026-09-16

The exact implementation tip before this documentation update is `cc65d5dd9eda2ee7c04ad97488ea62e3866b18bf`, fifteen commits ahead of reviewed `main`. It adds the protected-current-principal seam plus independently reviewed fixed-direction AUC and reference-correct MESS/masking repairs. The separate execution/attempt schema proposal is intentionally excluded after independent review found integrity and migration-contract defects.

### Added since the initial checkpoint

- canonical occurrence assets are resolved again immediately before synchronous, queued, targets, batch and retry execution
- protected TypeScript-to-Plumber calls require immutable current principals and roles
- direct R status/cancel/delete authorization fails closed before side effects, including for administrators with malformed or ownerless resources
- niche-overlap authorizes both source runs
- AUC remains directional across metrics, ENMeval and two- and multi-component ensemble weighting
- MESS uses empirical percentile ranks with negative lower and upper tails, consistent transformed units, VIF-retained predictor names, distinct multi-scenario exports and actual suitability/delta masking

### Candidate evidence

- full Node gate passes after an offline frozen dependency install: shared build, API/frontend typecheck, lint, 368 API tests, 209 frontend tests and both production builds
- compose matrix, CUDA/ROCm accelerator contracts, Python release audit and R release audit pass
- fast R smoke passes
- integrated changed-path science tests pass: binary metrics, ENMeval ranking, ensemble contract and 33 MESS assertions; optional-package cases remain skipped explicitly
- focused Plumber principal and destructive-authorization contract passes 24 assertions
- full local R suite was attempted and is blocked by absent locked dependencies, beginning with `data.table`; this is an environment gate, not a passing result

No remote write, PR, release, tag, branch deletion or settings change is part of this checkpoint.

## Promotion and branch reconciliation — 2026-09-17

The reviewed recovery line through `f05af652b640ec5f0f45b1034e2a9557f29cf929` was promoted to remote `dev` through candidate `b025dea8c779c9ddc23ee7c324bc51cb60a1517f`. That candidate also applies the isolated three-file documentation/workspace patch from `b959faa858480920fbaf5d3f01e83f94d8e3e325` without importing its stale branch history, and corrects the R execution-security test to resolve the repository through canonical `project_root`.

After the promoted `dev` ref was read back successfully, all superseded remote branches were removed. The remaining remote heads are `main` at `b39f3a4ef88c7551df29f1f7b3e93d4b32034cec` and `dev` containing `b025dea8c779c9ddc23ee7c324bc51cb60a1517f` plus this status update; release tags were retained.

R parse, fast smoke, release audit, Compose validation, and accelerator-contract gates passed for the promoted tree. The full locked R suite remains blocked by missing local dependencies, and the Node aggregate reached the frontend production build before external Google Fonts retrieval failed. Live migration/runtime-auth evidence remains open and is not claimed by this reconciliation.

## Canonical boundary and target-group checkpoint — 2026-09-18

The local recovery line adds custom-boundary canonicalization at `d2aa73b795ff2463570360186278ee921e41c997`, target-group canonicalization at `526f18acce5c2a6041fa419c38f6f0369f77d867`, and reviewed lifecycle repairs at `67b989561afc45563aabc3a0a4b723cc260a924a`.

The target-group repair makes runtime slot resolution fail closed, requires one shared target-group input for multispecies Targets execution, normalizes camel-case coordinate headers correctly, stages uploads safely, and quarantines before deletion. Physical deletion is idempotent and anchored to an opened Linux directory file descriptor so configured-root replacement cannot redirect it. Failed quarantine or cleanup remains visible without exposing server paths.

Current evidence:

- full Node gate passed: 432 API tests, 209 frontend tests, typechecks, lint, shared/API builds and the frontend production build;
- 57 focused API lifecycle, storage-race and compatibility tests passed;
- 50 focused R execution-security assertions passed under real `testthat` in Docker;
- 246 R files parsed, fast smoke passed, and R/Python release audits passed;
- the production/development/CUDA/ROCm Compose matrix passed;
- diff hygiene, file-type inspection and private-key/token signature scans passed.

No live PostgreSQL/Plumber integration or complete lockfile-backed R suite is claimed. No remote branch, tag, pull request, release or deployment was changed by this local checkpoint.
