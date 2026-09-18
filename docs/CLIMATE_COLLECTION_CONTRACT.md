# Canonical climate collection contract

_Status: approved design constraints; implementation pending migration-metadata reconciliation_

This contract replaces mutable climate-directory authority in the modern platform. It applies to current climate, future scenarios, derived multi-GCM products, synchronous and queued runs, retries, batch execution, Targets, and direct Plumber access.

## Decisions

- Only system services and authenticated administrators may stage and publish climate collections in this release candidate. Ordinary users may select ready collections but may not import or mutate them.
- Raster bytes referenced by a run are retained. A collection may be quarantined from new use, but physical deletion is blocked while any run binding references it.
- Multi-GCM averaging is never performed implicitly during model execution. An average is a separately published derived collection with its own byte identity and a versioned derivation manifest.
- Current and future inputs must have exactly compatible grids and variable semantics at execution. Any reprojection, resampling, aggregation, unit conversion, or nodata transformation produces a new derived collection.

## Authority boundaries

`climate_collections` is the sole authority for whether climate input is selectable or executable. Canonical byte assets are subordinate member storage; a cache manifest, directory name, filename match, request path, or historical run config can never establish collection readiness.

Client requests and persisted run configuration contain opaque collection IDs only. Server filesystem paths may appear only in a short-lived internal dispatch envelope after current authority and content identity have been revalidated.

Direct Plumber requests must reject climate directory fields and unresolved collection IDs. Only an authenticated Hono internal dispatch may carry resolved member paths, the sealed manifest identity, and the expected execution protocol version.

## Collection identity

A collection has an opaque ID and an immutable manifest identity derived from both exact bytes and scientific metadata. The manifest contains:

- collection kind: current baseline, single-GCM future scenario, or derived future scenario;
- provider, dataset, dataset version, licence and attribution;
- source URLs or other server-controlled acquisition evidence;
- ordered members with canonical variable keys and ordinals;
- each member's byte size, SHA-256, storage identity, lifecycle state and media kind;
- units, datatype, scale/offset and nodata semantics for every variable;
- CRS and an exact grid fingerprint covering extent, resolution, dimensions, origin and pixel alignment;
- temporal baseline or future period, SSP, GCM, and scenario labels where applicable;
- for derived collections, ordered parent collection IDs, algorithm ID/version, parameters, missing-cell policy and derivation software identity;
- manifest schema version and manifest SHA-256.

BIO variables use stable semantic keys (`bio01` through `bio19`), independent of provider filenames. CHELSA extras and future non-BIO variables require catalogued semantic keys and explicit ordinals; filesystem enumeration order is never scientific identity.

Two collections with identical scenario labels but different bytes or scientific metadata are distinct. Replacing a member creates a new collection identity; ready collections are not edited in place.

## Lifecycle

1. **Staging:** download or import into a non-ready namespace. Staging content is not selectable.
2. **Validation:** hash every member and validate GeoTIFF structure, variable completeness, metadata, grid consistency, provider/licence fields and derivation evidence.
3. **Publication:** transactionally seal the ordered manifest and make the complete collection ready. Partial collections cannot become ready.
4. **Binding:** insert the run and its climate bindings in the same transaction. Bindings record role, collection ID, manifest hash/version, ordered variables, baseline/scenario identity and execution protocol.
5. **Dispatch:** immediately before use, recheck current collection/member lifecycle, authorization, containment and every member SHA-256. Same-size tampering fails closed.
6. **Quarantine:** prevent new bindings while preserving existing run evidence. Existing queued work must revalidate and fail if policy no longer permits execution.
7. **Deletion:** deny physical deletion while referenced. Unreferenced deletion quarantines first, removes only server-owned verified storage, and finalizes lifecycle state after successful removal.

A cache manifest may accelerate discovery or download checks, but it cannot publish a collection, replace a sealed manifest, or satisfy dispatch-time hash verification.

## Scientific compatibility

The execution binding seals the selected current baseline, future scenario, variables and ordering. Current/future projection is permitted only when the collections have:

- identical grid fingerprints;
- the same ordered required variable keys;
- compatible units, scale/offset and nodata semantics;
- an explicit baseline relationship for delta, MESS and other comparison outputs.

Runtime resampling or silent CHELSA aggregation is forbidden. Such transformations must be published as derived collections with their methods recorded. A derived multi-GCM collection must name its ordered parents and versioned averaging and missing-cell policies; no default averaging behavior is inferred from existing R code.

## Protocol and mixed versions

Canonical jobs use an explicit execution protocol and climate input mode. New API code must not send ID-only jobs to workers that do not advertise support. Workers must reject unsupported protocol versions before applying any climate-directory defaults.

The compatibility matrix must cover old API to new worker, new API to old worker, queue replay, retry, batch, Targets and process restart. No combination may silently fall back to `Worldclim`, `chelsa`, `Worldclim_future`, or another ambient directory.

Historical path-only runs remain unverified and cannot be retried through canonical execution. They are not automatically imported, assigned to a user, or converted into collections.

## Required acceptance evidence

- Clean migration and production-shaped upgrade, replay, rollback and partial-failure tests.
- Database rejection of null member hashes, duplicate ordinals, incomplete ready collections, member lifecycle invalidation and deletion of referenced bytes.
- Concurrent staging, publication, quarantine and deletion tests that never expose a partial ready collection.
- Sync, queued, retry, batch and Targets tests preserving the same sealed run binding.
- Dispatch-time detection of same-size member tampering.
- Auth-enabled tests proving ordinary users cannot publish or mutate global climate data.
- Direct Plumber rejection of climate paths and unresolved IDs.
- Known-answer grid, variable-order, baseline and derived-collection tests.
- Full Node, Compose and applicable R parse, smoke, test and release gates.

## Implementation gate

Do not add climate migrations until the Drizzle journal, snapshots, SQL migrations, TypeScript schema and a disposable PostgreSQL database agree. Migration reconciliation must preserve applied history; it must not rewrite or blindly regenerate existing production migrations.
