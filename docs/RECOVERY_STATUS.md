# Recovery status and direction

> **Dated history.** This file records recovery checkpoints and is not the current project-status authority. See [STATUS.md](STATUS.md), [ROADMAP.md](ROADMAP.md), and [REVIEW_LEDGER.md](REVIEW_LEDGER.md) for current truth. Add future recovery events here only as dated historical entries, not as replacements for those documents.

_Last updated: 2026-09-20_

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
   - Protected Hono-to-Plumber calls carry immutable current-principal clients; model execution additionally requires a short-lived HMAC attestation over the exact server-resolved payload.
   - Boundary/mask, target-group and current/future climate collections now use opaque asset IDs and are re-resolved immediately before dispatch.

## Security policy being implemented

- Uploads are creator-private until explicitly shared with a project.
- Project viewers may read enumerated safe outputs; editors may create and use project inputs; project admins manage project resources.
- Removed members immediately lose project input, result, retry, and event access.
- Ownerless, corrupt, ambiguous, or tampered legacy resources fail closed.
- Server-owned provider credentials never belong in run requests or reproducibility artifacts.
- Administrator access remains audited and never bypasses validation, path safety, or secret filtering.

## Current milestone

**Milestone 2: security boundaries** remains active. The next coherent slices are:

1. Add durable execution ownership for standalone runs and targets so restart reconciliation never invents creator authority.
2. Revalidate current account/project authority for open SSE and WebSocket delivery.
3. Run the auth-enabled two-user, project-member, revoked-member, administrator, API-key, direct-Plumber and failure-path acceptance matrix in the built stack.
4. Verify climate shared-member reclamation before allowing physical deletion.
5. Preserve unavailable monitoring as unavailable until an explicitly authorized service-metrics path exists.

This branch is intentionally not presented as a finished security milestone yet. The reviewed local candidate also carries the isolated Plumber workaround documentation and a full-suite path correction; these do not close the remaining security or environment gates.

## Later milestones

- **Scientific correctness:** fixed-direction AUC, ENMeval/ensemble ranking and empirical-percentile MESS with exported masking are repaired; fold-local VIF, remaining ensemble semantics and broader known-answer/image gates remain.
- **Immutable provenance:** sealed effective configuration, canonical input and artifact hashes, runtime/package/code identity, metric semantics version, and honest reproducibility claims.
- **Lifecycle and scale:** packaged Targets execution, idempotent submission, restart reconciliation, truthful cancellation, and explicit single-replica limits until ownership is safe.
- **Interface acceptance:** narrow visual and human-flow testing after the underlying contracts are stable.

## Known limitations at this checkpoint

- Physical reclamation of files referenced by system climate collections remains disabled; administrator deletion is a soft asset lifecycle transition.
- Standalone run and standalone Targets restart reconciliation is deliberately blocked until durable execution ownership exists.
- Existing path-based historical records are not automatically trusted or reassigned.
- The lockfile-backed full R suite is not available locally because required packages such as `data.table`, ENMeval and torch are absent. Fast smoke, focused changed-path tests and release audit pass; the attempted broad system-library suite fails on missing dependencies and is not represented as green.
- The remote tag, branch workflow, protection settings, stale branch cleanup and recreation of `dev` are deliberately unchanged pending explicit remote-operation approval.

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
