test_that("compute_mess identifies extrapolation correctly", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  train_rast[] <- 1:100

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = -5, xmax = 15, ymin = 0, ymax = 10)
  proj_rast[] <- rep_len(c(1:80, 101:120), length.out = 100)

  result <- compute_mess(train_rast, proj_rast)

  expect_true(inherits(result$mess, "SpatRaster"))
  expect_true("pct_extrapolation" %in% names(result))
  expect_true(result$pct_extrapolation > 0)
})

test_that("compute_mess returns per_variable layers", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_rast) <- "var1"
  train_rast[] <- 1:100

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_rast) <- "var1"
  proj_rast[] <- 1:100

  result <- compute_mess(train_rast, proj_rast)

  expect_true(is.list(result$per_variable))
  expect_true("var1" %in% names(result$per_variable))
})

test_that("compute_mod returns variable indices", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  train_rast <- c(train_rast, train_rast)
  names(train_rast) <- c("var1", "var2")
  terra::values(train_rast) <- cbind(1:100, 101:200)

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = -5, xmax = 15, ymin = 0, ymax = 10)
  proj_rast <- c(proj_rast, proj_rast)
  names(proj_rast) <- c("var1", "var2")
  terra::values(proj_rast) <- cbind(rep_len(1:100, length.out = 100), rep_len(101:200, length.out = 100))

  mess_result <- compute_mess(train_rast, proj_rast)
  mod_raster <- compute_mod(mess_result$per_variable)

  expect_true(inherits(mod_raster, "SpatRaster"))
  expect_true(names(mod_raster) == "MOD")
})

test_that("compute_mess handles zero range gracefully", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_rast) <- "constant"
  train_rast[] <- 5  # constant value, zero range

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_rast) <- "constant"
  proj_rast[] <- 5

  result <- compute_mess(train_rast, proj_rast)
  expect_true(inherits(result$mess, "SpatRaster"))
})

test_that("compute_mess errors on mismatched variables", {
  skip_if_not_installed("terra")

  train_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(train_rast) <- "var1"

  proj_rast <- terra::rast(nrows = 10, ncols = 10, xmin = 0, xmax = 10, ymin = 0, ymax = 10)
  names(proj_rast) <- "var2"  # different name

  expect_error(compute_mess(train_rast, proj_rast), "same variable names")
})

test_that("compute_mess follows dismo empirical-percentile semantics in both tails", {
  skip_if_not_installed("terra")
  train <- data.frame(bio1 = c(0, 10))
  proj <- terra::rast(nrows = 1, ncols = 6)
  names(proj) <- "bio1"
  terra::values(proj) <- c(-1, 0, 5, 10, 11, NA)

  result <- compute_mess(train, proj)
  expect_equal(as.numeric(terra::values(result$mess)), c(-10, 100, 100, 0, -10, NA_real_), tolerance = 1e-8)
  expect_equal(result$pct_extrapolation, 2 / 5, tolerance = 1e-8)
})

test_that("compute_mess handles constant predictors and missing multivariate cells", {
  skip_if_not_installed("terra")
  train <- data.frame(constant = rep(5, 3), varying = c(0, 10, 20))
  proj <- terra::rast(nrows = 1, ncols = 3)
  proj <- c(proj, proj)
  names(proj) <- c("constant", "varying")
  terra::values(proj) <- cbind(c(5, 6, 5), c(10, NA, 15))

  result <- compute_mess(train, proj)
  expect_equal(as.numeric(terra::values(result$per_variable$constant)), c(100, -100, NA_real_), tolerance = 1e-8)
  expect_equal(as.numeric(terra::values(result$mess)), c(200 / 3, -100, 200 / 3), tolerance = 1e-8)
  expect_true(all(is.na(terra::values(result$mess)[2])))
})

test_that("future projection masks exported suitability and delta at strict MESS threshold", {
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
  cmip6_load_future_covariates <<- function(...) {
    r <- terra::rast(nrows = 1, ncols = 3)
    names(r) <- "bio1"
    terra::values(r) <- c(-1, 5, 11)
    list(env_future = r)
  }
  predict_sdm_model <<- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    r <- env_project_scaled[[1]]
    terra::values(r) <- 0.8
    names(r) <- "suitability"
    r
  }

  raw_train <- terra::rast(nrows = 1, ncols = 2)
  names(raw_train) <- "bio1"
  terra::values(raw_train) <- c(0, 10)
  raw_project <- terra::rast(nrows = 1, ncols = 3)
  names(raw_project) <- "bio1"
  terra::values(raw_project) <- c(0, 5, 10)
  scaled_train <- raw_train
  terra::values(scaled_train) <- c(-1, 1)
  current <- raw_project
  terra::values(current) <- 0.2
  out <- tempfile("mess-mask-")
  dir.create(out)
  future_tif <- file.path(out, "species_future_suitability.tif")
  delta_tif <- file.path(out, "species_future_delta.tif")
  env <- list(env_project = raw_project, env_train = raw_train,
              env_train_scaled = scaled_train, means = c(bio1 = 5), sds = c(bio1 = 5))

  result <- project_future_suitability(
    fit = list(model_id = "glm", model = list()), current_suitability = current,
    env = env, future_worldclim_dir = out, selected_biovars = 1,
    projection_extent = c(0, 3, 0, 1), output_future_tif = future_tif,
    output_delta_tif = delta_tif, n_cores = 1, mask_extrapolation = TRUE,
    mess_threshold = 0, mess_train_data = scaled_train
  )

  expect_equal(as.numeric(terra::values(result$suitability)), c(NA_real_, 0.8, NA_real_), tolerance = 1e-8)
  expect_equal(as.numeric(terra::values(result$delta)), c(NA_real_, 0.6, NA_real_), tolerance = 1e-8)
  expect_equal(result$mess$masked_cells, 2L)
  expect_true(result$mess$mask_applied)
  expect_equal(result$summary$cell_count, 1)
  expect_true(file.exists(future_tif))
  expect_true(file.exists(delta_tif))
  expect_true(all(is.na(terra::values(terra::rast(future_tif))[c(1, 3)])))
  expect_true(all(is.na(terra::values(terra::rast(delta_tif))[c(1, 3)])))
})

test_that("future MESS uses post-VIF predictor names", {
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
  future_projection_files <<- function(...) c(bio1 = "bio1.tif", bio12 = "bio12.tif")
  cmip6_load_future_covariates <<- function(...) {
    r <- terra::rast(nrows = 1, ncols = 2)
    r <- c(r, r)
    names(r) <- c("bio1", "bio12")
    terra::values(r) <- cbind(c(0, 10), c(100, 200))
    list(env_future = r)
  }
  predict_sdm_model <<- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    r <- env_project_scaled[[1]]
    terra::values(r) <- 0.7
    names(r) <- "suitability"
    r
  }
  raw_train <- terra::rast(nrows = 1, ncols = 2)
  raw_train <- c(raw_train, raw_train)
  names(raw_train) <- c("bio1", "bio12")
  terra::values(raw_train) <- cbind(c(0, 10), c(100, 200))
  raw_project <- raw_train
  scaled_train <- raw_train[["bio1"]]
  names(scaled_train) <- "bio1"
  terra::values(scaled_train) <- c(-1, 1)
  current <- raw_project[["bio1"]]
  terra::values(current) <- 0.2
  out <- tempfile("mess-vif-")
  dir.create(out)
  env <- list(env_project = raw_project, env_train = raw_train,
              env_train_scaled = scaled_train, means = c(bio1 = 5), sds = c(bio1 = 5))
  result <- project_future_suitability(
    list(model_id = "glm", model = list()), current, env, out, 1,
    c(0, 2, 0, 1), output_future_tif = file.path(out, "vif_future_suitability.tif"),
    output_delta_tif = file.path(out, "vif_future_delta.tif"), n_cores = 1,
    mask_extrapolation = FALSE, mess_train_data = scaled_train
  )
  expect_true(inherits(result$mess, "list"))
  expect_true(file.exists(result$paths$mess_tif))
  expect_equal(names(result$suitability), "suitability")
  expect_equal(result$mess$masked_cells, 0L)
})

test_that("MESS and MOD exports remain distinct for both future scenarios", {
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
  future_projection_files <<- function(...) c(bio1 = "bio1.tif")
  cmip6_load_future_covariates <<- function(...) {
    r <- terra::rast(nrows = 1, ncols = 2)
    names(r) <- "bio1"
    terra::values(r) <- c(0, 10)
    list(env_future = r)
  }
  predict_sdm_model <<- function(fit, env_project_scaled, output_tif, n_cores = 1, log_fun = NULL) {
    r <- env_project_scaled[[1]]
    terra::values(r) <- 0.5
    names(r) <- "suitability"
    r
  }
  train <- terra::rast(nrows = 1, ncols = 2)
  names(train) <- "bio1"
  terra::values(train) <- c(-1, 1)
  project <- terra::rast(nrows = 1, ncols = 2)
  names(project) <- "bio1"
  terra::values(project) <- c(0, 10)
  out <- tempfile("mess-two-scenarios-")
  dir.create(out)
  env <- list(env_project = project, env_train_scaled = train,
              means = c(bio1 = 5), sds = c(bio1 = 5))
  fit <- list(model_id = "glm", model = list())
  current <- project
  terra::values(current) <- 0.2
  first <- project_future_suitability(fit, current, env, out, 1, c(0, 2, 0, 1),
    output_future_tif = file.path(out, "sp_future_suitability.tif"),
    output_delta_tif = file.path(out, "sp_future_delta.tif"), mask_extrapolation = FALSE,
    mess_train_data = train)
  second <- project_future_suitability(fit, current, env, out, 1, c(0, 2, 0, 1),
    output_future_tif = file.path(out, "sp_future2_suitability.tif"),
    output_delta_tif = file.path(out, "sp_future2_delta.tif"), mask_extrapolation = FALSE,
    mess_train_data = train)
  expect_match(first$paths$mess_tif, "sp_future_mess\\\\.tif$")
  expect_match(second$paths$mess_tif, "sp_future2_mess\\\\.tif$")
  expect_false(identical(first$paths$mess_tif, second$paths$mess_tif))
  expect_true(file.exists(first$paths$mess_tif))
  expect_true(file.exists(first$paths$mod_tif))
  expect_true(file.exists(second$paths$mess_tif))
  expect_true(file.exists(second$paths$mod_tif))
})

test_that("CPU and GPU MESS paths share the empirical dismo fixture", {
  skip_if_not_installed("terra")
  skip_if_not_installed("torch")
  skip_if_not(exists("sdm_use_gpu_for", mode = "function"))
  if (!isTRUE(sdm_use_gpu_for(1, min_n = 1))) skip("No executable accelerator available")

  old_enabled <- config$gpu_enabled
  old_min <- config$gpu_min_cells
  on.exit({ config$gpu_enabled <- old_enabled; config$gpu_min_cells <- old_min }, add = TRUE)
  config$gpu_min_cells <- 1L
  train <- data.frame(bio1 = c(0, 1, 2, 3))
  proj <- terra::rast(nrows = 1, ncols = 8)
  names(proj) <- "bio1"
  terra::values(proj) <- c(-1, 0, 0.5, 1, 2, 3, 4, NA)
  expected <- .mess_empirical_scores(terra::values(proj, mat = FALSE), train$bio1)

  config$gpu_enabled <- "off"
  cpu <- compute_mess(train, proj)
  config$gpu_enabled <- "on"
  gpu <- tryCatch(compute_mess(train, proj), error = function(e) skip(paste("GPU MESS unavailable:", conditionMessage(e))))
  expect_equal(as.numeric(terra::values(cpu$mess)), expected, tolerance = 1e-6)
  expect_equal(as.numeric(terra::values(gpu$mess)), as.numeric(terra::values(cpu$mess)), tolerance = 1e-5)
})
