# Phase 7 — Synthesis and Reporting

## Executive Summary

SDM Dashboard Workbench is a multi-algorithm species distribution modelling platform at `v2.0.0-beta` with 375+ commits from 5 contributors. It offers a self-hostable, multi-tenant web architecture (Next.js + Hono + Plumber + PostgreSQL + Redis + Garage S3) alongside a legacy Shiny desktop app, both sharing the same modelling core (`R/core/`, `R/models/`, `R/ecology/`). The model backend registry pattern (`register_sdm_model()`) is well-designed and pluggable. The ecology toolkit (AOA, MESS, EOO/AOO, niche overlap, climate matching) is the most complete among non-public SDM platforms.

**What it does well:** Clean architecture separation, pluggable model backends, graded conditional package loading, encryption-at-rest for uploads, comprehensive manifest/provenance recording, ODMAP reports, reproducible script export, real-time WebSocket job progress.

**What blocks production use:** Nothing critical. The security baseline (SHA256-hashed API keys, forced-secret startup, CSRF, rate limiting, non-root containers) is solid for a beta. The main risks are minor: no `iss` claim in JWT validation, nginx max body size default blocks large uploads, Plumber OpenAPI docs exposed if service port is made public.

**Biggest credibility gaps:** No peer-reviewed paper (critical for scientific adoption), no benchmark comparison against biomod2/flexsdm (needed for trust in predictions), default threshold fixed at 0.5 (should be max-TSS), and AOA implementation diverges from CAST's Meyer & Pebesma 2022 method.

---

## Top 10 Fixes (Prioritised by Impact ÷ Effort)

| # | Fix | Phase | Effort | Impact | File |
|---|-----|-------|--------|--------|------|
| 1 | Add `client_max_body_size 100M` to nginx.conf | 2 | 5 min | Prevents blocked large uploads | `nginx.conf` |
| 2 | Add `iss` claim check to JWT validation | 2 | 15 min | Cross-environment token defence | `api/src/middleware/auth.ts` |
| 3 | Change default threshold from 0.5 to max-TSS | 3 | 2-4 hrs | Methodologically correct binarisation | `R/core/config.R`, `R/output/metrics_binary.R` |
| 4 | Pin monitoring images (prometheus, grafana) to versions | 2 | 5 min | Reproducible builds | `docker-compose.prod.yml` |
| 5 | Add alpha-hull option for EOO calculation | 3 | 4-6 hrs | Closer to IUCN best practice | `R/ecology/eoo_aoo.R` |
| 6 | Consolidate two manifest implementations into one | 6 | 2-4 hrs | Single provenance schema | `R/output/manifest.R`, `plumber/R/plumber.R` |
| 7 | Fix frontend type drift — standardise on `@sdm/shared` | 5 | 4-8 hrs | Type safety across the stack | `frontend/src/services/types.ts` |
| 8 | Increase default CV folds from 3 to 5 with warning | 3 | 30 min | Lower variance in evaluation | `R/core/config.R` |
| 9 | Improve AOA documentation to clarify weighted dissim. ≠ CAST | 3 | 30 min | Honest positioning | `R/ecology/aoa.R` header |
| 10 | Consistent nodata metadata on all output rasters | 6 | 1-2 hrs | GIS interoperability | `R/core/run_sdm.R`, `R/models/prediction.R` |

---

## Blockers (must fix before production / publication)

None identified. The codebase has a solid security baseline.

## High Value (significantly improves platform, not blocking)

- Add max-TSS threshold selection as default
- Consolidate manifest implementations
- Fix frontend type drift
- Add alpha-hull option for EOO
- Increase default CV folds

## Nice to Have

- Add `iss` claim to JWT (cheap defence)
- Pin Docker images to digests
- Consistent nodata metadata on output rasters
- Improve AOA documentation

## Future Direction

- Write a peer-reviewed methods paper (Ecography, MEE, or similar)
- Conduct a formal benchmark against biomod2 / flexsdm (Phase 8 groundwork below)
- Add environmental cross-validation (flexsdm has this; sdm-dashboard doesn't)
- Consider alpha-hull and α-hull as additional EOO methods

## What I Couldn't Check

| Check | Reason |
|-------|--------|
| Smoke test (`Rscript scripts/smoke_test.R`) | R not installed |
| Full testthat suite | R not installed |
| Determinism (same input + seed → same output) | R not installed |
| Plumber API surface (curl healthcheck) | Plumber container not built |
| Frontend build & typecheck | `node_modules` not installed; existing type errors found |
| Accessibility (axe-core) | Browser required |
| Docker Compose config validation | Available: `docker compose config` ran but output not validated in detail |
| npm registry mirror default | Documented finding |
