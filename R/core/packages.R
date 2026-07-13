# Runtime and dependency helpers for the SDM project.

check_sdm_versions <- function() {
  min_versions <- list(
    biomod2 = "4.0.0",
    cito    = "0.1.0",
    terra   = "1.7-0",
    mgcv    = "1.8-40",
    torch   = "0.10.0"
  )
  outdated <- character()
  for (pkg in names(min_versions)) {
    if (!requireNamespace(pkg, quietly = TRUE)) next
    cur <- tryCatch(as.character(packageVersion(pkg)), error = function(e) "0.0.0")
    if (utils::compareVersion(cur, min_versions[[pkg]]) < 0) {
      outdated <- c(outdated, sprintf("%s (installed: %s, required: %s)", pkg, cur, min_versions[[pkg]]))
    }
  }
  if (length(outdated) > 0) {
    warning("Outdated packages detected:\n", paste(outdated, collapse = "\n"), call. = FALSE)
    FALSE
  } else {
    TRUE
  }
}

sdm_required_packages <- c("terra")
sdm_app_packages <- c(
  "shiny", "bslib", "terra",
  "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "xgboost", "ranger",
  "jsonlite",
  "future", "future.apply",
  "ggplot2", "CAST", "blockCV"
)
sdm_setup_packages <- c("shiny", "bslib", "terra", "geodata", "leaflet", "mapview", "sf", "DT", "marginaleffects", "shinyjs", "future", "future.apply", "ggplot2", "matrixStats")

sdm_optional_packages <- list(
  maxnet = c("maxnet", "glmnet"),
  biomod2 = c("biomod2", "PresenceAbsence", "pROC"),
  leaflet = c("leaflet", "mapview", "sf"),
  rgee = c("rgee", "reticulate"),
  inla = c("INLA", "inlabru"),
  bart = c("dbarts"),
  unmarked = c("unmarked"),
  brms = c("brms", "cmdstanr"),
  python = c("arrow", "reticulate"),
  xai = c("fastshap", "iml"),
  dwca = c("finch"),
  esm = c("ecospat", "biomod2"),
  targets = c("targets", "tarchetypes", "geotargets", "crew", "crew.cluster", "crew.aws.batch"),
  dnn = c("cito", "torch", "matrixStats"),
  ala = c("galah"),
  enmeval = c("ENMeval"),
  devtools = c("devtools")
)

detect_available_cores <- function(logical = TRUE) {
  cores <- tryCatch(parallel::detectCores(logical = logical), error = function(e) NA_integer_)
  if (is.na(cores) || cores < 1) 1L else as.integer(cores)
}

normalize_core_count <- function(n_cores = NULL, reserve_one = FALSE) {
  available <- detect_available_cores(TRUE)
  if (is.null(n_cores) || length(n_cores) == 0 || is.na(suppressWarnings(as.integer(n_cores[1])))) {
    n <- available - as.integer(reserve_one)
  } else {
    n <- suppressWarnings(as.integer(n_cores[1]))
  }
  max(1L, min(available, n))
}

set_compile_threads <- function(n_cores) {
  n_cores <- normalize_core_count(n_cores)
  Sys.setenv(
    MAKEFLAGS = paste0("-j", n_cores),
    OMP_NUM_THREADS = as.character(n_cores),
    OPENBLAS_NUM_THREADS = as.character(n_cores),
    MKL_NUM_THREADS = as.character(n_cores),
    VECLIB_MAXIMUM_THREADS = as.character(n_cores),
    NUMEXPR_NUM_THREADS = as.character(n_cores)
  )
  options(Ncpus = n_cores, mc.cores = n_cores)
  invisible(n_cores)
}

configure_user_library <- function() {
  user_lib <- Sys.getenv("R_LIBS_USER")
  if (!nzchar(user_lib)) {
    if (.Platform$OS.type == "windows") {
      user_lib <- file.path(Sys.getenv("LOCALAPPDATA", unset = path.expand("~")), "R", "win-library", paste(R.version$major, R.version$minor, sep = "."))
    } else {
      user_lib <- .libPaths()[1]
    }
    Sys.setenv(R_LIBS_USER = user_lib)
  }
  user_lib <- path.expand(user_lib)
  if (!dir.exists(user_lib)) dir.create(user_lib, recursive = TRUE, showWarnings = FALSE)
  normalized_libs <- normalizePath(.libPaths(), winslash = "/", mustWork = FALSE)
  normalized_user_lib <- normalizePath(user_lib, winslash = "/", mustWork = FALSE)
  if (dir.exists(user_lib) && !(normalized_user_lib %in% normalized_libs)) {
    .libPaths(c(user_lib, .libPaths()))
  }
  invisible(user_lib)
}

ensure_sdm_packages <- function(packages = sdm_required_packages, install = TRUE, n_cores = NULL) {
  configure_user_library()
  n_cores <- set_compile_threads(normalize_core_count(n_cores, reserve_one = FALSE))
  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) > 0) {
    if (!install) stop("Missing required R packages: ", paste(missing, collapse = ", "), call. = FALSE)
    message("Installing ", length(missing), " missing package(s): ", paste(missing, collapse = ", "))
    message("Package library: ", .libPaths()[1])
    message("This may take several minutes — compiling from source.\n")
    for (i in seq_along(missing)) {
      pkg <- missing[i]
      message(sprintf("[%d/%d] Installing %s ...", i, length(missing), pkg))
      tryCatch({
        install.packages(pkg, repos = "https://cloud.r-project.org", lib = .libPaths()[1],
                        quiet = FALSE, verbose = FALSE)
        message(sprintf("[%d/%d] %s: OK", i, length(missing), pkg))
      }, error = function(e) {
        message(sprintf("[%d/%d] %s: FAILED — %s", i, length(missing), pkg, conditionMessage(e)))
      })
    }
  }
  invisible(TRUE)
}

configure_parallel <- function(n_cores = NULL, log_fun = NULL) {
  n_cores <- normalize_core_count(n_cores, reserve_one = is.null(n_cores))
  set_compile_threads(n_cores)
  if (requireNamespace("terra", quietly = TRUE)) {
    try(terra::terraOptions(memfrac = 0.5, progress = 0), silent = TRUE)
  }
  log_message(log_fun, "Using ", n_cores, " CPU core(s) for package compilation, cross-validation, and raster prediction")
  n_cores
}

safe_torch_probe <- function(expr, label = "torch") {
  tryCatch(
    {
      list(ok = isTRUE(expr), message = NA_character_)
    },
    error = function(e) {
      list(ok = FALSE, message = paste0(label, " probe failed: ", conditionMessage(e)))
    }
  )
}

setup_torch_cuda <- function(force_gpu = FALSE, log_fun = NULL) {
  result <- list(
    device = "cpu",
    gpu_available = FALSE,
    cuda_version = NA,
    torch_version = NA,
    installation_status = "not_checked",
    message = "torch not checked"
  )

  if (!requireNamespace("torch", quietly = TRUE)) {
    result$message <- "torch package not installed"
    return(result)
  }

  tryCatch(
    {
      result$torch_version <- as.character(packageVersion("torch"))
    },
    error = function(e) NULL
  )

  installed_probe <- safe_torch_probe(torch::torch_is_installed(), "LibTorch")
  result$installation_status <- if (installed_probe$ok) {
    "ok"
  } else if (!is.na(installed_probe$message)) {
    "error"
  } else {
    "not_installed"
  }

  if (result$installation_status != "ok") {
    result$message <- if (!is.na(installed_probe$message)) {
      installed_probe$message
    } else {
      "LibTorch not installed - run torch::install_torch()"
    }
    return(result)
  }

  result$message <- "LibTorch installed"

  tryCatch(
    {
      cuda_probe <- safe_torch_probe(torch::cuda_is_available(), "CUDA")
      mps_probe <- safe_torch_probe(torch::mps_is_available(), "MPS")
      has_cuda <- cuda_probe$ok
      has_mps <- mps_probe$ok

      if (has_cuda) {
        cuda_ver <- Sys.getenv("CUDA", NA_character_)
        if (!is.na(cuda_ver) && nzchar(cuda_ver)) result$cuda_version <- cuda_ver
      }

      if (has_cuda) {
        result$gpu_available <- TRUE
        result$device <- "cuda"
        result$message <- paste("CUDA GPU available (version:", result$cuda_version, ")")
      } else if (has_mps) {
        result$gpu_available <- TRUE
        result$device <- "mps"
        result$message <- "MPS (Apple Silicon) GPU available"
      } else if (force_gpu) {
        failed <- c(cuda_probe$message, mps_probe$message)
        failed <- failed[!is.na(failed)]
        detail <- if (length(failed) > 0) paste(failed, collapse = " ") else "torch reports no CUDA/MPS device"
        result$message <- paste("GPU requested but unavailable - using CPU.", detail)
      }
    },
    error = function(e) {
      result$message <- paste("GPU detection error:", conditionMessage(e))
    }
  )

  if (!is.null(log_fun)) {
    log_fun(paste("torch:", result$message, "| Device:", result$device))
  }

  result
}
