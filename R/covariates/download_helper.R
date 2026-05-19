# Helper for background covariate downloads.
# Returns a callr::r_bg process handle. Polling is handled by the module.

start_download_bg <- function(download_fun, args = NULL, init_engine = TRUE) {
  wrapped_fun <- function(...) {
    if (isTRUE(init_engine)) {
      proj_root <- getwd()
      if (file.exists(file.path(proj_root, "R", "core", "bootstrap.R"))) {
        source(file.path(proj_root, "R", "core", "bootstrap.R"))
        sdm_set_project_root(proj_root)
      }
      source(sdm_resolve_module("optimized_sdm.R"))
    }
    download_fun(...)
  }
  # Ensure the callr subprocess starts in the project root
  pkgload <- asNamespace("callr")
  r_bg_args <- list(
    func = wrapped_fun,
    args = as.list(args %||% list()),
    stdout = "|",
    stderr = "|"
  )
  # Pass explicit working directory if r_bg supports it
  if ("wd" %in% names(formals(callr::r_bg))) {
    r_bg_args$wd <- sdm_project_root()
  }
  do.call(callr::r_bg, r_bg_args)
}

#' Start a model run in a background process.
#'
#' Runs run_fast_sdm(cfg) in a callr subprocess. The result is serialised to
#' result_file as RDS; log messages are appended to log_file. The caller polls
#' the process until it exits, then reads the result.
#'
#' @param cfg Full SDM config list (from sdm_config())
#' @param result_file Path to write the result RDS
#' @param log_file Path to append log messages
#' @return callr::r_bg process handle, or NULL if callr unavailable
start_model_bg <- function(cfg, result_file, log_file) {
  if (!requireNamespace("callr", quietly = TRUE)) {
    stop("callr package required for background model runs", call. = FALSE)
  }

  bg_fun <- function(cfg, result_file, log_file) {
    # Bootstrap the SDM engine in the subprocess
    source(sdm_resolve_module("optimized_sdm.R"))

    # Override log_fun to write to log_file
    cfg$log_fun <- function(...) {
      msg <- paste0(..., collapse = "")
      cat(msg, "\n", file = log_file, append = TRUE)
    }
    cfg$progress_fun <- NULL  # Progress doesn't work across processes

    result <- tryCatch(
      run_fast_sdm(cfg),
      error = function(e) {
        cat("ERROR:", conditionMessage(e), "\n", file = log_file, append = TRUE)
        NULL
      }
    )
    if (!is.null(result)) {
      saveRDS(result, result_file)
    }
  }

  pkgload <- asNamespace("callr")
  r_bg_args <- list(
    func = bg_fun,
    args = list(cfg = cfg, result_file = result_file, log_file = log_file),
    stdout = "|",
    stderr = "|"
  )
  if ("wd" %in% names(formals(callr::r_bg))) {
    r_bg_args$wd <- sdm_project_root()
  }
  proc <- do.call(callr::r_bg, r_bg_args)
  proc
}