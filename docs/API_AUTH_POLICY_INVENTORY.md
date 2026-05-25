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
- API keys are user-bound credentials with key hash, name, user ID, scopes,
  optional project ID, optional revocation timestamp, creator-key metadata,
  timestamps, last-used timestamp, and optional expiry.
- API-key scopes currently exist for lifecycle-route enforcement only. Broader
  route groups still treat API keys as bearer-equivalent unless a route-specific
  check has been added.
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
- There is no current quota ledger, per-key concurrency policy, or per-project
  allowance.
- `api_audit_events` exists for API-key lifecycle and scope-denial events first;
  broader workflow/download/cancellation audit coverage is still future work.

### Service-to-service auth
- Public client auth is bearer JWT or `X-API-Key`.
- `X-Hono-Internal` is reserved for Hono-to-Plumber calls and should not become
  a public client credential.

## Intended v1 Policy

The intended v1 policy is:
- Public system/auth bootstrap routes remain public where noted.
- Machine clients authenticate with `X-API-Key`; browser/human clients may use
  bearer JWT/cookie flows.
- API-key scopes exist with names `read`, `write`, `run`, `batch`, and `admin`.
  Enforcement is deliberately narrow in the first slice: `/api/v1/auth/api-keys*`
  only.
- Until route-group scope checks are implemented, docs and OpenAPI should avoid
  claiming broad scope enforcement beyond API-key lifecycle routes.
- Project membership remains the base object-access boundary for user data,
  runs, results, projects, and datasets.
- Expensive or mutating workflows should combine auth, route class limits,
  idempotency where supported, quota checks, and audit events.

Proposed scope meaning:

| Scope | Intended meaning | Current state |
| --- | --- | --- |
| `read` | Read project-scoped metadata, datasets, runs, results, diagnostics, ecology summaries, climate catalogs/status, and job status visible to the owner. | Stored; enforced for API-key listing only. |
| `write` | Create/update project metadata and upload/register/clean occurrence data. | Stored; not broadly enforced yet. |
| `run` | Start, cancel, and manage single expensive workflows such as SDM runs and climate downloads/deletes. | Stored; not broadly enforced yet. |
| `batch` | Start, inspect, compare, and cancel multi-run batch workflows. | Stored; not broadly enforced yet. |
| `admin` | Manage API keys, project members, administrative project actions, future quota overrides, and audit access. | Stored; enforced for API-key create/delete/rotate. |

## Route Policy Matrix

| Route group | Current auth/security behavior | Intended v1 policy | Current gap |
| --- | --- | --- | --- |
| `/health`, `/ready` | Public. `/ready` checks Plumber, DB, and storage and may return 503. | Public liveness/readiness; no user data. | None for auth; avoid leaking sensitive config in future checks. |
| `/api/v1/openapi.json` | Public. | Public contract document; mark current auth truthfully. | OpenAPI is partial and does not express future scopes. |
| `/api/v1/auth/register`, `/login` | Public, rate-limited. Returns JWT. | Public bootstrap, rate-limited. | No refresh-token contract; rate limit is route URL keyed, not per account/IP except API-key failure helper. |
| `/api/v1/auth/me` | Required bearer/API-key auth. | `read` for self profile. | No scoped-key distinction yet. |
| `/api/v1/auth/api-keys*` | Required bearer/API-key auth. Create/rotate are rate-limited. JWT callers retain existing UI behavior. API-key callers need `read` for list and `admin` for create/delete/rotate. Create accepts optional `scopes` and `projectId`; omitted scopes default to legacy broad scopes for compatibility. Best-effort audit events are written for create/delete/rotate and scope denial. | `read` for list; `admin` for create/delete/rotate. | Scoped enforcement is limited to this route family; no API-key lifecycle UI for revocation/project restriction yet. |
| `/api/v1/projects` | Required bearer/API-key auth. Per-route membership/admin checks for reads/mutations. `GET /:id/members` currently lists members by project ID without checking caller membership in that handler. | `read` for list/get/member reads; `write` or `admin` for project edits; `admin` for member changes. | Inconsistent member-read guard; no scoped keys; no audit for membership changes. |
| `/api/v1/sdm/models`, `/config/defaults`, `/future/scenarios` | Optional auth after protected route registrations; no required auth. CSRF is safe-method bypass. | Public or `read`; choose explicitly before v1. | Current optional auth allows anonymous catalog/default reads. |
| `/api/v1/sdm/run` | Required auth plus model rate limit. Supports `Idempotency-Key`. CSRF applies to non-API-key browser-style POSTs. | `run`; quota/concurrency/audit required. | No scope/quota/concurrency/audit; idempotency cannot prevent all partial downstream side effects. |
| `/api/v1/sdm/batch` | Required auth plus model rate limit. Supports `Idempotency-Key`. Creates child runs with a shared `batch_id`. | `batch`; quota/concurrency/audit required. | No batch parent resource policy; no scoped key; partial-failure hardening still needed. |
| `/api/v1/sdm/runs`, `/status/:jobId`, `/batches/:batchId` | Required auth. Uses project membership filtering for run/batch visibility. | `read`. | Identifier vocabulary still mixed (`jobId` path often means run ID). |
| `/api/v1/sdm/cancel/:jobId`, `/cancel-all`, `/runs/delete/:runId`, `/runs/clear-all` | Required auth with project filtering. Mutating/destructive actions. | `run` for cancel; `admin` or explicit destructive scope for delete/clear-all. | No scoped key; no audit; `cancel-all` and clear/delete need stronger safety contract before external machine use. |
| `/api/v1/data/*` | Required bearer/API-key auth plus default rate limit. Project scoping is route/helper based. CSRF applies to non-API-key unsafe methods. | `read` for dataset/species reads; `write` for upload/register/clean/GBIF save/DwCA; `run` optional if async clean is treated as compute. | No scoped key; quotas are not file-size/project/key aware; audit missing for uploads and derived datasets. |
| `/api/v1/climate/scenarios`, `/check` | Climate rate limit plus optional auth. `scenarios` cached. | `read`, or public for static catalogs if product policy chooses. | Public catalog/check responses remain available by design; no scoped-key distinction yet. |
| `/api/v1/climate/status/:jobId` | Required auth plus climate rate limit. Status proxies to Plumber by climate job ID. | `read` with owner visibility checks where durable climate ownership metadata exists. | No ownership linkage for Plumber climate job IDs yet; auth is required but object-level authorization is still unresolved. |
| `/api/v1/climate/download`, `/delete/:scenarioId` | Required auth plus climate rate limit. Download supports `Idempotency-Key`. | `run` for download; `admin` or `run` plus ownership checks for delete. | Climate delete remains an authenticated proxy by scenario ID without project/user ownership semantics. No scoped key/quota/audit. |
| `/api/v1/ecology/*` | Required bearer/API-key auth. Checks run visibility through the caller's project memberships before proxying to Plumber. CSRF applies, but all current routes are GET and bypass CSRF. | `read` with run/project visibility checks. | No scoped-key distinction, quota, or audit event yet; ecology output redaction remains delegated to current Plumber responses. |
| `/api/v1/diagnostics/*` | Required bearer/API-key auth plus default rate limit. Checks run visibility through the caller's project memberships before proxying to Plumber. No CSRF registration, all current routes are GET. | `read` with run/project visibility checks. | No scoped-key distinction or download/audit event yet. |
| `/api/v1/results/*` | Required auth for all routes, with run/project checks and path confinement for file reads. | `read`; potentially separate artifact-download allowance if large downloads need quota. | Good baseline, but manifests/logs/errors still need redaction rules and audit for downloads. |
| `/api/v1/jobs/sse`, `/api/v1/jobs/:jobId`, `/api/v1/jobs/:jobId/cancel` | Required bearer/API-key auth. Queue jobs with `job.data.payload.runId` or `job.data.runId` are checked against run/project visibility. Queue jobs without a run ID are visible/cancellable only when `job.data.userId` or `job.data.payload.userId` matches the caller, preserving current clean/climate async polling. SSE filters active/waiting jobs by the same available queue data. No CSRF registration. | `read` for status/SSE with owner filtering; `run` for cancel; maybe `batch` for batch jobs. | Remaining gap: queue jobs that carry neither run ID nor user ID cannot be safely attributed and are hidden; scoped keys, quotas, and cancellation audit are still missing. |

## Machine-Facing Risk Notes

- Current API keys carry scopes, but most route groups still treat them as
  bearer-equivalent user credentials until route-level scope checks are added.
- Optional-auth route groups should be assumed public unless handlers add their
  own checks.
- Run ID, queue job ID, Plumber job ID, and batch ID are not a complete access
  policy. Any route that accepts one of these IDs still needs user/project
  authorization.
- Route-level rate limiting is not quota enforcement. It is Redis-dependent,
  fail-open, and currently URL keyed.
- Cancellation and deletion routes need broader audit events before being
  exposed to unattended agents.
- Results file path confinement is strong relative to `outputs/jobs`, but
  artifact download policy still needs per-run authorization, redaction, and
  quota rules as manifests become richer.

## Next Tickets

1. Add route-policy middleware that combines authentication, required scope,
   and project/run ownership checks for workflow/result routes.
2. Add scoped-key policy, quotas, and cancellation audit for `/api/v1/jobs/*`;
   required auth and best-effort queue-data visibility checks are now in place.
   Ecology and diagnostics now have required auth and run/project visibility
   checks but still lack scoped-key policy.
3. Add per-key quota/concurrency counters for `run` and `batch` operations,
   with Redis acceleration and DB-backed audit truth.
4. Extend `api_audit_events` coverage from API-key lifecycle events to
   workflow starts, cancellations, destructive clears/deletes, downloads, and
   auth failures.
5. Add tests proving scoped keys cannot use routes outside their scope and that
   anonymous requests cannot read ecology/diagnostics/jobs by guessed IDs.
6. Update OpenAPI security metadata after route-level scopes exist; until then,
   keep it to bearer/API-key schemes without broad false scope claims.
