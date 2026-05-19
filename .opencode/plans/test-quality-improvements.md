# Implementation Plan: Test Quality Improvements (8 Items)

## Item 1: Shared test fixtures
**New file:** `tests/testthat/helper-fixtures.R`

```r
make_synthetic_occurrence <- function(path = NULL, n_pres = 24, seed = 42L) {
  set.seed(seed)
  occ <- data.frame(
    species = "Synthetic species",
    decimalLongitude = seq(140.15, 141.85, length.out = n_pres),
    decimalLatitude = seq(-23.85, -22.15, length.out = n_pres),
    institutionCode = rep(c("Museum A", "Museum B"), each = n_pres / 2),
    countryCode = "AU",
    stringsAsFactors = FALSE
  )
  if (!is.null(path)) utils::write.csv(occ, path, row.names = FALSE)
  occ
}

make_test_raster <- function(xmin = 140, xmax = 142, ymin = -24, ymax = -22,
                             nrows = 20, ncols = 20, n_layers = 2,
                             layer_names = NULL, seed = 42L) {
  set.seed(seed)
  if (is.null(layer_names))
    layer_names <- paste0("bio", c(1, 12, 4, 7, 15, 19)[seq_len(n_layers)])
  rasters <- lapply(seq_len(n_layers), function(i) {
    r <- terra::rast(nrows = nrows, ncols = ncols,
                     xmin = xmin, xmax = xmax, ymin = ymin, ymax = ymax)
    terra::values(r) <- runif(terra::ncell(r), 0, 1)
    r
  })
  stack <- do.call(c, rasters)
  names(stack) <- layer_names
  stack
}

make_mock_fit <- function(model_id = "glm", env_train = NULL,
                          n_pres = 24, n_bg = 100) {
  covariates <- if (!is.null(env_train)) names(env_train) else c("bio1", "bio12")
  list(
    model_id = model_id, model_label = paste(model_id, "test"),
    model_method = "test", model = list(coef = rep(0.1, length(covariates))),
    covariates = covariates,
    cv = list(auc_mean = 0.75, tss_mean = 0.45, auc_sd = 0.05),
    occurrence_used = data.frame(
      longitude = runif(n_pres, 140, 142), latitude = runif(n_pres, -24, -22),
      presence = 1),
    background_xy = cbind(runif(n_bg, 140, 142), runif(n_bg, -24, -22))
  )
}

make_test_fit <- function(occ, env, seed = 42L) {
  if (!requireNamespace("terra", quietly = TRUE)) return(NULL)
  set.seed(seed)
  tryCatch(
    fit_sdm_model("glm", occ, env, background_n = 80, include_quadratic = FALSE,
                  cv_folds = 2, seed = seed, n_cores = 1),
    error = function(e) NULL)
}
```

## Item 2: Split smoke_test.R into tagged runner
**Refactor:** `scripts/smoke_test.R` — full rewrite with:
- `--tags=fast,heavy,ensemble,esm,batch` CLI argument
- `fast` tag: parse check + function existence + helper assertions (<5s)
- `heavy` tag: all model-fitting tests
- `on.exit()` cleanup on multi_ensemble and ESM tests
- Uses `make_synthetic_occurrence()` from helper-fixtures

## Item 3: Ecology module tests
**New file:** `tests/testthat/test-ecology.R`
- `compute_eoo_aoo()` — EOO/AOO with known coords
- `compute_climate_match()` — train vs projected climate similarity
- `compute_niche_overlap_pca()` — synthetic native vs introduced ranges
- `stack_species_richness()` — multi-raster threshold stacking
- `compute_aoa_weighted()` — area of applicability

## Item 4: RF contract test
**New file:** `tests/testthat/test-rf-contract.R`
- `skip_if_not_installed("ranger")`
- Tests fit → predict → output raster through registry

## Item 5: XGBoost contract test
**New file:** `tests/testthat/test-xgboost-contract.R`
- `skip_if_not_installed("xgboost")`
- Same pattern as RF

## Item 6: Extend DNN conditional tests
**Update:** `tests/testthat/test-dnn.R`
- Add fit/predict contract test (skip if cito/torch missing)
- Test `prepare_dnn_data` output structure
- Test registry entry presence/absence

## Item 7: Script export roundtrip test
**New file:** `tests/testthat/test-script-export.R`
- Create mock result object
- Call `export_run_script()` → verify valid R script produced
- Parse the generated script to verify syntax

## Item 8: Calibration plot test
**New file:** `tests/testthat/test-calibration.R`
- Test `compute_calibration()` with GLM fit
- Test `plot_calibration()` returns ggplot object
- Test empty data edge case

## Verification
- Parse check: all R sources parse
- Smoke test: `Rscript scripts/smoke_test.R` passes
- Testthat: `Rscript tests/testthat.R` passes
