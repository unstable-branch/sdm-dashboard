## Native biomod2 GLM+GAM full-data projection contract.
## Owner policy: the suitability map is the arithmetic mean of ALL requested
## algorithms' FULL-DATA predictions on the 0-1 scale. Fold models must never be
## substituted, and a missing requested full model is an error.

biomod2_projection_fixture <- function() {
  set.seed(42)
  r <- terra::rast(nrows = 12, ncols = 12, xmin = 0, xmax = 12,
                   ymin = 0, ymax = 12, crs = "EPSG:4326", nlyrs = 2)
  terra::values(r) <- matrix(rnorm(terra::ncell(r) * 2L), ncol = 2L)
  names(r) <- c("bio1", "bio12")
  na_cells <- 141:144
  r[na_cells] <- NA
  xy <- terra::xyFromCell(r, seq(2L, 120L, length.out = 30L))
  occ <- data.frame(species = "SyntheticCaller", longitude = xy[, 1], latitude = xy[, 2])
  list(r = r, occ = occ, na_cells = na_cells)
}

## Independent oracle: predict each named biomod2 model's underlying formal
## model directly on the raster cell table, without BIOMOD_Projection.
biomod2_formal_prediction <- function(fit, full_name, env) {
  bm <- fit$model
  path <- file.path(bm@dir.name, bm@sp.name, "models", bm@modeling.id, full_name)
  stopifnot(file.exists(path))
  holder <- new.env()
  obj <- get(load(path, envir = holder), envir = holder)
  formal <- biomod2::get_formal_model(obj)
  cells <- as.data.frame(env, na.rm = FALSE)
  as.numeric(stats::predict(formal, newdata = cells, type = "response"))
}

biomod2_mean_oracle <- function(fit, names, env) {
  preds <- vapply(names, function(n) biomod2_formal_prediction(fit, n, env),
                  numeric(terra::ncell(env)))
  rowMeans(preds)
}

test_that("biomod2 projection is the equal-weight mean of full-data GLM+GAM models", {
  skip_if_not_installed("biomod2")
  skip_if_not_installed("R.utils")
  skip_if_not_installed("mgcv")

  fx <- biomod2_projection_fixture()
  previous_wd <- getwd()
  out_dir <- tempfile("biomod2-proj-out-")
  dir.create(out_dir)
  on.exit(unlink(out_dir, recursive = TRUE), add = TRUE)
  on.exit(setwd(previous_wd), add = TRUE)

  cases <- list(off = 0L, k3 = 3L)
  fits <- list()
  for (case in names(cases)) {
    k <- cases[[case]]
    fit <- fit_biomod2_sdm(fx$occ, fx$r, background_n = 30L, cv_folds = k,
                           seed = 42L, models = c("GLM", "GAM"))
    expect_identical(getwd(), previous_wd)
    fits[[case]] <- fit
    sp <- fit$model@sp.name
    full_run <- if (k == 0L) "_allData_RUN1_" else "_allData_allRun_"
    full_names <- paste0(sp, full_run, c("GLM", "GAM"))
    expect_true(all(full_names %in% biomod2::get_built_models(fit$model)))

    expected <- biomod2_mean_oracle(fit, full_names, fx$r)
    expected[fx$na_cells] <- NA_real_

    out_tif <- file.path(out_dir, paste0(case, ".tif"))
    got <- predict_biomod2_suitability(fit, fx$r, out_tif)
    expect_identical(getwd(), previous_wd)

    expect_s4_class(got, "SpatRaster")
    expect_equal(terra::nlyr(got), 1L)
    expect_true(terra::compareGeom(got, fx$r, stopOnError = FALSE))
    vals <- as.numeric(terra::values(got))
    expect_identical(which(is.na(vals)), fx$na_cells)
    expect_true(all(vals[!is.na(vals)] >= 0 & vals[!is.na(vals)] <= 1))
    # biomod2 stores each layer as round(p * 1000); allow that quantisation only.
    expect_lt(max(abs(vals - expected), na.rm = TRUE), 1e-3)

    expect_true(file.exists(out_tif))
    saved <- terra::rast(out_tif)
    expect_true(terra::compareGeom(saved, fx$r, stopOnError = FALSE))
    expect_equal(as.numeric(terra::values(saved)), vals, tolerance = 1e-6)

    if (k > 0L) {
      # Fold RUN1 models exist for k-fold and must not be what was averaged.
      fold_names <- paste0(sp, "_allData_RUN1_", c("GLM", "GAM"))
      fold_mean <- biomod2_mean_oracle(fit, fold_names, fx$r)
      expect_gt(max(abs(vals - fold_mean), na.rm = TRUE), 1e-2)
    }
  }

  # Independent runs must not share a model workspace.
  expect_false(identical(
    normalizePath(file.path(fits$off$model@dir.name, fits$off$model@sp.name)),
    normalizePath(file.path(fits$k3$model@dir.name, fits$k3$model@sp.name))
  ))

  # A requested algorithm without a full-data model is an error, never a
  # silent mean of the remaining algorithms.
  broken <- fits$k3
  broken$algorithms <- c("GLM", "GAM", "RF")
  expect_error(predict_biomod2_suitability(broken, fx$r, NULL), "RF")
})
