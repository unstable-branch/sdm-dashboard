# Recovery status and direction

_Last updated: 2026-09-16_

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

4. **Canonical input-asset foundation**
   - Added an additive canonical asset registry with opaque IDs, immutable content identity, scope, kind, lifecycle state, and derivative lineage.
   - Added fail-closed storage containment, symlink/traversal protection, current project-membership checks, and quarantined legacy mappings.
   - This is foundation code only until the upload, cleaning, boundary, model, targets, and frontend routes are migrated to asset IDs.

## Security policy being implemented

- Uploads are creator-private until explicitly shared with a project.
- Project viewers may read enumerated safe outputs; editors may create and use project inputs; project admins manage project resources.
- Removed members immediately lose project input, result, retry, and event access.
- Ownerless, corrupt, ambiguous, or tampered legacy resources fail closed.
- Server-owned provider credentials never belong in run requests or reproducibility artifacts.
- Administrator access remains audited and never bypasses validation, path safety, or secret filtering.

## Current milestone

**Milestone 2: security boundaries** is active. The next coherent slices are:

1. Migrate upload, cleaning, boundary, model, targets, batch, and saved frontend state from client-supplied paths to canonical asset IDs.
2. Add durable execution ownership and action-specific run authorization.
3. Bind every protected Hono-to-Plumber call to the verified principal and remove bare protected clients.
4. Revalidate current account/project authority for open SSE and WebSocket delivery.
5. Run the two-user, project-member, revoked-member, administrator, API-key, direct-Plumber, and failure-path acceptance matrix.

This branch is intentionally not presented as a finished security milestone yet. The completed commits are independently tested foundations for the remaining cutover.

## Later milestones

- **Scientific correctness:** directional AUC and downstream rankings, honest ensemble metrics, MESS scaling/masking, VIF methodology, and known-answer tests.
- **Immutable provenance:** sealed effective configuration, canonical input and artifact hashes, runtime/package/code identity, metric semantics version, and honest reproducibility claims.
- **Lifecycle and scale:** packaged Targets execution, idempotent submission, restart reconciliation, truthful cancellation, and explicit single-replica limits until ownership is safe.
- **Interface acceptance:** narrow visual and human-flow testing after the underlying contracts are stable.

## Known limitations at this checkpoint

- Canonical assets are not yet wired into public submission routes.
- Existing path-based historical records are not automatically trusted or reassigned.
- The monolithic local R test environment is not restored in this worktree; focused R tests, fast smoke, and release audit pass, while the lockfile-backed full suite still needs a complete CI-equivalent environment.
- The remote tag, branch workflow, protection settings, and stale branch cleanup are deliberately unchanged pending an explicit reviewed remote-operation plan.

## Review guidance

Review the commits in order. Each commit is intended to establish one contract and remain understandable independently. Please treat missing integration as an open slice rather than filling it with a permissive compatibility fallback. In particular, do not restore client-controlled paths, stale JWT authority, raw credential fields, ownerless legacy access, or unaudited administrator bypasses.
