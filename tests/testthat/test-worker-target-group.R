# Synthetic-only proof for the trusted worker target-group adapter.
# This exercises the projection-safe worker adapter and real sampler/GLM path;
# it does not execute signature verification or establish Hono/HMAC acceptance.

project_root <- find_sdm_root()
worker_tg_env <- new.env(parent = globalenv())
sys.source(file.path(project_root, "R", "core", "bootstrap.R"), envir = worker_tg_env)
sys.source(file.path(project_root, "R", "core", "model_payload_normalizer.R"), envir = worker_tg_env)
sys.source(file.path(project_root, "R", "core", "config.R"), envir = worker_tg_env)
sys.source(file.path(project_root, "R", "core", "sdm_config.R"), envir = worker_tg_env)
sys.source(file.path(project_root, "R", "core", "crypto.R"), envir = worker_tg_env)
sys.source(file.path(project_root, "plumber", "R", "helpers", "models_helpers.R"), envir = worker_tg_env)

worker_tg_run_worker_cfg <- function(config, app_dir) {
  # Evaluate the production cfg_args list expression from the actual worker
  # source, with server-validated adapter output supplied as its local helper.
  exprs <- parse(file.path(project_root, "plumber", "R", "run_model_background.R"))
  find_cfg <- function(expr = NULL) {
    if (is.call(expr) && identical(expr[[1]], as.name("<-")) && identical(expr[[2]], as.name("cfg_args"))) return(expr)
    if (is.call(expr) || is.expression(expr) || is.pairlist(expr)) {
      for (i in seq_along(expr)) {
        child <- tryCatch(expr[[i]], error = function(e) NULL)
        if (is.null(child)) next
        found <- tryCatch(find_cfg(child), error = function(e) NULL)
        if (!is.null(found)) return(found)
      }
    }
    NULL
  }
  cfg_expr <- NULL
  for (expr in exprs) {
    cfg_expr <- find_cfg(expr)
    if (!is.null(cfg_expr)) break
  }
  stopifnot(!is.null(cfg_expr))
  env <- new.env(parent = worker_tg_env)
  env$config <- config
  env$biovars <- as.integer(unlist(strsplit(as.character(config$biovars %||% "1,4,6,12,15,18"), ",")))
  env$projection_extent <- as.numeric(unlist(strsplit(as.character(config$projection_extent %||% "112,154,-44,-10"), ",")))
  env$app_dir <- app_dir
  env$job_dir <- tempfile("target-group-job-")
  env$cleaned_occurrence <- NULL
  env$job_id <- "synthetic-target-group-job"
  env$log_fun <- function(...) invisible(NULL)
  env$progress_fun <- function(...) invisible(NULL)
  env$sdm_default_worldclim_dir <- "unused"
  env$sdm_default_background_n <- 100L
  env$sdm_default_min_source_records <- 1L
  env$sdm_default_cv_folds <- 2L
  env$sdm_default_worldclim_res <- 10
  env$sdm_default_cv_strategy <- "random"
  env$sdm_default_elevation_demtype <- "SRTM"
  env$sdm_default_soil_vars <- NULL
  env$sdm_default_soil_depths <- NULL
  env$sdm_default_uv_vars <- NULL
  env$sdm_default_veg_year <- 2020L
  env$sdm_default_veg_products <- NULL
  env$sdm_default_lulc_year <- 2020L
  env$sdm_default_hfp_year <- 2020L
  env$sdm_default_thinning_distance_km <- 10
  env$sdm_default_pa_replicates <- 1L
  env$sdm_default_seed <- 42L
  env$sdm_default_climate_source <- "worldclim"
  env$sdm_default_ensemble_power <- 1
  env$sdm_default_ensemble_min_auc <- 0.5
  env$sdm_default_ensemble_min_tss <- 0
  env$sdm_esm_default_n_runs <- 1L
  env$sdm_esm_default_split <- 0.8
  env$sdm_esm_default_min_auc <- 0.5
  env$sdm_esm_default_power <- 1
  env$sdm_default_analysis_crs <- "EPSG:4326"
  env$sdm_default_generate_tiles <- FALSE
  env$sdm_default_mask_type <- "none"
  env$sdm_default_mask_file <- NULL
  env$sdm_default_mask_buffer_deg <- 0
  env$sdm_default_mask_boundary_type <- "auto"
  env$sdm_default_mask_resolution <- "medium"
  env$sdm_default_mask_country <- NULL
  env$sdm_default_rangebag_n_bags <- 10L
  env$sdm_default_rangebag_bag_fraction <- 0.5
  env$sdm_default_rangebag_vars_per_bag <- 2L
  env$sdm_default_tuning_method <- "none"
  env$sdm_default_enmeval_algorithm <- "maxnet"
  env$sdm_default_enmeval_partitions <- "block"
  env$sdm_default_enmeval_selection_metric <- "auc"
  env$sdm_default_enmeval_tune_args <- NULL
  env$sdm_default_enmeval_other_settings <- NULL
  env$sdm_default_enmeval_null_iterations <- 0L
  env$sdm_default_maxnet_features <- "lq"
  env$sdm_default_maxnet_regmult <- 1
  env$sdm_default_dnn_default <- NULL
  env$sdm_default_cv_block_size_km <- 100
  env$sdm_resolve_project_path <- function(x, root) x
  env$sdm_validate_worker_asset_path <- worker_tg_env$sdm_validate_worker_asset_path
  eval(cfg_expr, env)
  env$cfg_args
}

worker_tg_prove_sampler_fit <- function(configured) {
  skip_if_not_installed("terra")
  app_dir <- tempfile("target-group-app-")
  upload_dir <- if (configured) tempfile("configured-upload-root-") else file.path(app_dir, "data", "uploads")
  dir.create(upload_dir, recursive = TRUE)
  on.exit(unlink(app_dir, recursive = TRUE), add = TRUE)
  on.exit(unlink(upload_dir, recursive = TRUE), add = TRUE)
  old_root <- Sys.getenv("SDM_INPUT_ASSET_UPLOAD_ROOT", unset = NA_character_)
  on.exit(if (is.na(old_root)) Sys.unsetenv("SDM_INPUT_ASSET_UPLOAD_ROOT") else
    Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = old_root), add = TRUE)
  if (configured) Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = upload_dir) else Sys.unsetenv("SDM_INPUT_ASSET_UPLOAD_ROOT")
  target_path <- file.path(upload_dir, "opaque-resolved-target.csv")

  env_train_scaled <- terra::rast(ncols = 20, nrows = 10, nlyrs = 2,
    xmin = 100, xmax = 101, ymin = 10, ymax = 11, crs = "EPSG:4326")
  set.seed(1004)
  terra::values(env_train_scaled) <- cbind(stats::rnorm(200), stats::rnorm(200))
  env <- env_train_scaled[[1]]
  occurrences <- data.frame(
    longitude = seq(100.025, 100.975, length.out = 20),
    latitude = rep(10.25, 20)
  )
  pres_cells <- unique(terra::cellFromXY(env[[1]], occurrences))
  tg_cells_fixture <- setdiff(seq_len(terra::ncell(env)), pres_cells)[seq_len(130)]
  tg_xy <- terra::xyFromCell(env[[1]], tg_cells_fixture)
  utils::write.csv(data.frame(longitude = tg_xy[, 1], latitude = tg_xy[, 2]), target_path, row.names = FALSE)
  projected <- worker_tg_env$sdm_project_safe_execution_config(list(
    species = "Synthetic target-group taxon", modelId = "glm", occurrenceFile = "unused.csv",
    biasMethod = "target_group", targetGroupFile = target_path, cvFolds = 2,
    backgroundN = 100, seed = 41
  ))
  normalized <- worker_tg_env$sdm_normalize_model_payload(projected)
  cfg_args <- worker_tg_run_worker_cfg(normalized, app_dir)
  cfg <- do.call(worker_tg_env$sdm_config, cfg_args)
  expect_true(is.data.frame(cfg$target_group_occ))
  expect_equal(names(cfg$target_group_occ), c("longitude", "latitude"))

  # Load and call the registered production sampler and real GLM fit function.
  fit_env <- new.env(parent = worker_tg_env)
  sys.source(file.path(project_root, "R", "models", "model_glm.R"), envir = fit_env)
  sys.source(file.path(project_root, "R", "models", "model_helpers.R"), envir = fit_env)
  sys.source(file.path(project_root, "R", "models", "model_registry.R"), envir = fit_env)
  d <- fit_env$prepare_sdm_data(occurrences, env_train_scaled, 100, seed = 41,
    bias_method = "target_group", target_group_occ = cfg$target_group_occ)
  tg_cells <- unique(terra::cellFromXY(env[[1]], cfg$target_group_occ[, c("longitude", "latitude")]))
  bg_cells <- unique(terra::cellFromXY(env[[1]], d$bg_xy))
  expect_true(length(bg_cells) > 0L)
  expect_true(all(bg_cells %in% tg_cells))
  expect_length(intersect(bg_cells, pres_cells), 0L)
  expect_true(length(setdiff(seq_len(terra::ncell(env)), tg_cells)) > 0L)
  fit <- fit_env$fit_sdm_model("glm", occ = occurrences, env_train_scaled = env_train_scaled,
    background_n = 100, cv_folds = 2, seed = 41, n_cores = 1,
    cv_strategy = "random", bias_method = "target_group",
    target_group_occ = cfg$target_group_occ)
  expect_true(inherits(fit$model, "glm"))
  expect_true(all(is.finite(stats::coef(fit$model))))
}

test_that("default-root worker target-group payload reaches real registered GLM sampling and fit", {
  worker_tg_prove_sampler_fit(FALSE)
})

test_that("configured-root worker target-group payload reaches real registered GLM sampling and fit", {
  worker_tg_prove_sampler_fit(TRUE)
})

test_that("worker target-group adapter accepts the configured upload root", {
  app_dir <- tempfile("target-group-app-")
  default_uploads <- file.path(app_dir, "data", "uploads")
  configured_uploads <- tempfile("configured-upload-root-")
  dir.create(default_uploads, recursive = TRUE)
  dir.create(configured_uploads, recursive = TRUE)
  on.exit(unlink(c(app_dir, configured_uploads), recursive = TRUE), add = TRUE)
  target_path <- file.path(configured_uploads, "opaque-resolved-target.csv")
  utils::write.csv(data.frame(longitude = 1, latitude = 2), target_path, row.names = FALSE)
  old_root <- Sys.getenv("SDM_INPUT_ASSET_UPLOAD_ROOT", unset = NA_character_)
  on.exit(if (is.na(old_root)) Sys.unsetenv("SDM_INPUT_ASSET_UPLOAD_ROOT") else
    Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = old_root), add = TRUE)
  Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = configured_uploads)

  result <- worker_tg_env$sdm_load_target_group_occ(target_path, app_dir)
  expect_equal(result, data.frame(longitude = 1, latitude = 2))

  read_count <- 0L
  read_probe <- function(...) { read_count <<- read_count + 1L; utils::read.csv(...) }
  accepted <- worker_tg_env$sdm_load_target_group_occ(target_path, app_dir, reader = read_probe)
  expect_equal(accepted$longitude, 1)
  expect_equal(read_count, 1L)
  default_path <- file.path(default_uploads, "not-configured.csv")
  utils::write.csv(data.frame(longitude = 1, latitude = 2), default_path, row.names = FALSE)
  expect_error(worker_tg_env$sdm_load_target_group_occ(default_path, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_equal(read_count, 1L)

  outside <- tempfile(fileext = ".csv")
  utils::write.csv(data.frame(longitude = 1, latitude = 2), outside, row.names = FALSE)
  traversal <- file.path(configured_uploads, "..", basename(outside))
  expect_error(worker_tg_env$sdm_load_target_group_occ(outside, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_error(worker_tg_env$sdm_load_target_group_occ(traversal, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_equal(read_count, 1L)

  Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = file.path(configured_uploads, "..", "invalid-root"))
  expect_error(worker_tg_env$sdm_load_target_group_occ(target_path, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_equal(read_count, 1L)
  Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = "data/uploads")
  expect_error(worker_tg_env$sdm_load_target_group_occ(target_path, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_equal(read_count, 1L)

  symlink_parent <- tempfile("upload-parent-link-")
  if (file.symlink(dirname(configured_uploads), symlink_parent)) {
    symlink_root <- file.path(symlink_parent, basename(configured_uploads))
    Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = symlink_root)
    expect_error(worker_tg_env$sdm_load_target_group_occ(file.path(symlink_root, basename(target_path)), app_dir,
      reader = read_probe), "Target-group input is unavailable")
    expect_equal(read_count, 1L)
    unlink(symlink_parent)
  }
})

test_that("target-group adapter rejects unsafe paths and invalid coordinates before fit", {
  app_dir <- tempfile("target-group-app-")
  upload_dir <- file.path(app_dir, "data", "uploads")
  dir.create(upload_dir, recursive = TRUE)
  on.exit(unlink(app_dir, recursive = TRUE), add = TRUE)
  old_root <- Sys.getenv("SDM_INPUT_ASSET_UPLOAD_ROOT", unset = NA_character_)
  on.exit(if (is.na(old_root)) Sys.unsetenv("SDM_INPUT_ASSET_UPLOAD_ROOT") else
    Sys.setenv(SDM_INPUT_ASSET_UPLOAD_ROOT = old_root), add = TRUE)
  Sys.unsetenv("SDM_INPUT_ASSET_UPLOAD_ROOT")
  outside <- tempfile(fileext = ".csv")
  utils::write.csv(data.frame(longitude = 1, latitude = 2), outside, row.names = FALSE)
  read_count <- 0L
  read_probe <- function(...) { read_count <<- read_count + 1L; utils::read.csv(...) }
  expect_error(worker_tg_env$sdm_load_target_group_occ(outside, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_equal(read_count, 0L)
  traversal <- file.path(upload_dir, "..", "..", "..", basename(outside))
  expect_error(worker_tg_env$sdm_load_target_group_occ(traversal, app_dir, reader = read_probe),
    "Target-group input is unavailable")
  expect_equal(read_count, 0L)
  link_path <- file.path(upload_dir, "linked.csv")
  if (file.symlink(outside, link_path)) {
    expect_error(worker_tg_env$sdm_load_target_group_occ(link_path, app_dir, reader = read_probe),
      "Target-group input is unavailable")
    expect_equal(read_count, 0L)
  }
  invalid_path <- file.path(upload_dir, "invalid.csv")
  utils::write.csv(data.frame(longitude = c(1, "oops"), latitude = c(2, 3)), invalid_path, row.names = FALSE)
  fit_count <- 0L
  fit_guard <- function(...) { fit_count <<- fit_count + 1L; NULL }
  invalid <- tryCatch({
    tg <- worker_tg_env$sdm_load_target_group_occ(invalid_path, app_dir)
    fit_guard(tg)
    NULL
  }, error = identity)
  expect_true(inherits(invalid, "error"))
  expect_false(grepl(invalid_path, conditionMessage(invalid), fixed = TRUE))
  expect_equal(fit_count, 0L)
  expect_null(worker_tg_env$sdm_load_target_group_occ(invalid_path, app_dir, bias_method = "uniform"))
  expect_null(worker_tg_env$sdm_load_target_group_occ(invalid_path, app_dir, bias_method = "thickened"))
  expect_equal(read_count, 0L)
})
