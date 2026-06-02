# Phase 2 — Security and Configuration

## Methodology

All findings are backed by file reads and compose config validation. R commands and Docker builds were not available; static analysis only.

---

## Prioritised Findings

### CRITICAL (0)

None found.

### HIGH (1)

#### H1. No issuer (`iss`) check in JWT validation

**File:** `api/src/middleware/auth.ts:131`
```typescript
const payload = await verify(token, secret, "HS256");
```

The JWT verification uses `hono/jwt`'s `verify()` with only the `HS256` algorithm check. There is no `iss` claim validation against a known issuer. In a multi-service deployment, a token issued by a compromised service (or a different environment's service that shares the same `JWT_SECRET`) would be accepted.

**Failure mode:** If the `JWT_SECRET` is reused across environments (dev/staging/prod) — which should not happen, but the check would catch it if it did — tokens from one environment would be accepted by another.

**Recommendation:** Add an issuer check:
```typescript
const payload = await verify(token, secret, "HS256");
if (payload.iss !== process.env.JWT_ISSUER) throw new Error("invalid issuer");
```

**Severity:** High (exploitable only if JWT_SECRET is shared, but the guard is cheap and standard practice).

### MEDIUM (3)

#### M1. Nginx max body size defaults to 1 MB

**File:** `nginx.conf` (entire file, 73 lines)

No `client_max_body_size` directive is set. The default nginx limit is 1 MB. This will block:
- Large occurrence uploads (CSVs with 100k+ records can exceed 5 MB)
- Any ZIP-based DwCA uploads
- Future raster upload endpoints if added

**Detection:** `grep "client_max_body_size" nginx.conf` returns nothing.

**Recommendation:** Add to the `server` block:
```nginx
client_max_body_size 100M;
```

**Severity:** Medium (blocks functional use; not a vulnerability).

#### M2. Plumber exposes `/__docs__/` OpenAPI docs in production

**File:** `plumber/R/run_server.R:41`
```r
# OpenAPI 3.0 docs are available at /__docs__/openapi.json by default in plumber 1.x
```

The comment acknowledges that Plumber's built-in OpenAPI documentation is available at `/__docs__/openapi.json`. This endpoint serves schema information about all registered endpoints, including parameter shapes.

**Risk:** The OpenAPI doc reveals the API surface to anyone who reaches port 8000. In the production compose, Plumber is on an internal network and not exposed to the host — so this is mitigated. But if someone adds a port mapping for Plumber in a custom deployment, the docs would be public.

**Recommendation:** Explicitly disable docs in production:
```r
pr$setDocs(FALSE)
```
Or add a note to the deployment docs reminding operators not to expose port 8000.

**Severity:** Medium (mitigated by network isolation; could be problematic in misconfigured deployments).

#### M3. Base images use version tags, not digests

| Image | Tag | Digest-pinned? |
|-------|-----|----------------|
| `postgis/postgis` | `16-3.4` | No |
| `redis` | `7-alpine` | No (floating) |
| `nginx` | `1.25-alpine` | No |
| `rocker/r-ver` | `4.4.2` | Yes (immutable tag) |
| `node` | `22-alpine` | No (floating) |
| `dxflrs/garage` | `v2.3.0` | No |
| `prom/prometheus` | `latest` | No (floating) |
| `grafana/grafana` | `latest` | **Floating tag — HIGHEST RISK** |

**Risk:** `prometheus:latest` and `grafana:latest` will produce different images on different build dates. This breaks reproducibility and could introduce breaking changes silently.

**Recommendation:** Pin all images to digests. At minimum, change `prometheus:latest` → `prom/prometheus:v2.53.0` and `grafana/grafana:latest` → `grafana/grafana:11.0.0`.

**Severity:** Medium (reproducibility issue; `latest` for monitoring is common but not best practice).

### LOW (4)

#### L1. `PNPM_REGISTRY` default points to Chinese mirror

**Files:** `Dockerfile.api:13`, `Dockerfile.frontend:13`
```dockerfile
ENV PNPM_REGISTRY=${PNPM_REGISTRY:-https://registry.npmmirror.com}
```

The default npm registry mirror is `npmmirror.com` (a Chinese mirror operated by the Taobao/NPM team). For users outside China, this is slower and potentially less reliable than the default `https://registry.npmjs.org`. The `auto-registry.sh` script can override this automatically, but only when the build arg contains "auto".

**Risk:** None for Chinese users; performance degradation for non-Chinese users. The build process is slower when the mirror is far from the user.

**Recommendation:** Document the override mechanism. Consider making the default conditional on locale, or default to npmjs.org and let Chinese users set the mirror.

#### L2. Prometheus metrics endpoint exposed on host

**File:** `docker-compose.prod.yml:163`
```yaml
prometheus:
    ports:
      - "9090:9090"
```

Prometheus's admin API and metrics endpoint are exposed on the host network. If the Prometheus configuration allows remote writes or the `/api/v1/admin/` endpoints are accessible, this gives an attacker insight into application performance and could be used for reconnaissance.

**Recommendation:** Remove the port mapping or restrict to localhost (`127.0.0.1:9090:9090`). The frontend and nginx don't need to reach Prometheus directly.

#### L3. No `X-Content-Type-Options: nosniff` on non-GET responses

**File:** `nginx.conf:19`
```nginx
add_header X-Content-Type-Options "nosniff" always;
```

This is set correctly in nginx. The API side (Hono) does not set it in its own middleware — it relies on nginx to add the header. If a request bypasses nginx (e.g., direct to API on port 4000 in dev), the header is absent.

**Risk:** Low. This is a defence-in-depth issue. Note as a deployment guidance item.

#### L4. In-memory rate limiting has no persistence

**File:** `api/src/middleware/rate-limit.ts:8-9`
```typescript
const memoryStore = new Map<string, { timestamps: number[] }>();
```

When Redis is unavailable, the rate limiter falls back to an in-memory store. If the API process restarts (crash, deployment, OOM), all rate limit counters reset. An attacker who detects a restart could flood auth/login endpoints during the window.

**Risk:** Very low in practice. The in-memory fallback is explicitly a degraded-mode safety net. Noted for completeness.

---

## Production-Readiness Gate

**Verdict: PASSES with minor notes.**

The configuration allows a safe production deployment provided:
1. All `:?`-required env vars are set with strong, unique values
2. Plumber port 8000 is NOT exposed to the host (production compose does this correctly)
3. nginx `client_max_body_size` is increased for large uploads
4. Monitoring images are pinned to specific versions

**Current gaps that would block a production deploy:**
- None critical. The `JWT_SECRET` can't be accidentally defaulted (it's required).
- The `PLUMBER_AUTH_DISABLED=false` in production compose is explicit and correct.

---

## Key Strengths

1. **All secrets use `:?` required syntax** — no accidental silent defaults in any compose file.
2. **Plumber auth gate ** properly checks both `X-Hono-Internal` (trusted path) and `X-API-Key` (direct path), with a safe default that requires auth.
3. **SHA256-hashed API keys** at rest in PostgreSQL (both Hono and Plumber sides).
4. **Non-root containers** for API, frontend, and Plumber.
5. **No host-exposed ports** for data stores in production compose.
6. **Encryption at rest** for uploaded occurrence files (`services/encryption.ts` — AES-256-GCM).
7. **CSRF protection** applied to mutation routes, with API-key bypass.
8. **Orphan process cleanup** on Plumber shutdown (`run_server.R:144-171`).
