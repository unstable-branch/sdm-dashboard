worker_config_env <- new.env(parent = globalenv())
worker_config_env$project_root <- if (exists("find_sdm_root", mode = "function")) {
  find_sdm_root()
} else {
  normalizePath(".", winslash = "/", mustWork = TRUE)
}
sys.source(file.path(worker_config_env$project_root, "R", "core", "model_payload_normalizer.R"),
  envir = worker_config_env)
sys.source(file.path(worker_config_env$project_root, "plumber", "R", "helpers", "models_helpers.R"),
  envir = worker_config_env)

worker_cfg_expressions <- function() {
  worker_file <- file.path(worker_config_env$project_root,
    "plumber", "R", "run_model_background.R")
  worker_expr <- parse(file = worker_file)
  find_cfg_assignment <- function(expr) {
    if (is.call(expr) && identical(expr[[1]], as.name("<-")) &&
        identical(expr[[2]], as.name("cfg_args"))) return(list(expr))
    if (is.call(expr) || is.expression(expr) || is.pairlist(expr)) {
      return(unlist(lapply(as.list(expr), find_cfg_assignment), recursive = FALSE))
    }
    list()
  }
  assignment <- find_cfg_assignment(worker_expr)
  expect_length(assignment, 1L)
  assignment <- assignment[[1L]][[3L]]
  expect_identical(assignment[[1L]], as.name("list"))
  args <- as.list(assignment)[-1L]
  setNames(args, names(args))
}

assemble_projected_worker_config <- function(request_config) {
  projected <- worker_config_env$sdm_project_safe_execution_config(request_config)
  normalized <- worker_config_env$sdm_normalize_model_payload(projected)
  expressions <- worker_cfg_expressions()
  wanted <- c("training_extent", "extrapolation_mask", "mess_threshold", "generate_cog",
    "cv_folds", "tuning_method", "validation_occurrences", "overlap_warn",
    "glm_alpha", "xgb_objective")
  env <- new.env(parent = environment())
  env$config <- normalized
  env$sdm_default_cv_folds <- 5L
  env$sdm_default_tuning_method <- "none"
  args <- expressions[intersect(wanted, names(expressions))]
  list(projected = projected,
    cfg_args = as.list(lapply(args, eval, envir = env)))
}

test_that("background worker assembles only projected allowlisted science configuration", {
  requested_extent <- c(140, 146, -28, -20)
  result <- assemble_projected_worker_config(list(
    species = "Synthetic species",
    trainingExtent = paste(requested_extent, collapse = ","),
    extrapolationMask = FALSE,
    messThreshold = 0.25,
    generateCog = FALSE,
    cvFolds = 0L,
    tuningMethod = "enmeval",
    validationOccurrences = "synthetic-validation.csv",
    overlapWarn = TRUE,
    glmAlpha = 0.35,
    xgbObjective = "count:poisson"
  ))

  expect_equal(result$projected$training_extent,
    paste(requested_extent, collapse = ","))
  expect_equal(result$cfg_args$training_extent, requested_extent)
  expect_false(result$cfg_args$extrapolation_mask)
  expect_equal(result$cfg_args$mess_threshold, 0.25)
  expect_false(result$cfg_args$generate_cog)
  expect_identical(result$cfg_args$cv_folds, 0L)
  expect_identical(result$cfg_args$tuning_method, "enmeval")

  rejected <- c("validation_occurrences", "overlap_warn", "glm_alpha", "xgb_objective")
  expect_false(any(rejected %in% names(result$projected)))
  expect_false(any(rejected %in% names(result$cfg_args)))
})

test_that("background worker preserves allowlist defaults after safe projection", {
  result <- assemble_projected_worker_config(list(
    species = "Synthetic species",
    training_extent = NULL,
    extrapolation_mask = NULL,
    mess_threshold = NULL,
    generate_cog = NULL
  ))

  expect_null(result$cfg_args$training_extent)
  expect_true(result$cfg_args$extrapolation_mask)
  expect_equal(result$cfg_args$mess_threshold, 0)
  expect_true(result$cfg_args$generate_cog)
  expect_identical(result$cfg_args$cv_folds, 5L)
  expect_identical(result$cfg_args$tuning_method, "none")
})

test_that("safe projection denies malformed aliases and nested secrets before assembly", {
  expect_error(assemble_projected_worker_config(list(
    modelId = "glm", model_id = "rf", species = "Synthetic species"
  )), "Invalid execution configuration")
  expect_error(assemble_projected_worker_config(list(
    species = "Synthetic species",
    enmevalTuneArgs = list(fc = "not-a-feature")
  )), "Invalid execution configuration")
  expect_error(assemble_projected_worker_config(list(
    species = "Synthetic species",
    unrecognized = list(provider_api_key = "synthetic-secret-sentinel")
  )), "Invalid execution configuration")
})

test_that("projected and normalized worker options survive the real constructor", {
  requested_extent <- c(140, 146, -28, -20)
  result <- assemble_projected_worker_config(list(
    species = "Synthetic species",
    trainingExtent = paste(requested_extent, collapse = ","),
    extrapolationMask = FALSE,
    messThreshold = 0.25,
    generateCog = FALSE,
    cvFolds = 0L,
    tuningMethod = "enmeval"
  ))
  cfg <- do.call(sdm_config, c(result$cfg_args,
    list(projection_extent = c(138, 148, -30, -18))))

  expect_s3_class(cfg, "sdm_config")
  expect_equal(cfg$training_extent, requested_extent)
  expect_identical(cfg$cv_folds, 0L)
  expect_identical(cfg$tuning_method, "enmeval")
  expect_false(cfg$extrapolation_mask)
  expect_equal(cfg$mess_threshold, 0.25)
  expect_false(cfg$generate_cog)
})
