# Roadmap

This roadmap is dependency-ordered. Each stage requires evidence on one exact candidate SHA; implemented is not the same as accepted.

## 1. Stabilize the baseline

- Land the independent R test/root and helper-loading repair as a separately reviewed change.
- Run focused R files, parse checks, smoke, Node, Compose, release, accelerator, and complete locked-R gates.
- Refresh status with exact results and retain failures and skips.

**Exit:** no required gate is red or missing, documentation matches the candidate, and the main-seat diff review is complete.

## 2. Complete security boundaries

- Canonicalize boundary, mask, target-group, current-climate, future-scenario, and Targets/batch inputs.
- Enforce current principal, project action scope, lifecycle, and containment at Hono, queue worker, and direct Plumber boundaries.
- Repair remaining failed/ownerless metadata handling and role propagation without permissive fallbacks.
- Recheck SSE/WebSocket authentication, replay, reconnect, revocation, and project-removal delivery.
- Exercise owner, viewer, editor, project admin, system admin, removed member, deleted user, scoped/underscoped key, direct-Plumber, corrupt-resource, DB-outage, and concurrent-request cases.

**Exit:** denied cases cause zero input reads, worker spawns, private event delivery, or destructive side effects.

## 3. Prove the primary workflow

Use only synthetic redistributable data. In an auth-enabled built stack, prove register/sign-in, project creation, upload, validation/cleaning, canonical selection, small CPU submission, truthful progress, refresh/reconnect, diagnostics/results, download and immutable provenance. Include failure, cancellation, retry, deletion, revocation, and restart.

**Exit:** a clean clone can complete the documented workflow without undocumented local knowledge, and unavailable capabilities are explained rather than shown as empty success.

## 4. Scientific validity and provenance

- Add reference-oracle tests for AUC direction and ties/NA/constants.
- Validate MESS definition, both tails, units/transforms, predictors, missing values, and actual suitability/delta masking.
- Move VIF selection into the actual fold-local fit contract and evaluate aligned ensemble out-of-fold predictions.
- Seal one worker-authored manifest containing effective configuration, asset/artifact hashes, seed/folds/thresholds, metric semantics, code/image/package/backend identity, source/licensing, execution identity, and warnings.
- Make script export parse/replay a tiny offline run and verify same-size cache tampering by content hash.

**Exit:** known-answer CPU results and byte-stable provenance remain coherent after restart, source change, and mutable-path replacement.

## 5. Durable lifecycle and Targets

Design and independently review the run/execution/attempt contract before migrations. Reserve ownership before dispatch; reconnect accepted/lost responses; append attempts on authorized retries; preserve terminal evidence; and map direct Targets jobs durably. Package both Targets entrypoints in actual runtime images and test submit, poll, result, cancel, retry, and restart.

Keep a single compute replica until unique instance identity, owner routing, PID reuse safety, Redis reconnect, and shared admission limits pass. Treat old agentic and installer/lifecycle proposals as design evidence only; salvage tests and intent narrowly, never old path authority or migration numbering.

**Exit:** one idempotency key yields one logical execution and runtime behavior matches image claims.

## 6. UX and release polish

After contracts stabilize, improve denied/error states, long-running progress, responsive and keyboard/screen-reader fundamentals, and the upload-to-result journey. Keep labels honest and avoid a broad visual redesign before workflow acceptance.

Then reconcile README, SECURITY, CONTRIBUTING, version metadata, changelog, citation, image labels, release notes, source bundles, migration compatibility, restore procedure, and exact-SHA CI. Do not rewrite the existing public tag. Deployment and cleanup remain separately approved transitions.

**Exit:** repository, application, evidence, and release materials tell the same truthful story.
