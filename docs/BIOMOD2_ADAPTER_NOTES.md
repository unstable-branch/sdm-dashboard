# biomod2 Adapter Notes

`biomod2` should remain optional and non-default until it has been tested on a real R runtime, especially Windows.

## Current adapter limits and package behavior

- biomod2 4.3-4-6 resolves its built-in `ModelsTable` dataset unqualified from a foreach worker. Namespace-only loading fails; the supported package attachment path exposes the dataset. The optional adapter attaches biomod2 at first use rather than modifying its namespace or assigning global data.
- CV: random k-fold (`cv_strategy` `"random"` from the app, or `"kfold"`) and CV Off are supported. Spatial-block CV is rejected with an explicit error, both for the standalone backend and for biomod2 components inside the multi-model ensemble; it is never silently replaced by random folds. The app default `spatial_blocks` therefore needs the user to choose random CV or CV Off for biomod2.
- Unknown controls passed to `fit_biomod2_sdm()` through `...` are rejected by name.
- In the multi-model ensemble, a biomod2 component whose full-data projection fails stops the ensemble with an error naming the component; it is not dropped.
- Other controls: uniform background only (`target_group`/`thickened` rejected; the always-supplied default `thickening_distance_km` is ignored), `include_quadratic = FALSE`, default threshold 0.5, `cv_block_size_km` only as NA/NULL. `n_cores > 1` is accepted but fitting stays sequential (logged).
- CV Off (0 folds) uses one all-data calibration split (`_allData_RUN1_`) and reports no validation metrics. Positive fold counts use biomod2 k-fold CV with held-out fold metrics and add a full-data model (`_allData_allRun_`); the full-data model is not a validation observation.
- Each fit uses its own `tempfile("biomod2-run-")` workspace; modelling and projection restore the caller's working directory.
- Native CPU evidence (biomod2 4.3-4-6, synthetic rasters): GLM Off/k3, GLM+GAM Off/k3 projection, ensemble biomod2 component, CV-strategy acceptance/rejection, and the legacy contract tests with the backend enabled. Not yet: RF/GBM/MAXNET (in `config$biomod2_default`), Windows, or lock-backed dependency provenance.

## Gating (IMPLEMENTED)

- Do NOT add `biomod2` to the base Plumber runtime packages.
- Register a biomod2 backend only when both are true:
  - `requireNamespace("biomod2", quietly = TRUE)`
  - `isTRUE(getOption("sdm.enable_biomod2", FALSE))`
- User enables via: `options(sdm.enable_biomod2 = TRUE)` in .Rprofile or app settings

## Fit Contract (IMPLEMENTED)

`run_biomod2()` returns canonical list:

```r
list(
  model = biomod_mod,           # BIOMOD_Modeling object
  formula = NULL,
  coefficients = data.frame(    # per-algorithm summary
    algorithm = c("GLM","RF",...),
    auc = c(0.85, 0.82, ...),
    tss = c(0.65, 0.60, ...)
  ),
  occurrence_used = occ_cleaned_df,
  background_xy = pa_xy_df,
  cv = list(
    k = cv_folds,
    strategy = "kfold",
    auc_mean = mean(aucs),
    auc_sd = sd(aucs),
    tss_mean = mean(tsss),
    tss_sd = sd(tsss),
    per_algorithm = eval_df
  ),
  covariates = names(pred_stack),
  variable_importance = varimp_df,
  binary_metrics = NULL,
  model_id = "biomod2",
  modeling_id = unique_id  # unique per-run identifier
)
```

## Predict Contract (IMPLEMENTED)

```r
predict_biomod2_suitability <- function(fit, env_project_scaled, output_tif, n_cores, log_fun) {
  # 1. Resolve the exact full-data model name for EVERY requested algorithm
  #    (CV Off: _allData_RUN1_<ALGO>; k-fold: _allData_allRun_<ALGO>).
  #    Any missing requested model is an error; fold models are never used.
  # 2. BIOMOD_Projection(models.chosen = those names) from the fit's directory.
  # 3. get_predictions() / 1000, equal-weight arithmetic mean, 0-1 scale.
  # 4. Write output_tif if given; return a single-layer SpatRaster.
}
```

Multi-model ensemble biomod2 components use the same predictor with that
component's single algorithm.

## Bug Fixes Applied (v0.5-beta)

- [x] Removed `library(biomod2)` inside function — use `biomod2::` prefix throughout
- [x] Fixed `set.seed(background_n)` → `set.seed(sdm_default_seed)`
- [x] Fixed `modeling.id = 'sdm_dash'` collision → unique id: `paste0("sdm_", safe_slug(sp_name), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))`
- [x] Removed fragile rangebag `source()`+`exists()` guards — `fit_rangebag_sdm()` is always loaded

## Working Files Location (IMPLEMENTED)

biomod2 working files go to a unique `tempfile("biomod2-run-")` directory per fit.
This prevents pollution of the project root and cross-run collisions.

## Version Compatibility

Native CPU tests ran against biomod2 4.3-4-6 only. API varies across versions (4.3
removed `BIOMOD_Projection(output.dir=)`); real Windows testing is still needed.

## Next Steps for Phase B

- [ ] Real Windows runtime testing
- [ ] Test biomod2's MAXNET against standalone maxnet (parity test)
- [ ] Add GBM, MARS, BRT, XGBOOST behind feature flags (after Windows testing)
- [ ] Add uncertainty computation (standard deviation across algorithms)

## Risks

- biomod2 return object slots/classes vary by version.
- MAXNET may need extra platform-specific package handling.
- Projection extraction needs real runtime validation before exposing in the app.
- Advanced install path may be too heavy for the default Plumber image.