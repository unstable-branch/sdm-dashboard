# Helper for background covariate downloads.
# Returns a callr::r_bg process handle. Polling is handled by the module.

start_download_bg <- function(download_fun, args = NULL, init_engine = TRUE) {
  wrapped_fun <- function(...) {
    if (isTRUE(init_engine)) source("R/optimized_sdm.R")
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