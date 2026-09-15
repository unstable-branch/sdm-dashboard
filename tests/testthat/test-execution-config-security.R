# Synthetic sentinel tests for the R/Plumber execution boundary.
# No provider credential or live network operation is used.

root <- normalizePath(file.path("..", ".."), winslash = "/")
security_env <- new.env(parent = globalenv())
sys.source(file.path(root, "plumber", "R", "helpers", "models_helpers.R"), envir = security_env)
output_env <- new.env(parent = security_env)
sys.source(file.path(root, "plumber", "R", "helpers", "output_helpers.R"), envir = output_env)
elevation_env <- new.env(parent = globalenv())
sys.source(file.path(root, "R", "covariates", "covariates_elevation.R"), envir = elevation_env)

sentinel <- "synthetic-opentopo-sentinel"

secret_free_config <- list(
  species = "Synthetic species",
  modelId = "glm",
  occurrenceFile = "synthetic.csv",
  biovars = c(1, 4, 12),
  projectionExtent = c(140, 142, -24, -22),
  backgroundN = 500,
  cvFolds = 3,
  threshold = 0.55,
  enmevalTuneArgs = list(fc = c("L", "LQ"), rm = c(0.5, 1))
)

test_that("R execution projection rejects credential aliases recursively", {
  err <- tryCatch({
    security_env$sdm_project_safe_execution_config(c(secret_free_config,
      nested = list(provider = list(open_topography_api_key = sentinel))))
    NULL
  }, error = function(e) e)
  expect_false(is.null(err))
  expect_false(grepl(sentinel, conditionMessage(err), fixed = TRUE))
  expect_error(security_env$sdm_project_safe_execution_config(c(secret_free_config,
    nested = list(provider = list(authToken = sentinel)))), "Invalid execution configuration")
})

test_that("R execution projection strips unknown fields but retains science parameters", {
  projected <- security_env$sdm_project_safe_execution_config(c(secret_free_config,
    unknownOption = sentinel, nested = list(arbitrary = TRUE)))
  expect_equal(projected$species, "Synthetic species")
  expect_equal(projected$model_id, "glm")
  expect_equal(projected$threshold, 0.55)
  expect_equal(projected$biovars, c(1, 4, 12))
  expect_equal(projected$projection_extent, c(140, 142, -24, -22))
  expect_null(projected$unknownOption)
  expect_null(projected$nested)
  expect_equal(projected$enmeval_tune_args$fc, c("L", "LQ"))
})

test_that("R execution projection retains supported runtime science controls", {
  projected <- security_env$sdm_project_safe_execution_config(c(
    secret_free_config, autoDownloadClimate = FALSE, gpuEnabled = "off"
  ))
  expect_identical(projected$auto_download_climate, FALSE)
  expect_identical(projected$gpu_enabled, "off")
  normalized <- security_env$normalize_targets_config(c(
    secret_free_config, autoDownloadClimate = FALSE, gpuEnabled = "off"
  ))
  expect_identical(normalized$auto_download_climate, "FALSE")
  expect_identical(normalized$gpu_enabled, "off")
})

test_that("R execution projection rejects conflicting camel and snake aliases", {
  expect_error(security_env$sdm_project_safe_execution_config(list(
    modelId = "glm", model_id = "rf"
  )), "Invalid execution configuration")
})

test_that("targets normalizer serializes only the safe config projection", {
  normalized <- security_env$normalize_targets_config(c(secret_free_config,
    occurrenceFile = "synthetic.csv", unknownOption = sentinel))
  expect_equal(normalized$species, "Synthetic species")
  expect_equal(normalized$model_id, "glm")
  expect_equal(normalized$occurrences_csv, "synthetic.csv")
  expect_false(any(grepl(sentinel, capture.output(str(normalized)), fixed = TRUE)))
  expect_false(any(grepl("api.key|credential|secret", names(normalized), ignore.case = TRUE)))
})

test_that("historical manifest and script projections deny non-null legacy credentials", {
  legacy <- list(species = "Synthetic species", model_id = "glm",
                 occurrence_file = "synthetic.csv", opentopo_api_key = sentinel)
  expect_null(security_env$sdm_safe_historical_config(legacy))
  expect_null(output_env$sdm_safe_result_config_for_export(legacy))
  expect_null(output_env$sdm_safe_result_config_for_export(list(
    species = "Synthetic species", enmeval_tune_args = list(provider_api_key = sentinel)
  )))
})

test_that("durable targets CSV is revalidated before worker execution", {
  csv_path <- tempfile(fileext = ".csv")
  on.exit(unlink(csv_path), add = TRUE)
  write.csv(data.frame(
    species = "Synthetic species", occurrences_csv = "synthetic.csv", model_id = "glm",
    biovars = "1,4,12", projection_extent = "140,142,-24,-22"
  ), csv_path, row.names = FALSE)
  expect_silent(security_env$sdm_validate_targets_config_csv(csv_path))
  write.csv(data.frame(
    species = "Synthetic species", occurrences_csv = "synthetic.csv", model_id = "glm",
    opentopo_api_key = sentinel
  ), csv_path, row.names = FALSE)
  expect_error(security_env$sdm_validate_targets_config_csv(csv_path),
    "Stored targets configuration is unavailable")
})

test_that("failed status is authorized before returning redacted metadata", {
  job_dir <- tempfile("sdm-status-")
  dir.create(job_dir, recursive = TRUE)
  on.exit(unlink(job_dir, recursive = TRUE, force = TRUE), add = TRUE)
  job_id <- "synthetic-failed-job"
  dir.create(file.path(job_dir, job_id))
  jsonlite::write_json(list(
    id = job_id, user_id = "owner", status = "failed",
    error = paste0("provider api_key=", sentinel),
    config = list(opentopo_api_key = sentinel),
    metrics = list(provider_error = paste0("api_key=", sentinel)),
    output_files = list(provider_error = paste0("api_key=", sentinel))
  ), file.path(job_dir, job_id, "meta.json"), auto_unbox = TRUE)

  old_safe <- security_env$sdm_safe_job_dir
  old_guard <- security_env$sdm_verify_run_owner
  old_app <- security_env$app_dir
  old_progress_clear <- security_env$sdm_redis_progress_clear
  old_cancel_clear <- security_env$sdm_redis_cancel_clear
  on.exit({
    security_env$sdm_safe_job_dir <- old_safe
    security_env$sdm_verify_run_owner <- old_guard
    security_env$app_dir <- old_app
    security_env$sdm_redis_progress_clear <- old_progress_clear
    security_env$sdm_redis_cancel_clear <- old_cancel_clear
  }, add = TRUE)
  security_env$sdm_safe_job_dir <- function(id) file.path(job_dir, id)
  guard_calls <- 0L
  security_env$sdm_verify_run_owner <- function(req, res, run_id, app_dir) {
    guard_calls <<- guard_calls + 1L
    if (!identical(req$user_id, "owner")) {
      res$status <- 404L
      return(list(error = "Run not found"))
    }
    NULL
  }
  security_env$app_dir <- root
  security_env$sdm_redis_progress_clear <- function(...) invisible(NULL)
  security_env$sdm_redis_cancel_clear <- function(...) invisible(NULL)

  foreign <- security_env$handle_model_status(
    list(user_id = "other"), new.env(), job_id
  )
  expect_equal(guard_calls, 1L)
  expect_false(grepl(sentinel, paste(capture.output(str(foreign)), collapse = "\n"), fixed = TRUE))

  owned <- security_env$handle_model_status(
    list(user_id = "owner"), new.env(), job_id
  )
  expect_false(grepl(sentinel, paste(capture.output(str(owned)), collapse = "\n"), fixed = TRUE))
  expect_equal(owned$status, "failed")
})

test_that("provider resolution ignores request-supplied key and reports unavailable capability", {
  old <- Sys.getenv("OPENTOPOGRAPHY_API_KEY", unset = NA_character_)
  on.exit(if (is.na(old)) Sys.unsetenv("OPENTOPOGRAPHY_API_KEY") else Sys.setenv(OPENTOPOGRAPHY_API_KEY = old), add = TRUE)
  Sys.unsetenv("OPENTOPOGRAPHY_API_KEY")
  expect_identical(elevation_env$opentopo_api_key(sentinel), "")
  expect_true(is.na(elevation_env$opentopo_globaldem_url(c(140, 141, -24, -23), api_key = sentinel)))
  redacted <- elevation_env$sdm_redact_opentopo_error(paste0("API_Key=", sentinel,
    " https://portal.opentopography.org/API/globaldem?API_Key=", sentinel))
  expect_false(grepl(sentinel, redacted, fixed = TRUE))
})

test_that("owned R sources parse after secret containment changes", {
  files <- c(
    file.path(root, "plumber", "R", "helpers", "models_helpers.R"),
    file.path(root, "plumber", "R", "run_model_background.R"),
    file.path(root, "plumber", "R", "targets_dispatcher.R"),
    file.path(root, "plumber", "R", "helpers", "output_helpers.R"),
    file.path(root, "R", "covariates", "covariates_elevation.R"),
    file.path(root, "plumber", "R", "run_server.R")
  )
  for (file in files) expect_true(length(parse(file = file)) > 0)
})
