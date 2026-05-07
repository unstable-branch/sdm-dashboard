# biomod2 Adapter Notes

`biomod2` should remain optional and non-default until it has been tested on a real R runtime, especially Windows.

## Gating (IMPLEMENTED)

- Do NOT add `biomod2` to base `sdm_setup_packages`.
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
  # 1. BIOMOD_Projection(bm.mod = fit$model, new.env = env_project_scaled, proj.name = ..., output.dir = ...)
  # 2. BIOMOD_EnsembleForecasting() when ensemble model exists
  # 3. Extract final raster, write to output_tif, return SpatRaster
}
```

## Bug Fixes Applied (v0.5-beta)

- [x] Removed `library(biomod2)` inside function — use `biomod2::` prefix throughout
- [x] Fixed `set.seed(background_n)` → `set.seed(sdm_default_seed)`
- [x] Fixed `modeling.id = 'sdm_dash'` collision → unique id: `paste0("sdm_", safe_slug(sp_name), "_", format(Sys.time(), "%Y%m%d_%H%M%S"))`
- [x] Removed fragile rangebag `source()`+`exists()` guards — `fit_rangebag_sdm()` is always loaded

## Working Files Location (IMPLEMENTED)

biomod2 working files are now directed to `tempdir()` under a unique subdirectory per run.
This prevents pollution of the project root.

## Version Compatibility

Tested with biomod2 v4.2+. API may vary across versions — the `requireNamespace` gate
prevents loading a broken version, but real Windows testing is still needed.

## Next Steps for Phase B

- [ ] Real Windows runtime testing
- [ ] Test biomod2's MAXNET against standalone maxnet (parity test)
- [ ] Add GBM, MARS, BRT, XGBOOST behind feature flags (after Windows testing)
- [ ] Add uncertainty computation (standard deviation across algorithms)

## Risks

- biomod2 return object slots/classes vary by version.
- MAXNET may need extra platform-specific package handling.
- Projection extraction needs real runtime validation before exposing in the app.
- Advanced install path may be too heavy for the Windows-ready beta archive.