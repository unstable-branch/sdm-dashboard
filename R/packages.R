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
  "biomod2", "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost",
  "httr", "jsonlite",
  "cito", "R.utils",
  "torch", "reticulate",
  "future", "future.apply", "progressr"
)
sdm_setup_packages <- c("shiny", "bslib", "terra", "geodata", "leaflet", "mapview", "sf", "DT", "marginaleffects")

sdm_optional_packages <- list(
  maxnet = c("maxnet", "glmnet"),
  biomod2 = c("biomod2", "PresenceAbsence", "pROC"),
  leaflet = c("leaflet", "mapview", "sf"),
  rgee = c("rgee", "reticulate"),
  dwca = c("finch"),
  esm = c("ecospat", "biomod2")
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
    message("Installing missing packages with ", n_cores, " compile worker(s): ", paste(missing, collapse = ", "))
    message("Package library: ", .libPaths()[1])
    install.packages(missing, repos = "https://cloud.r-project.org", Ncpus = n_cores, lib = .libPaths()[1])
  }
  invisible(TRUE)
}

configure_parallel <- function(n_cores = NULL, log_fun = NULL) {
  n_cores <- normalize_core_count(n_cores, reserve_one = is.null(n_cores))
  set_compile_threads(n_cores)
  if (requireNamespace("terra", quietly = TRUE)) {
    try(terra::terraOptions(memfrac = 0.75, progress = 0), silent = TRUE)
  }
  log_message(log_fun, "Using ", n_cores, " CPU core(s) for package compilation, cross-validation, and raster prediction")
  n_cores
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

  result$installation_status <- tryCatch(
    {
      if (torch::torch_is_installed()) "ok" else "not_installed"
    },
    error = function(e) "error"
  )

  if (result$installation_status != "ok") {
    result$message <- "LibTorch not installed - run torch::install_torch()"
    return(result)
  }

  result$message <- "LibTorch installed"

  tryCatch(
    {
      has_cuda <- torch::cuda_is_available()
      has_mps <- torch::mps_is_available()

      if (has_cuda) {
        cuda_ver <- Sys.getenv("CUDA", NA_character_)
        if (nzchar(cuda_ver)) result$cuda_version <- cuda_ver
      }

      if (force_gpu || has_cuda) {
        result$gpu_available <- TRUE
        result$device <- if (has_cuda) "cuda" else "cpu"
        result$message <- if (has_cuda) {
          paste("CUDA GPU available (version:", result$cuda_version, ")")
        } else {
          "CUDA requested but not available"
        }
      } else if (has_mps) {
        result$gpu_available <- TRUE
        result$device <- "mps"
        result$message <- "MPS (Apple Silicon) GPU available"
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
