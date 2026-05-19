# Helper for background covariate downloads.
# Returns a callr::r_bg process handle. Polling is handled by the module.

start_download_bg <- function(download_fun, args = NULL, init_engine = TRUE) {
  wrapped_fun <- function(...) {
    if (isTRUE(init_engine)) source("R/optimized_sdm.R")
    download_fun(...)
  }
  callr::r_bg(wrapped_fun, args = as.list(args %||% list()), stdout = "|", stderr = "|")
}