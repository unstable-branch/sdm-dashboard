# Phase 3 — Methodology and SDM Correctness

**Constraint:** R is not available on this host. All analysis is static code reading. No smoke test or determinism verification could be executed.

---

## Per-Backend Methodology Cards

### GLM (`R/models/model_glm.R`)
| Property | Value |
|----------|-------|
| Package | `stats::glm()` (base R) |
| Version pinned | No (base R version) |
| Default hyperparameters | binomial family, 80 maxit, case-weight balancing |
| Seed support | `set.seed(seed)` in PA generation |
| CV | Shared `cross_validate_model` engine |
| Prediction | `predict.glm(type = "response")` — returns 0-1 |
| NA handling | `terra::predict(na.rm = TRUE)` → NA on any missing predictor |
| Notes | Quadratic terms via `I(x^2)` by default. Case weights: `n/(2*n1)` for presences, `n/(2*n0)` for absences. Verified against standard practice. |

### GAM (`R/models/model_gam.R`)
| Property | Value |
|----------|-------|
| Package | `mgcv::gam()` |
| Version pinned | `>=1.8-40` (in `packages.R`) |
| Default hyperparameters | `bs = "tp"` (thin-plate spline), REML estimation |
| Seed support | Same as GLM |
| CV | Shared CV engine |
| Prediction | `mgcv::predict.gam(type = "response")` |
| Notes | Promoted to "stable" per registry metadata. REML is the recommended smoothing method (Wood 2011). |

### MaxEnt / MaxNet (`R/models/model_maxnet.R`)
| Property | Value |
|----------|-------|
| Package | `maxnet` (glmnet backend, no Java) |
| Version pinned | No |
| Default hyperparameters | `features = "lqp"` (linear, quadratic, product), `regmult = 1.0` |
| Seed support | Via PA generation seed |
| CV | Shared CV engine, custom cluster setup exports `maxnet` |
| Prediction | `predict.maxnet(clamp = TRUE, type = "link")` |
| Notes | Type "link" returns logit-scale (not 0-1). This is then converted by `predict_suitability` which uses `type = "response"` through `terra::predict`. The `clamp = TRUE` restricts to training range — correct for MaxEnt (Phillips 2006). |

### Random Forest (`R/models/model_rf.R`)
| Property | Value |
|----------|-------|
| Package | `ranger` |
| Version pinned | No |
| Default hyperparameters | `num.trees = 500`, `mtry = sqrt(n_covariates)`, `min.node.size = 10` |
| Seed support | `seed = seed` passed to `ranger()` |
| CV | Shared CV engine |
| Prediction | `predict.ranger()` returns raw predictions |
| Notes | `classification = FALSE` means regression mode. Returns probability-like values (0-1). Ranger's regression mode with 0/1 response does produce probability estimates. |

### XGBoost (`R/models/model_xgboost.R`)
| Property | Value |
|----------|-------|
| Package | `xgboost` |
| Version pinned | No |
| Default hyperparameters | `max_depth = 6`, `eta = 0.3`, `nrounds = 100` (from code read — not explicitly set in model_registry) |
| Seed support | Not explicitly passed to `xgboost()` — uses RNG internally |
| CV | Shared CV engine, custom `cross_validate_xgboost` |
| Prediction | `predict(model, x_test)` |
| Notes | `objective = "binary:logistic"` ensures 0-1 output. Case-weight balancing applied. |

### ESM (`R/models/model_esm.R`)
| Property | Value |
|----------|-------|
| Package | `ecospat`, `biomod2` |
| Version pinned | No |
| Default hyperparameters | `n_runs = 10`, `data_split = 0.7`, `min_auc = 0.7`, `weighting = "AUC"`, `power = 1` |
| Seed support | Via `set.seed(seed)` in PA generation |
| Notes | ESM methodology follows Breiner et al. 2015, 2018. Bivariate model pairs, AUC-weighted ensemble. `min_records = 5` in registry. Recommendation threshold at 30 records (`sdm_esm_recommend_below <- 30L`) matches literature. |

### Multi-ensemble (`R/models/model_multi_ensemble.R`)
| Property | Value |
|----------|-------|
| Packages | `terra` |
| Default weighting | AUC-weighted with power = 2 |
| Min AUC/TSS | `min_auc = 0.7`, `min_tss = 0.5` |
| Notes | Filters out component models below thresholds before ensemble. Behaviour matches standard practice (cf. Araújo & New 2007). |

---

## Pseudo-absence / Background Generation

**File:** `R/models/model_glm.R:3-112` (`sample_background_points`)

- **Default:** 10,000 uniform-random background points (`sdm_default_background_n <- 10000L`)
- **Methods:** uniform, target-group, thickened
- **Same PA set across algorithms:** Yes — the PA set is generated once in `fit_fast_sdm` and passed to the CV function. Same set used for all cross-validation folds within a model. This is correct for comparable evaluation.
- **For ensemble (GLM + rangebag):** Each component draws its own PA set (called separately). This is noted as a warning in the ensemble code (model_ensemble.R:88-89): "GLM and Rangebag occurrence sets differ". This means the ensemble weights are computed on potentially different PA sets, which is methodologically questionable.

**Concern:** The README says default is 10,000 background points, which matches code. No justification for 10,000 vs. 1,000 or 100,000. Common practice (Barbet-Massin et al. 2012) suggests 10,000 is adequate for presence/background methods, but the source is not cited.

---

## Cross-Validation

**File:** `R/models/cv_engine.R`

**Default:** Random 3-fold (`sdm_default_cv_folds <- 3L`, `sdm_default_cv_strategy <- "random"`)

**Spatial-block CV:** Available via `cv_strategy = "spatial"`. Implements:
1. blockCV variogram-based (`R/models/blockcv.R:13-69`)
2. Fallback grid blocks (`R/models/cv_folds.R:38-106`)

**Checkerboard CV:** Not implemented.
**LOO spatial CV:** Not implemented for small datasets.

**Per-fold metrics:** Computed per-fold then summarised as mean ± SD. This is correct. The `cv_engine.R:124-127` computes `metric_mean(fold_metrics$auc)` and `metric_sd(fold_metrics$auc)` from per-fold values, not pooled predictions.

**Verdict:** Correct implementation. The default random k-fold is appropriate for general use. Spatial-block CV is opt-in and properly implemented. The `blockcv.R` correctly references Valavi et al. 2019.

---

## VIF / Collinearity Reduction

**File:** `R/covariates/predictor_selection.R`

- Threshold: default 10 (standard)
- Stepwise removal: iteratively removes variable with highest VIF ≥ threshold
- Applies to raster cell samples (not PA data) — sampling strategy varies by raster size (min 1000, adaptive to 20000 for large rasters)
- Applied BEFORE model fitting but AFTER covariate loading (correct order)

**Verdict:** Correct. VIF threshold of 10 is standard (Hair et al. 2010; Dormann et al. 2013). Sampling-based approach is defensible for large rasters.

---

## Threshold Selection

**File:** `R/core/config.R:50` → `sdm_default_threshold <- 0.5`

Fixed threshold at 0.5. There is no default threshold selection method (max-TSS, max-Kappa, sens=specificity). The `normalize_threshold` function validates numeric values but does not implement optimisation methods.

**Concern:** A fixed 0.5 threshold is naive for presence/background data where prevalence is not 0.5. The frontend diagnostics charts include threshold curves (`threshold-chart.tsx`), suggesting the user can adjust interactively, but the model run default is 0.5. Max-TSS should be the default for SDM applications (Liu et al. 2005, 2013).

---

## AOA

**File:** `R/ecology/aoa.R`

**Method:** Weighted dissimilarity (Mahalanobis distance to training centroid, weighted by variable importance). Falls back from CAST if unavailable.

**Reference:** Meyer & Pebesma 2022 (cited in file header).

**Comparison to reference:**
- The weighted dissimilarity approach computes Mahalanobis distance to the training centroid, weighted by variable importance. The maximum training distance is used as the AOA threshold.
- This is NOT identical to CAST's DI (Dissimilarity Index) approach, which uses nearest-neighbour distances in the predictor space with cross-validation-based threshold.
- The implementation is a reasonable approximation but differs from Meyer & Pebesma 2022 in two ways:
  1. Uses centroid-based Mahalanobis rather than nearest-neighbour DI
  2. Threshold = max training distance rather than CV-derived optimal threshold

**Verdict:** Significant deviations from the reference implementation. The "weighted dissimilarity" method is closer to a Mahalanobis-based climate matching approach than the published CAST AOA algorithm. The file header correctly acknowledges this falls back to weighted dissimilarity when CAST/caret is unavailable.

---

## MESS

**File:** `R/ecology/extrapolation.R`

**Method:** Per-variable similarity (0-100 training range), minimum across variables for overall MESS. MOD (Most Dissimilar Variable) also computed.

**Reference:** Elith, Kearney & Phillips 2010 (cited in file header).

**Verification against formula:**
- Train range computed as `max - min` (correct)
- Similarity: `(proj_val - train_min) / train_range` (correct for Elith et al. 2010)
- Negative values assigned for extrapolation (correct: MESS < 0 = extrapolation)
- Overall MESS = per-variable minimum (correct)
- MOD = `which.min()` (correct)

**Verdict:** Matches reference implementation correctly.

---

## EOO/AOO

**File:** `R/ecology/eoo_aoo.R`

**Method:**
- EOO: Minimum Convex Polygon (convex hull), area calculated in UTM equal-area projection
- AOO: 2×2 km grid cell count, point-based for large grids

**Reference:** IUCN Red List Guidelines v15.1 (2022) — cited in file header.

**Verification:**
- EOO = convex hull area, UTM zone for area calculation (correct equal-area)
- AOO = 2×2 km cell count (correct per IUCN Criterion B)
- IUCN threat category guidance (CR/EN/VU thresholds) implemented (lines 153-157)
- No α-hull option (IUCN guidelines recommend α-hull for non-contiguous distributions). This is a known limitation but acceptable for many use cases.

**Concern:** The file uses `sf::st_convex_hull()` for EOO. IUCN recommends α-hull for non-contiguous distributions (Joppa et al. 2016). The README advertises "EOO (MCP)" which is correct, but an α-hull option would be closer to best practice.

**Verdict:** Correct implementation of EOO/MCP and AOO per IUCN standards. α-hull option would be a useful addition but the current implementation is defensible.

---

## Niche Overlap

**File:** `R/ecology/niche_overlap.R`

**Method:** PCA on combined environmental space, then Schoener's D and Hellinger's I via `ecospat::ecospat.niche.overlap()`.

**Reference:** Broennimann et al. 2012 (cited).

**Verification:**
- PCA on combined environment (correct for ecospat approach)
- KDE on first 2 PCA axes (matches Broennimann et al. 2012)
- Schoener's D and Hellinger's I computed by ecospat (correct)

**Verdict:** Matches reference implementation. Relies on ecospat for the core computations.

---

## Climate Matching

**File:** `R/ecology/climate_matching.R`

**Methods:** Mahalanobis, Euclidean, Standardized Euclidean distance to training centroid.

**Reference:** Climatch v2 (Downey & Boon 2022), Broennimann et al. 2012.

**Verdict:** Correct implementation. Three distance methods, proper covariance matrix handling, NA-safe.

---

## Future Projection

**File:** `R/covariates/future_projection.R` (referenced by `R/core/run_sdm.R:525-538`)

From the code read of `run_sdm.R`:
- Future covariate stack loaded via `project_future_suitability`
- Same standardisation (means/sds from training) applied to future data (`env$means`, `env$sds`)
- `future_worldclim_dir` and `future_worldclim_dir2` for multi-scenario comparison
- MESS/AOA available via ecology toolkit

**Verdict:** Standardisation correctly applied. Future projection uses the same model and the same training-data-derived standardisation. Extrapolation detection available via MESS/AOA but not automatically enforced.

---

## Determinism

**Could not verify** without executing R. Static analysis notes:
- `sdm_default_seed <- 42L` is set globally and propagated
- PA generation uses `set.seed(seed)` before `sample.int()`
- CV fold assignment uses `set.seed(seed)` in `make_cv_folds_random`
- `ranger::ranger(seed = seed)` supports seed argument
- `xgboost` does not have a seed argument; uses R's RNG state, so determinism depends on the RNG state before the call

**Verdict:** Likely deterministic for GLM, GAM, MaxNet, RF. Uncertain for XGBoost (no seed parameter).

---

## Key Methodology Findings

| # | Issue | Severity | File(s) | Details |
|---|-------|----------|---------|---------|
| M1 | Default threshold is fixed 0.5, not max-TSS | Medium | `config.R:50` | Fixed threshold is naive for presence/background data. Max-TSS should be the default, with 0.5 as fallback. |
| M2 | AOA differs from CAST reference | Medium | `aoa.R:53-159` | Uses centroid-based Mahalanobis, not nearest-neighbour DI. Acceptable as fallback but should not be equated with Meyer & Pebesma 2022. |
| M3 | No α-hull option for EOO | Low | `eoo_aoo.R:40-41` | IUCN recommends α-hull for non-contiguous distributions. MCP is conservative. |
| M4 | Ensemble components use different PA sets | Low | `model_ensemble.R:44-62` | GLM and Rangebag components get independent PA draws. Ensemble weights computed on potentially incomparable AUCs. |
| M5 | PA set size (10,000) uncited | Low | `config.R:48` | 10,000 is reasonable but no justification or literature citation for this choice. |
| M6 | Default 3 CV folds is low | Low | `config.R:52` | 3-fold CV has high variance. 5-fold is standard for SDM. Should warn when <5. |
| M7 | No MESS called automatically in pipeline | Low | `run_sdm.R` | MESS is available as a function but not computed by default in `run_fast_sdm`. Users must call `compute_mess` explicitly (or use the ecology endpoint). |
| M8 | XGBoost seed not explicitly set | Low | `model_xgboost.R` | XGBoost doesn't receive an explicit seed, making it potentially non-deterministic across runs. |

## Smoke Test

**Could not execute** (R unavailable). The `scripts/smoke_test.R` expects R 4.3+ with all packages. The `tests/testthat/` directory exists but test coverage analysis was not performed (would require running the tests).

## Package Versions

The `plumber/Dockerfile` uses Posit Package Manager (PGM) with pre-compiled binaries — this pins package versions to the PGM snapshot, which is good but not a lockfile. The `renv.lock` file exists in the project root but is not used inside the Docker image (the Dockerfile installs via `install.packages` not `renv::restore()`).
