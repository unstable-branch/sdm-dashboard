# API Auth Policy Inventory

## Purpose
This inventory captures current Hono API authentication, authorization, API-key,
CSRF, rate-limit, and route exposure behavior for machine-facing API work. It is
descriptive first: the scoped-key policy below is intended v1 direction, not
current enforcement.

Primary sources:
- `api/src/index.ts`
- `api/src/middleware/auth.ts`
- `api/src/middleware/csrf.ts`
- `api/src/middleware/rate-limit.ts`
- `api/src/routes/auth.ts`
- `api/src/routes/projects.ts`
- `api/src/routes/sdm.ts`
- `api/src/routes/occurrences.ts`
- `api/src/routes/climate.ts`
- `api/src/routes/ecology.ts`
- `api/src/routes/diagnostics.ts`
- `api/src/routes/results.ts`
- `api/src/routes/jobs.ts`
- `api/src/db/schema.ts`
- `api/src/openapi.ts`

## Current Auth Mechanisms

### Client authentication
- Required-auth routes use `authMiddleware`.
- `authMiddleware` accepts either:
  - `X-API-Key`, hashed with SHA-256 and matched against `api_keys.key_hash`.
  - `Authorization: Bearer <jwt>` signed with `JWT_SECRET`.
  - `sdm_token` cookie as a bearer-token fallback.
- API keys take precedence over bearer/cookie auth when both are present.
- API keys are user-bound only. The current `api_keys` table stores key hash,
  name, user ID, timestamps, last-used timestamp, and optional expiry. It does
  not store scopes, quotas, project restrictions, allowed origins/IPs, or
  revocation metadata beyond deletion/rotation.
- API-key use updates `last_used_at` after a user lookup succeeds.
- Expired or unknown API keys return 401. Auth-service failures return 503.
- JWT auth trusts payload `sub`, `email`, and `role` after signature
  verification. User existence is not reloaded in the middleware itself.

### Optional authentication
- Optional-auth routes use `optionalAuth`.
- Valid bearer/API-key credentials attach `user`; invalid or absent credentials
  are silently ignored and the route continues as anonymous.
- Optional auth therefore must not be treated as access control.

### Role and project authorization
- `requireRole()` exists but is not part of the focused route groups today.
- Project membership checks are implemented inside route handlers and helpers,
  not through a single route-policy layer.
- Admin users bypass `getUserProjectIds()` project filtering by returning
  `null`; non-admin users are constrained to project memberships.
- Several read surfaces perform run/project checks before returning results,
  but other route groups proxy by run ID without project checks.

### CSRF behavior
- Global CSRF middleware is applied to `/api/v1/sdm/*`, `/api/v1/data/*`,
  `/api/v1/climate/*`, `/api/v1/ecology/*`, and `/api/v1/projects/*`.
- Safe methods (`GET`, `HEAD`, `OPTIONS`) bypass CSRF.
- `X-API-Key` bypasses CSRF, which is appropriate for machine clients.
- `X-Requested-With` also bypasses the origin/referer checks and supplies the
  token-equivalent signal.
- `/api/v1/results/*`, `/api/v1/diagnostics/*`, `/api/v1/jobs/*`, and
  `/api/v1/auth/*` are not covered by the global CSRF middleware in `index.ts`.

### Rate limits and quotas
- Route-level rate-limit middleware uses Redis sorted sets when Redis is
  available, but fails open when Redis is unavailable.
- Current rate-limit keys are based on URL and prefix, not authenticated user,
  API key, IP, project, route class, or organization.
- Current route limits:
  - Auth register: 5/minute.
  - Auth login: 10/minute.
  - API key create/rotate: 5/minute.
  - SDM run/batch: 5/minute.
  - Climate routes: 60/minute.
  - Data routes: 60/minute, with GBIF search additionally 10/minute.
  - Diagnostics routes: 60/minute.
  - API-key authentication failures: 20/minute by forwarded IP or real IP.
- There is no current quota ledger, per-key concurrency policy, per-project
  allowance, or durable usage/audit event table.

### Service-to-service auth
- Public client auth is bearer JWT or `X-API-Key`.
- `X-Hono-Internal` is reserved for Hono-to-Plumber calls and should not become
  a public client credential.

## Intended v1 Policy

The intended v1 policy is:
- Public system/auth bootstrap routes remain public where noted.
- Machine clients authenticate with `X-API-Key`; browser/human clients may use
  bearer JWT/cookie flows.
- API-key scopes are future enforcement work. The planned scope names are:
  `read`, `write`, `run`, `batch`, and `admin`.
- Until scoped keys are implemented, docs and OpenAPI should describe current
  bearer/API-key authentication only and avoid claiming scope enforcement.
- Project membership remains the base object-access boundary for user data,
  runs, results, projects, and datasets.
- Expensive or mutating workflows should combine auth, route class limits,
  idempotency where supported, quota checks, and audit events.

Proposed scope meaning:

| Scope | Intended meaning | Current state |
| --- | --- | --- |
| `read` | Read project-scoped metadata, datasets, runs, results, diagnostics, ecology summaries, climate catalogs/status, and job status visible to the owner. | Not stored or enforced. |
| `write` | Create/update project metadata and upload/register/clean occurrence data. | Not stored or enforced. |
| `run` | Start, cancel, and manage single expensive workflows such as SDM runs and climate downloads/deletes. | Not stored or enforced. |
| `batch` | Start, inspect, compare, and cancel multi-run batch workflows. | Not stored or enforced. |
| `admin` | Manage API keys, project members, administrative project actions, future quota overrides, and audit access. | Not stored or enforced. |

## Route Policy Matrix

| Route group | Current auth/security behavior | Intended v1 policy | Current gap |
| --- | --- | --- | --- |
| `/health`, `/ready` | Public. `/ready` checks Plumber, DB, and storage and may return 503. | Public liveness/readiness; no user data. | None for auth; avoid leaking sensitive config in future checks. |
| `/api/v1/openapi.json` | Public. | Public contract document; mark current auth truthfully. | OpenAPI is partial and does not express future scopes. |
| `/api/v1/auth/register`, `/login` | Public, rate-limited. Returns JWT. | Public bootstrap, rate-limited. | No refresh-token contract; rate limit is route URL keyed, not per account/IP except API-key failure helper. |
| `/api/v1/auth/me` | Required bearer/API-key auth. | `read` for self profile. | No scoped-key distinction. |
| `/api/v1/auth/api-keys*` | Required bearer/API-key auth. Create/rotate are rate-limited. Keys can create/rotate/delete other keys for the same user. | `admin` only; consider requiring bearer/session auth for key creation and rotation. | Current API keys have no scopes and can manage peer keys for their user. No audit event. |
| `/api/v1/projects` | Required bearer/API-key auth. Per-route membership/admin checks for reads/mutations. `GET /:id/members` currently lists members by project ID without checking caller membership in that handler. | `read` for list/get/member reads; `write` or `admin` for project edits; `admin` for member changes. | Inconsistent member-read guard; no scoped keys; no audit for membership changes. |
| `/api/v1/sdm/models`, `/config/defaults`, `/future/scenarios` | Optional auth after protected route registrations; no required auth. CSRF is safe-method bypass. | Public or `read`; choose explicitly before v1. | Current optional auth allows anonymous catalog/default reads. |
| `/api/v1/sdm/run` | Required auth plus model rate limit. Supports `Idempotency-Key`. CSRF applies to non-API-key browser-style POSTs. | `run`; quota/concurrency/audit required. | No scope/quota/concurrency/audit; idempotency cannot prevent all partial downstream side effects. |
| `/api/v1/sdm/batch` | Required auth plus model rate limit. Supports `Idempotency-Key`. Creates child runs with a shared `batch_id`. | `batch`; quota/concurrency/audit required. | No batch parent resource policy; no scoped key; partial-failure hardening still needed. |
| `/api/v1/sdm/runs`, `/status/:jobId`, `/batches/:batchId` | Required auth. Uses project membership filtering for run/batch visibility. | `read`. | Identifier vocabulary still mixed (`jobId` path often means run ID). |
| `/api/v1/sdm/cancel/:jobId`, `/cancel-all`, `/runs/delete/:runId`, `/runs/clear-all` | Required auth with project filtering. Mutating/destructive actions. | `run` for cancel; `admin` or explicit destructive scope for delete/clear-all. | No scoped key; no audit; `cancel-all` and clear/delete need stronger safety contract before external machine use. |
| `/api/v1/data/*` | Required bearer/API-key auth plus default rate limit. Project scoping is route/helper based. CSRF applies to non-API-key unsafe methods. | `read` for dataset/species reads; `write` for upload/register/clean/GBIF save/DwCA; `run` optional if async clean is treated as compute. | No scoped key; quotas are not file-size/project/key aware; audit missing for uploads and derived datasets. |
| `/api/v1/climate/scenarios`, `/check`, `/status/:jobId` | Climate rate limit plus optional auth. `scenarios` cached. | `read`, or public for static catalogs if product policy chooses. | Current status can be queried anonymously by job ID. |
| `/api/v1/climate/download`, `/delete/:scenarioId` | Required auth plus climate rate limit. Download supports `Idempotency-Key`. | `run` for download; `admin` or `run` plus ownership checks for delete. | Climate delete proxies by scenario ID without project/user ownership semantics. No scoped key/quota/audit. |
| `/api/v1/ecology/*` | No auth middleware in the router. CSRF applies, but all current routes are GET and bypass CSRF. Proxies to Plumber by run ID. | `read` with run/project visibility checks. | Currently globally readable by run ID at the Hono layer. |
| `/api/v1/diagnostics/*` | Default rate limit plus optional auth. Proxies to Plumber by run ID. No CSRF registration, all current routes are GET. | `read` with run/project visibility checks. | Currently anonymously readable by run ID. |
| `/api/v1/results/*` | Required auth for all routes, with run/project checks and path confinement for file reads. | `read`; potentially separate artifact-download allowance if large downloads need quota. | Good baseline, but manifests/logs/errors still need redaction rules and audit for downloads. |
| `/api/v1/jobs/sse`, `/api/v1/jobs/:jobId`, `/api/v1/jobs/:jobId/cancel` | No auth middleware in the router. No CSRF registration. `POST /:jobId/cancel` can remove queued/active jobs by queue job ID. | `read` for status/SSE with owner filtering; `run` for cancel; maybe `batch` for batch jobs. | Highest-priority gap: global queue visibility and cancellation by job ID. |

## Machine-Facing Risk Notes

- Current API keys are bearer-equivalent user credentials, not scoped machine
  tokens.
- Optional-auth route groups should be assumed public unless handlers add their
  own checks.
- Run ID, queue job ID, Plumber job ID, and batch ID are not a complete access
  policy. Any route that accepts one of these IDs still needs user/project
  authorization.
- Route-level rate limiting is not quota enforcement. It is Redis-dependent,
  fail-open, and currently URL keyed.
- Cancellation and deletion routes need audit events before being exposed to
  unattended agents.
- Results file path confinement is strong relative to `outputs/jobs`, but
  artifact download policy still needs per-run authorization, redaction, and
  quota rules as manifests become richer.

## Next Tickets

1. Add `scopes text[]`, optional `project_id`, `revoked_at`, and
   `created_by_key_id` or equivalent metadata to `api_keys`.
2. Add a central `requireScope()` or route-policy middleware that combines
   authentication, required scope, and project/run ownership checks.
3. Lock down `/api/v1/jobs/*`, `/api/v1/ecology/*`, and
   `/api/v1/diagnostics/*` behind `read`/`run` checks before treating them as
   machine-safe.
4. Add per-key quota/concurrency counters for `run` and `batch` operations,
   with Redis acceleration and DB-backed audit truth.
5. Add an `api_audit_events` table for key creation/rotation/deletion,
   workflow starts, cancellations, destructive clears/deletes, downloads, and
   auth failures.
6. Add tests proving scoped keys cannot use routes outside their scope and that
   anonymous requests cannot read diagnostics/ecology/jobs by guessed IDs.
7. Update OpenAPI security metadata after scopes exist; until then, keep it to
   bearer/API-key schemes without false scope claims.
