## Summary

What user, scientific, security, or maintenance outcome does this PR deliver?

## Scope and non-goals

Changed surfaces:
-

Explicitly out of scope:
-

## Contract and risk review

- [ ] Current principal and action scope are checked at every protected boundary.
- [ ] Inputs use canonical opaque asset IDs; no client path is authoritative.
- [ ] Denied, missing, foreign, corrupt, deleted, revoked, and concurrent cases are covered where relevant.
- [ ] Secrets are rejected, allowlisted, or server-owned and do not enter persisted/exported surfaces.
- [ ] Scientific direction, units, folds, masks, labels, and warnings match actual behavior.
- [ ] Mutating operations have durable idempotency/execution semantics, or this PR documents why they are out of scope.
- [ ] Migrations are additive, replay-safe, and tested for fresh/upgrade paths.

## Evidence

Exact commit or SHA reviewed:

Focused checks:
-

Full gates:
- [ ] pnpm run check:node
- [ ] pnpm run check:compose
- [ ] Complete lockfile-backed R suite
- [ ] Rscript scripts/smoke_test.R
- [ ] Rscript scripts/audit_release.R
- [ ] pnpm run check:accelerators when affected
- [ ] git diff --check

Record blocked, skipped, or environment-dependent gates explicitly. A focused pass is not a full-gate pass.

## User-visible and scientific behavior

Describe changed behavior, output/report implications, and honest limitations.

## Compatibility, rollback, and follow-up

Migration, queue, API, or artifact compatibility:
-

Rollback or restoration path:
-

Next acceptance gate or follow-up PR:
-

## Privacy and artifacts

- [ ] No private workspace paths, credentials, real occurrence data, generated outputs, logs, screenshots, or local environment files are included.
- [ ] Synthetic or redistributable fixtures are used where examples are needed.
