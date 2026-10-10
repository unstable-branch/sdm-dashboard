## A biomod2 algorithm selected inside the multi-model ensemble must be projected
## from its own full-data model. It must never fail prediction and be silently
## dropped from the ensemble.

## Independent oracle: the named full model's formal model predicted directly.
biomod2_formal_prediction <- function(fit, full_name, env) {
  bm <- fit$model
  path <- file.path(bm@dir.name, bm@sp.name, "models", bm@modeling.id, full_name)
  stopifnot(file.exists(path))
  holder <- new.env()
  obj <- get(load(path, envir = holder), envir = holder)
  formal <- biomod2::get_formal_model(obj)
  as.numeric(stats::predict(formal, newdata = as.data.frame(env, na.rm = FALSE),
                            type = "response"))
}

test_that("multi-ensemble projects biomod2 components from their full-data models", {
  skip_if_not_installed("biomod2")
  skip_if_not_installed("R.utils")
  withr::local_options(list(sdm.enable_biomod2 = TRUE))

  set.seed(42)
  r <- terra::rast(nrows = 30, ncols = 30, xmin = 0, xmax = 30,
                   ymin = 0, ymax = 30, crs = "EPSG:4326", nlyrs = 2)
  terra::values(r) <- matrix(rnorm(terra::ncell(r) * 2L), ncol = 2L)
  names(r) <- c("bio1", "bio12")
  xy <- terra::xyFromCell(r, seq(5L, 880L, length.out = 40L))
  occ <- data.frame(species = "SyntheticCaller", longitude = xy[, 1], latitude = xy[, 2])
  previous_wd <- getwd()

  fit <- fit_multi_model_ensemble(
    occ, r, selected_models = c("glm", "biomod2"), biomod2_models = "GLM",
    ensemble_weighting = "equal", background_n = 300L, include_quadratic = FALSE,
    cv_folds = 3L, cv_strategy = "random", seed = 42L, n_cores = 1L
  )
  expect_identical(getwd(), previous_wd)
  expect_true("biomod2.GLM" %in% names(fit$model$components))

  logs <- character()
  out_tif <- tempfile("ens-", fileext = ".tif")
  on.exit(unlink(Sys.glob(sub("[.]tif$", "*", out_tif))), add = TRUE)
  pred <- predict_multi_model_ensemble(fit, r, out_tif, n_cores = 1L,
    log_fun = function(...) logs <<- c(logs, paste0(...)),
    export_components = TRUE, ensemble_weighting = "equal")
  expect_identical(getwd(), previous_wd)
  expect_false(any(grepl("failed prediction|prediction failed", logs)),
    info = paste(logs, collapse = "\n"))

  comp_path <- attr(pred, "component_paths")[["biomod2.GLM"]]
  expect_false(is.null(comp_path))
  comp <- terra::rast(comp_path)
  sp <- fit$biomod2_fit$model@sp.name
  full <- paste0(sp, "_allData_allRun_GLM")
  expected <- biomod2_formal_prediction(fit$biomod2_fit, full, r)
  vals <- as.numeric(terra::values(comp))
  expect_true(all(vals >= 0 & vals <= 1, na.rm = TRUE))
  expect_lt(max(abs(vals - expected), na.rm = TRUE), 1e-3)

  # A requested biomod2 component whose full-data model cannot be projected is
  # an ensemble error, never a silent drop to the remaining components.
  broken <- fit
  broken$model$components[["biomod2.GLM"]]$algorithm <- "RF"
  expect_error(
    predict_multi_model_ensemble(broken, r, tempfile("ens-broken-", fileext = ".tif"),
      n_cores = 1L, ensemble_weighting = "equal"),
    "biomod2.GLM"
  )
  expect_identical(getwd(), previous_wd)
})
