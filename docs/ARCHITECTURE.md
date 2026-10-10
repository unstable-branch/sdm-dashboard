# Architecture and system contracts

_Last reviewed: 2026-09-20._

## Supported surfaces

The modern platform is the primary release direction. The legacy root app.R Shiny application remains a local, single-user workbench and has no modern multi-user authorization boundary. New platform features belong in the modern stack unless a change explicitly targets legacy behavior.

## Runtime topology

~~~mermaid
graph TD
  Browser[Next.js frontend] -->|authenticated HTTPS| Hono[Hono API / BFF]
  Hono --> DB[(PostgreSQL + PostGIS)]
  Hono --> Queue[Redis + BullMQ]
  Hono --> Store[Garage-compatible object storage]
  Hono -->|request-scoped current principal| Plumber[Plumber R API]
  Plumber --> R[R modelling, ecology, diagnostics, outputs]
  Hono --> UIEvents[SSE / WebSocket event delivery]
~~~

Hono is the application boundary. Plumber is a second computation boundary, not a trusted bypass. R modules are the scientific implementation and must receive server-resolved, containment-checked inputs.

## Request and authorization flow

1. Authentication resolves a current database principal and current role/session state.
2. The route checks project membership, resource ownership, lifecycle, and action scope.
3. Client input is parsed into an allowlisted safe configuration and opaque asset IDs.
4. Hono resolves canonical assets and creates any durable run/execution record required by the operation.
5. Protected calls use an immutable request-scoped principal and forward both user and role. Model execution also carries a short-lived HMAC attestation over the exact resolved payload, principal, timestamp, and one-time nonce using a key distinct from general Plumber authentication.
6. Plumber rejects missing or invalid internal identity. The model entrypoint additionally rejects direct API-key requests, stale or invalid attestations, and replayed nonces before parsing path-bearing execution configuration. Signatures are compared in constant time and nonces are atomically claimed on shared output storage.
7. Workers re-resolve authority and asset lifecycle immediately before reading or spawning.
8. Results and events are filtered by current authority before delivery.

Public discovery and health endpoints are intentionally separate from protected computation and private result paths. Public status must not become an accidental metadata disclosure.

## State and storage

PostgreSQL is authoritative for users, sessions, projects, membership, assets, occurrences, runs, and queue/lifecycle records. Redis is a transport and queue system, not the sole ownership registry. Object storage holds large artifacts; paths and URLs are locators, while opaque asset IDs, content identity, scope, and lifecycle state are the authorization model.

An asset has an opaque identity, kind, scope, creator/lineage, server-owned locator, lifecycle state, and verified content identity. New immutable inputs must have non-null content identity before sealed execution. Deletion quarantines or removes access; it does not silently reassign historical records.

Climate collections are immutable system-scoped assets backed by bounded manifests of member locators, sizes, and SHA-256 identities. System registration is limited to the WorldClim, CHELSA, and future-WorldClim roots, and all members must remain in the manifest's approved root. Hono resolves and revalidates the manifest and members before converting the collection to the internal R directory contract. Browser responses never expose manifest paths or source directories. Administrator deletion uses an opaque collection ID and marks the asset deleted; physical shared-file reclamation remains deferred until member reference accounting exists.

## Execution contract

The current model and Targets paths are useful execution surfaces but durable run/execution/attempt ownership is still a release prerequisite. The target contract is:

- Run: stable scientific result lineage and normalized specification.
- Execution: authorization and dispatch aggregate reserved before side effects.
- Attempt: append-only invocation identity; transport retries reuse it, authorized compute retries append one.
- Owner: durable dispatch instance and verified external job identity.

Status is a projection of this history. Unknown or accepted-but-unconfirmed is not permission to spawn again. Cancellation targets the exact owned process or routed owner, never a PID inferred from stale metadata.

## Scientific boundary

The R core in R/core/run_sdm.R orchestrates model, covariate, validation, projection, ecology, and output modules. Model definitions are registered under R/models/. Metrics and reports under R/output/ must preserve direction, units, fold semantics, warnings, and uncertainty labels. A provenance manifest should be finalized by the fitting worker and served byte-stably, rather than reconstructed from mutable runtime state.

## Legacy boundary

app.R and the modules loaded by R/load.R are retained for desktop continuity. They may use local files under the user's control and do not provide server authorization. Do not route modern protected data through legacy-only ownership assumptions.

## Known architectural limits

- Canonical model inputs now cover occurrence, boundary/mask, target-group, and current/future climate collections. Built-stack, direct-R, migration, and revocation acceptance remain required before release.
- Direct Targets packaging and durable execution mapping are not release-accepted.
- Multi-replica compute, PID-based cancellation, and event fan-out are not safe release claims.
- Immutable provenance, replayable script export, and cache content verification remain open gates.

See STATUS.md, ROADMAP.md, and REVIEW_LEDGER.md for current evidence and sequencing.
