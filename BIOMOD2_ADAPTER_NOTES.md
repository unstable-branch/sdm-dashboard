# biomod2 Adapter Notes

`biomod2` should remain optional and non-default until it has been tested on a real R runtime, especially Windows.

## Proposed gating

- Do not add `biomod2` to base `sdm_setup_packages`.
- Add an advanced package group later, e.g. `sdm_advanced_model_packages <- c("biomod2", "maxnet")`.
- Register a biomod2 backend only when both are true:
  - `requireNamespace("biomod2", quietly = TRUE)`
  - `isTRUE(getOption("sdm.enable_biomod2", FALSE))`

## Fit contract mapping

Current `fit_sdm_model()` expects a list containing at least:

- `model`
- `formula` or `NULL`
- `coefficients` or `NULL`
- `model_data` or summary metadata
- `occurrence_used`
- `background_xy`
- `cv`
- optional `binary_metrics`

biomod2 draft fit flow:

1. Convert cleaned presences to `resp.xy` and `resp.var`.
2. Pass environmental stack as `expl.var` to `BIOMOD_FormatingData()`.
3. Use pseudo-absence selection with controlled seed and count matching the app setting.
4. Run `BIOMOD_Modeling()` with a small initial model set: `GLM`, `GAM`, `MAXNET`, `RF` if installed and stable.
5. Use metrics `AUCroc`, `TSS`, and later Boyce if verified for the selected data path.
6. Run `BIOMOD_EnsembleModeling()` for consensus output.
7. Store biomod2 working files under ignored output/cache folders, never repo root.

## Predict contract mapping

Current `predict_sdm_model()` expects a function that accepts:

```r
predict_fun(fit, env_project_scaled, output_tif, n_cores, log_fun)
```

biomod2 projection flow:

1. `BIOMOD_Projection(bm.mod = fit$model, new.env = env_project_scaled, ...)`
2. `BIOMOD_EnsembleForecasting()` when ensemble model exists.
3. Extract final ensemble suitability as `terra::SpatRaster`.
4. Write to `output_tif` and return the raster, matching current backends.

## Risks

- biomod2 return object slots/classes vary by version.
- MAXNET may need extra platform-specific package handling.
- Projection extraction needs real runtime validation before exposing in the app.
- Advanced install path may be too heavy for the Windows-ready beta archive.

## Next step

Build `R/model_biomod2.R` only after a fresh-library install test is available. Keep GLM as the default baseline.
