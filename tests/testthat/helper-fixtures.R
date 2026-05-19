# Shared test fixtures and helpers for smoke tests and testthat suite.

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
