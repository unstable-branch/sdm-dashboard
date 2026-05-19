# SDM Dashboard — Consolidated Improvements Plan

Merged from: code review (2026-05-19), 20 Hermes-era research docs
(biosecurity, ecology, ESM, ensemble, architecture, standards assessment,
covariates, future projections, uncertainty, occurrence data, extrapolation,
neural models, batch, reproducibility, ENMeval, GitHub repos, peer-reviewed
case studies, use-case scenarios, bug report).

Source files: `bank/research/topics/sdm-dashboard/`

---

## Current Standing

**Araújo et al. (2019) standards score: Bronze → Silver boundary**

| Aspect | Score | Key gap |
|--------|-------|---------|
| Response variable | Bronze | No formal bias analysis, no date filter |
| Predictor variables | Bronze | VIF code exists but may not be pipeline-wired |
| Model building | Bronze | No PA replication, limited hyperparameter tuning |
| Model evaluation | Silver–Bronze | Depends on backend used |
| **Overall** | **Bronze → Silver** | PA replication + VIF wiring would push to Silver |

**Among peers (Wallace 2, biomod2, sdm, SDMtune, dismo):**
- 1st in: evaluation rigour, data integration, extrapolation tools, reporting, batch processing
- 2nd in: algorithm diversity, ensemble methods, ease of use
- Trails in: PA replication, hyperparameter tuning, community modules

---

## Outstanding Bugs (from prior research, #8–#16)

Six bugs were fixed in commit `dfb310a` (covariates, cache, double-sourcing,
tempfile cleanup). The following remain from the earlier Hermes-era audit:

### Fixed in clean snapshot (already patched)

| # | Bug | Status |
|---|-----|--------|
| 9 | Rangebag `n_cores` ignored | ✅ Fixed: `cores = normalize_core_count(n_cores)` |
| 10 | `compute_projection_metrics` hardcodes `$suitability` | ✅ Fixed: uses `extracted[[1]]` |
| 11 | Invalid GBIF `decimalLatitude/Longitude` params | ✅ Fixed: removed from `occ_search()` |
| 12 | Hardcoded GBIF username `"token"` | ✅ Fixed: uses `gbif_user`/`gbif_pwd` params |
| 13 | Case-sensitive `"ABSENT"` filter | ✅ Fixed: uses `tolower()` comparison |
| 14 | All-NA coordinates crash in `make_training_extent` | ✅ Fixed: guard with clear error message |

### Fixed in this commit

| # | Bug | Fix |
|---|-----|-----|
| 15 | Ensemble inherits `occurrence_used` only from GLM component | ✅ Now validates both components agree, falls back to whichever is non-NULL |
| 16 | `make.names()` inconsistency between GLM and Rangebag | ✅ Rangebag now applies `make.names()` to covariate names and data columns |

### Deferred (architectural)

| # | Bug | File | Severity |
|---|-----|------|----------|
| 8 | Cancel button non-functional — Shiny event loop blocked by synchronous run | `R/mod_model_run.R` | UX-critical, needs background process (tied to I13) |

---

## Improvement Roadmap

Organised by effort and impact. Items marked with source reference:

### Phase 1 — Quick Wins (1–3 days each)

| # | Improvement | Area | Source |
|---|------------|------|--------|
| I1 | **Wire VIF into covariate pipeline** — confirm `vif_step_filter()` runs during covariate prep, add UI toggle | Standards → Silver | standards-assessment |
| I2 | **Fix Bug #13** — case-insensitive status filter in `clean_occurrences()` | Data quality | bug report |
| I3 | **Fix Bugs #9, #10, #11, #12, #14** — apply all easy patches listed above | Code quality | bug report |
| I4 | **Wire response curve plots into Diagnostics tab** — code exists in `response_curves.R`, just needs UI rendering | UX | code review |
| I5 | **ESM: make weighting metric configurable** — add `weighting_metric` param (AUC/TSS) to `fit_esm()` | ESM | esm-deep-dive |
| I6 | **ESM: add between-pair uncertainty** — compute SD across bivariate predictions after ensemble projection | ESM | esm-deep-dive |
| I7 | **Hide/show Future tab based on `input$future_projection`** — remove empty placeholder plots | UX | code review |
| I8 | **Persistent settings via localStorage** — save/restore sidebar config on page refresh | UX | code review |
| I9 | **Add coordinate uncertainty filter** — filter GBIF records by `coordinateUncertaintyInMeters` | Data quality | standards-assessment |

### Phase 2 — Moderate Effort (3–5 days each)

| # | Improvement | Area | Source |
|---|------------|------|--------|
| I10 | **Add RF algorithm** — wrap `ranger::ranger()` following `model_glm.R` registry pattern | Algorithms | standards-assessment, ensemble |
| I11 | **Pseudo-absence replication (N=5)** — run background generation multiple times, aggregate predictions across PA sets | Standards → Silver | architecture, ensemble |
| I12 | **Integrate ESM as multi-ensemble component** — auto-recommend based on record count, allow ESM in weighted ensemble | ESM + Ensemble | esm-deep-dive |
| I13 | **Run model in background process** — use `future`/`callr` like Get Data downloads, prevent UI freeze | UX + Architecture | code review, bug #8 |
| I14 | **Add BRT/XGBoost algorithm** — wrap `xgboost` or `gbm` following registry pattern | Algorithms | ensemble |
| I15 | **Climate matching (Climatch-style)** — Euclidean/Mahalanobis distance between source/target climates, output similarity map | Biosecurity | biosecurity-deep-dive |
| I16 | **Rapid response mode** — one-click auto-algorithm selection based on record count, optimised for speed | Biosecurity | biosecurity-deep-dive |
| I17 | **EOO/AOO calculation** — IUCN Red List extent of occurrence / area of occupancy via `rredlist` or `CONR` | Ecology | ecology-deep-dive |
| I18 | **Range size change metrics** — current vs future suitable area, expansion/contraction/retraction | Ecology + Future | ecology-deep-dive |
| I19 | **Multi-scenario SSP comparison** — side-by-side maps for multiple SSP/RCP scenarios | Future projections | ecology-deep-dive, future |
| I20 | **Model comparison across runs** — store last N runs, side-by-side AUC/maps | UX | code review |

### Phase 3 — Polish (1 week+)

| # | Improvement | Area | Source |
|---|------------|------|--------|
| I21 | **Promote backends from experimental → stable** — write tests for MaxNet, GAM, Rangebag, multi-ensemble | Reliability | architecture |
| I22 | **AOA via CAST** — replace/adjoin MESS with model-weighted area of applicability | Standards → Gold | extrapolation, standards |
| I23 | **Calibration plots** — binned observed vs predicted frequency (Pearce & Ferrier 2000) | Evaluation | standards-assessment |
| I24 | **Spatial-block CV for MaxNet and GAM** — currently only GLM uses `cv_strategy = "spatial_blocks"` | Standards | code review |
| I25 | **Simplified sidebar by default** — show only Species, Data Source, Model, BIO vars, Run; advanced behind toggle | UX | code review |
| I26 | **Structured run log** — parse into collapsible sections (Data → Covariates → Model → CV → Projection) | UX | code review |
| I27 | **Native vs introduced niche comparison** — PCA overlap plot, `ecospat.niche.overlap()` metrics | Biosecurity | biosecurity-deep-dive |
| I28 | **Species richness stacking** — stack SDM outputs across species for community-level maps | Ecology | ecology-deep-dive |
| I29 | **Parallel component prediction in multi-ensemble** — `future`/`parallel` for component model predictions | Performance | code review |
| I30 | **Script export for all backends** — ensure `script_export.R` covers ESM, multi-ensemble, biomod2 | Reproducibility | code review |

### Phase 4 — Advanced (future)

| # | Improvement | Area | Source |
|---|------------|------|--------|
| I31 | **Hyperparameter tuning** — grid search for MaxNet regularisation, GAM k/sp | Standards → Gold | standards-assessment |
| I32 | **blockCV variogram-based blocks** — replace custom blocks with `blockCV::cv_spatial()` | Standards → Gold | standards-assessment |
| I33 | **Ensemble variable importance** — permutation importance across weighted ensemble | Evaluation | architecture |
| I34 | **Dispersal simulation** — kernel-based spread model, animated spread maps | Biosecurity | biosecurity-deep-dive |
| I35 | **JSDM backend (HMSC)** — joint species distribution modelling for species interactions | Ecology | ecology-deep-dive |
| I36 | **CLIMEX parameter import** — combine mechanistic + correlative approaches | Biosecurity | biosecurity-deep-dive |
| I37 | **Wire DNN to UI** — expose cito/torch backend in model selector | Algorithms | code review |
| I38 | **Organise R/ into subdirectories** — core/, data/, covariates/, models/, ui/, modules/ | Architecture | code review |
| I39 | **Break `run_sdm.R` into pipeline stages** — load → covariates → fit → predict → metrics → outputs | Architecture | code review |
| I40 | **Batch results summary table** — compare AUC/threshold/area across species | Batch processing | code review |

---

## Research Document Index

All 20 documents are at `bank/research/topics/sdm-dashboard/`:

| Doc | Size | Key Content |
|-----|------|-------------|
| `sdm-standards-assessment-consolidated.md` | 24KB | Araújo scoring, ODMAP, spatial CV, collinearity, PA, platform comparison matrix |
| `sdm-modular-architecture.md` | 24KB | 6-platform comparison, registry pattern, pipeline analysis, Silver roadmap |
| `sdm-ensemble-deep-dive.md` | 18KB | Ensemble theory, Marmion 2009, 5 weighting methods, algorithm rankings |
| `sdm-esm-deep-dive.md` | 19KB | ESM theory, 4-package comparison, dashboard gaps, integration plan |
| `sdm-biosecurity-deep-dive.md` | 25KB | Invasion phases, PRA workflow, Australian context, 7 biosecurity features |
| `sdm-ecology-deep-dive.md` | 22KB | Niche theory, climate impact, conservation planning, IUCN, ecology features |
| `sdm-use-case-scenarios.md` | 25KB | 8 technique profiles, decision matrices, Khapra beetle worked example |
| `sdm-peer-reviewed-case-studies.md` | 27KB | Published SDM case studies with methods and outcomes |
| `sdm-covariates-deep-dive.md` | 41KB | WorldClim, CHELSA, elevation, soil, vegetation, future projections |
| `sdm-future-projections-deep-dive.md` | 37KB | CMIP6, SSP scenarios, GCM selection, downscaling, delta maps |
| `sdm-uncertainty-deep-dive.md` | 40KB | Sources of uncertainty, bootstrap, Bayesian, ensemble variance |
| `sdm-occurrence-data-deep-dive.md` | 41KB | GBIF, ALA, iNaturalist, cleaning, thinning, bias correction |
| `sdm-extrapolation-aoa-deep-dive.md` | 35KB | MESS vs AOA, clamping, multivariate environmental surfaces |
| `sdm-batch-multispecies-deep-dive.md` | 31KB | Multi-species workflow, parallel processing, result aggregation |
| `sdm-reproducibility-deep-dive.md` | 33KB | ODMAP, script export, version locking, provenance |
| `sdm-neural-models-deep-dive.md` | 31KB | DNN via cito/torch, GPU setup, architecture choices |
| `sdm-enmeval-deep-dive.md` | 16KB | ENMeval tuning framework, benchmarking against dashboard |
| `sdm-github-repos-deep-dive.md` | 18KB | Comparable open-source SDM tools on GitHub |
| `sdm-dashboard-bugs.md` | 9KB | Bugs #8–#16 with files, causes, fixes, severity |
| `README.md` | 7KB | Index of all research documents |

---

## Key References (for justifying improvements)

- Araújo et al. (2019) — standards framework: *Science Advances* 5(1): eaat4858
- Zurell et al. (2020) — ODMAP protocol: *Ecography* 43: 1481–1493
- Ploton et al. (2020) — spatial CV overfitting: *Nature Communications* 11: 4540
- Meyer & Pebesma (2021) — AOA: *Methods in Ecology and Evolution* 12: 1620–1633
- Barbet-Massin et al. (2012) — PA strategies: *Methods in Ecology and Evolution* 3: 327–338
- Breiner et al. (2015, 2018) — ESM: *Methods in Ecology and Evolution*
- Dormann et al. (2013) — collinearity: *Ecography* 36: 27–46
- Marmion et al. (2009) — ensemble weighting: *Diversity and Distributions* 15: 814–827
- Venette et al. (2010) — pest risk maps: *BioScience* 60: 349–362
