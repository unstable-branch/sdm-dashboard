# Phase 4 — Comparison Against Established Platforms

## Comparator Status (Current as of May 2026)

| Platform | Form Factor | Last Release | Status | Peer-Reviewed |
|----------|-------------|--------------|--------|---------------|
| Wallace | R package + Shiny app | v2.2.1 (May 2026) | Active | Kass et al. 2023, Ecography |
| biomod2 | R package | v4.3-4-6 (May 2026) | Active | Thuiller et al. 2009, 2016, 2024 |
| flexsdm | R package (GitHub only) | v1.3.9 (Mar 2026) | Active | Velazco et al. 2022, MEE |
| sdm | R package | v1.2-59 (Jul 2025) | Active | Naimi & Araújo 2016, Ecography |
| ENMeval | R package | v2.0.5.2 (May 2025) | Active | Kass et al. 2021, MEE |
| kuenm | R package | — | CRAN-archived | — |
| BCCVL | Web platform | — | **Defunct** (funding ended ~2022) | — |
| SSDM | R package | — | CRAN (depends on sdm) | Schmitt et al. 2017 |
| SDMtoolbox | Python/GIS toolbox | — | Low activity | Brown 2014 |

## Feature Matrix

| Capability | SDM Dashboard | Wallace | biomod2 | flexsdm | sdm | ENMeval |
|------------|--------------|---------|---------|---------|-----|---------|
| **Deployment** | | | | | | |
| Self-hostable web UI | ✓ Docker Compose | ✗ (Shiny only) | ✗ (R pkg) | ✗ (R pkg) | ✗ (R pkg) | ✗ (R pkg) |
| Multi-tenant | ✓ (JWT, projects) | ✗ | ✗ | ✗ | ✗ | ✗ |
| API server | ✓ (Hono + Plumber) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Standalone desktop | ✓ (R/Shiny) | ✓ (Shiny) | ✓ (R) | ✓ (R) | ✓ (R) | ✓ (R) |
| **Algorithms** | | | | | | |
| GLM | ✓ | ✓ (via maxnet) | ✓ | ✓ | ✓ | ✗ |
| GAM | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ |
| MaxEnt / MaxNet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (focus) |
| Random Forest | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| XGBoost / BRT | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ |
| ESM (rare species) | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| DNN / Deep learning | ✓ (cito/torch) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Domain/Bioclim | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| SVMs | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Multi-ensemble | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Ecology toolkit** | | | | | | |
| EOO / AOO | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| AOA (Meyer & Pebesma) | ✓ (weighted dissim.) | ✗ | ✗ | ✗ | ✗ | ✗ |
| MESS | ✓ | ✗ | ✓ (via `mess`) | ✓ (via `extra_eval`) | ✗ | ✗ |
| Niche overlap | ✓ (PCA + ecospat) | ✓ (via ecospat) | ✗ | ✗ | ✗ | ✓ |
| Climate matching | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Cross-validation** | | | | | | |
| Random k-fold | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Spatial-block | ✓ | ✓ (blockCV) | ✓ | ✓ (blockCV) | ✗ | ✓ (checkerboard) |
| Environmental CV | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ |
| **Data sources** | | | | | | |
| GBIF | ✓ | ✓ (spocc/rgbif) | ✗ | ✓ (rgbif) | ✗ | ✓ (spocc) |
| DwCA | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| File upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Output** | | | | | | |
| ODMAP report | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Machine-readable manifest | ✓ | ✓ (Rmd) | ✓ (outputs) | ✗ | ✗ | ✗ |
| COG GeoTIFF | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| R export script | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Architecture** | | | | | | |
| Multi-user projects | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Job queue / async | ✓ (BullMQ + callr) | ✗ | ✗ | ✗ | ✗ | ✗ |
| WebSocket progress | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Pre-commit CI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Distinctive Value Proposition

**sdm-dashboard is the only self-hostable, multi-tenant, web-based SDM platform with an API server, async job queue, and a shared modelling core that also runs as a standalone desktop app.**

No comparator offers this combination:
- Wallace is single-user Shiny only, no API
- biomod2/flexsdm/sdm are R packages only — they don't include a web UI
- BCCVL was the closest comparator (hosted web platform with multi-algorithm SDM) but is defunct
- SSDM offers a Shiny GUI but is single-user and unmaintained

The ecology toolkit is also a differentiator: EOO/AOO, AOA, climate matching, and ODMAP reports are not available in any single comparator.

## Credibility Gaps

Ordered by importance:

| # | Gap | Impact | Notes |
|---|-----|--------|-------|
| G1 | No peer-reviewed paper describing the platform | **Critical for adoption** | Users and reviewers cannot cite a methods paper. Wallace, biomod2, flexsdm, sdm all have Ecography/MEE publications. |
| G2 | No benchmark comparison against established platforms | **High** | Users don't know if predictions are comparable to biomod2/flexsdm outputs. The Phase 8 plan addresses this. |
| G3 | Community / user base small (5 contributors) | **Medium** | Wallace has 15+ authors and wider community. biosdm2 has dedicated maintenance team at Univ. Grenoble |
| G4 | Maturity labels inconsistent with community perception | **Medium** | README lists all backends as "Stable" but the registry metadata shows many as "experimental". This mismatch creates false confidence. |

## README Position vs. Reality

The README claims: "**Modern stack (recommended): Next.js UI + Hono API + Plumber R engine + PostgreSQL, run via Docker Compose or locally for development**".

**Verdict: Accurate but aspirational.** The code supports this claim. The architecture is real and functional. However, the `v2.0.0-beta` label is honest — the platform is not production-ready for untrusted multi-tenant deployment (see Phase 2 findings). For a single-user or trusted-team deployment, it works.

The README also claims "**Stable**" for 8 backends. The registry metadata marks several as "experimental" internally (rangebag, multi_ensemble, biomod2, esm_*, rf, xgboost, dnn). This mismatch should be resolved.

## Key Differentiator Summary

**sdm-dashboard's defensible position:** The only self-hostable, API-first, multi-user SDM platform with async job processing, real-time progress, and a standalone desktop fallback. No other platform in the SDM ecosystem occupies this niche.
