# P1-05 acceptance oracle: MESS empirical-percentile semantics, tails,
# units/transforms, missing and constant predictors, per-variable outputs,
# and the actual mask applied to the projection.
#
# Every expected value below is hand-derived from the documented dismo
# .messi3 semantics implemented in compute_mess:
#   f    = 100 * #{training values <= p} / n      (right-closed percentile)
#   f == 0        -> 100 * (p - min) / (max - min)          (below range)
#   f == 100      -> 100 * (max - p) / (max - min)          (above range)
#   50 < f < 100  -> 200 - 2 * f
#   0 < f <= 50   -> 2 * f
# A constant predictor (zero training range) scores 100 on exact match and
# -100 on any mismatch. All values are in [-100, 100]; negatives are
# extrapolation.

test_that("MESS matches the hand-computed percentile oracle across both tails and the middle", {
  skip_if_not_installed("terra")
  train <- data.frame(bio1 = 1:10)
  proj <- terra::rast(nrows = 1, ncols = 5)
  names(proj) <- "bio1"
  # p=1   -> f=10  -> 2f = 20
  # p=5   -> f=50  -> 2f = 100 (midpoint maximum)
  # p=10  -> f=100 -> upper tail 100*(10-10)/9 = 0 (range boundary)
  # p=0.5 -> f=0   -> 100*(0.5-1)/9 = -50/9 (below range)
  # p=11  -> f=100 -> 100*(10-11)/9 = -100/9 (above range)
  terra::values(proj) <- c(1, 5, 10, 0.5, 11)
  result <- compute_mess(train, proj)
  expect_equal(as.numeric(terra::values(result$per_variable$bio1)),
               c(20, 100, 0, -50 / 9, -100 / 9), tolerance = 1e-8)
  expect_equal(as.numeric(terra::values(result$mess)),
               c(20, 100, 0, -50 / 9, -100 / 9), tolerance = 1e-8)
  expect_equal(result$pct_extrapolation, 2 / 5, tolerance = 1e-8)
  expect_equal(result$train_ranges$bio1, c(min = 1, max = 10))
})

test_that("MESS is invariant to the same affine transform on training and projection", {
  # Standardization (raw - mean) / sd is a positive affine map applied to both
  # rasters; MESS depends on order statistics only, so scaled-space MESS (what
  # run_sdm computes) must equal raw-unit MESS exactly.
  skip_if_not_installed("terra")
  train <- data.frame(bio1 = seq(0, 100, by = 10))
  proj <- terra::rast(nrows = 1, ncols = 4)
  names(proj) <- "bio1"
  terra::values(proj) <- c(-5, 50, 105, 30)
  a <- 0.1   # sd-like scale
  b <- 5     # mean-like shift
  train_scaled <- data.frame(bio1 = a * train$bio1 + b)
  proj_scaled <- terra::rast(nrows = 1, ncols = 4)
  names(proj_scaled) <- "bio1"
  terra::values(proj_scaled) <- a * as.numeric(terra::values(proj)) + b
  raw_result <- compute_mess(train, proj)
  scaled_result <- compute_mess(train_scaled, proj_scaled)
  expect_equal(as.numeric(terra::values(scaled_result$mess)),
               as.numeric(terra::values(raw_result$mess)), tolerance = 1e-8)
  # Known answers for the raw-unit fixture: train 0..100 step 10.
    # p=-5  -> f=0     -> 100*(-5-0)/100 = -5
    # p=50  -> f=6/11  -> 50 < f < 100 -> 200 - 1200/11 = 1000/11 (~90.9)
    # p=105 -> f=11/11 -> upper tail 100*(100-105)/100 = -5
    # p=30  -> f=4/11  -> 2f = 800/11 (~72.7)
    expect_equal(as.numeric(terra::values(raw_result$mess)),
                 c(-5, 1000 / 11, -5, 800 / 11), tolerance = 1e-8)
})

test_that("MESS per-variable values combine by cellwise minimum", {
  skip_if_not_installed("terra")
  train <- data.frame(constant = rep(5, 3), varying = c(0, 10, 20))
  proj <- terra::rast(nrows = 1, ncols = 3)
  proj <- c(proj, proj)
  names(proj) <- c("constant", "varying")
  terra::values(proj) <- cbind(c(5, 6, 5), c(10, NA, 15))
  result <- compute_mess(train, proj)
  # constant var (zero training range): exact match 100, mismatch -100.
  expect_equal(as.numeric(terra::values(result$per_variable$constant)),
               c(100, -100, 100), tolerance = 1e-8)
  # varying var, train {0,10,20}:
  # p=10 -> f=1/3  -> 2/3*100 = 200/3
  # p=NA -> NA
  # p=15 -> f=2/3  -> 50 < f < 100 -> 200 - 400/3 = 200/3
  expect_equal(as.numeric(terra::values(result$per_variable$varying)),
               c(200 / 3, NA_real_, 200 / 3), tolerance = 1e-8)
  # Overall MESS = cellwise min over available variables; a cell where one
  # variable is NA uses the finite ones (documented repo semantics; dismo's
  # min() would propagate NA — deviation recorded in the review notes).
  expect_equal(as.numeric(terra::values(result$mess)),
               c(200 / 3, -100, 200 / 3), tolerance = 1e-8)
})

test_that("MESS keeps cells assessable when a training variable has no finite values", {
  skip_if_not_installed("terra")
  train <- data.frame(bad = c(NA_real_, NA_real_), good = c(0, 10))
  proj <- terra::rast(nrows = 1, ncols = 3)
  proj <- c(proj, proj)
  names(proj) <- c("bad", "good")
  terra::values(proj) <- cbind(c(1, 2, 3), c(0, 5, 10))
  result <- compute_mess(train, proj)
  # The all-NA training variable yields NA scores and an NA range; the good
  # variable is unaffected.
  expect_true(all(is.na(terra::values(result$per_variable$bad))))
  expect_equal(result$train_ranges$bad, c(min = NA_real_, max = NA_real_))
  expect_equal(as.numeric(terra::values(result$per_variable$good)),
               c(100, 100, 0), tolerance = 1e-8)
  expect_equal(as.numeric(terra::values(result$mess)),
               as.numeric(terra::values(result$per_variable$good)), tolerance = 1e-8)
})

test_that("future mask keeps cells exactly at the MESS threshold (strict inequality)", {
  skip_if_not_installed("terra")
  old_files <- future_projection_files
  old_validate <- validate_biovars
  old_loader <- cmip6_load_future_covariates
  old_predict <- predict_sdm_model
  on.exit({
    future_projection_files <<- old_files
    validate_biovars <<- old_validate
    cmip6_load_future_covariates <<- old_loader
    predict_sdm_model <<- old_predict
  }, add = TRUE)

  validate_biovars <<- function(x) as.integer(x)
  future_projection_files <<- function(...) c(bio1 = "synthetic-future.tif")
  # Raw future values 10 and 11 with training mean 5, sd 5 -> scaled 1 and 1.2.
  cmip6_load_future_covariates <<- function(...) {
    r <- terra::rast(nrows = 1, ncols = 2)
    names(r) <- "bio1"
    terra::values(r) <- c(10, 11)
    list(env_future = r)
  }
  predict_sdm_model <<- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    r <- env_project_scaled[[1]]
    terra::values(r) <- 0.9
    names(r) <- "suitability"
    r
  }

  raw_train <- terra::rast(nrows = 1, ncols = 2)
  names(raw_train) <- "bio1"
  terra::values(raw_train) <- c(0, 10)
  raw_project <- raw_train
  scaled_train <- raw_train
  terra::values(scaled_train) <- c(-1, 1)
  current <- raw_project
  terra::values(current) <- 0.2
  out <- tempfile("mess-boundary-")
  dir.create(out)
  future_tif <- file.path(out, "species_future_suitability.tif")
  delta_tif <- file.path(out, "species_future_delta.tif")
  env <- list(env_project = raw_project, env_train = raw_train,
              env_train_scaled = scaled_train, means = c(bio1 = 5), sds = c(bio1 = 5))

  result <- project_future_suitability(
    fit = list(model_id = "glm", model = list()), current_suitability = current,
    env = env, future_worldclim_dir = out, selected_biovars = 1,
    projection_extent = c(0, 2, 0, 1), output_future_tif = future_tif,
    output_delta_tif = delta_tif, n_cores = 1, mask_extrapolation = TRUE,
    mess_threshold = 0, mess_train_data = scaled_train
  )

  # Scaled train {-1, 1}: scaled 1 -> f=100 -> 100*(1-1)/2 = 0 (at threshold,
  # kept); scaled 1.2 -> f=100 -> 100*(1-1.2)/2 = -10 < 0 (masked).
  expect_equal(as.numeric(terra::values(result$suitability)), c(0.9, NA_real_), tolerance = 1e-8)
  expect_equal(as.numeric(terra::values(result$delta)), c(0.7, NA_real_), tolerance = 1e-8)
  expect_equal(result$mess$masked_cells, 1L)
  expect_true(result$mess$mask_applied)
  expect_equal(result$mess$mask_threshold, 0)
  # The exported raster carries the same mask as the returned object.
  expect_true(all(is.na(terra::values(terra::rast(future_tif))[2])))
  expect_false(is.na(terra::values(terra::rast(future_tif))[1]))
  expect_true(all(is.na(terra::values(terra::rast(delta_tif))[2])))
})