# Download future climate layers (CMIP6) for projection.
# Run this before enabling "Future Projection" in the SDM Dashboard.
#
# Usage:
#   Rscript scripts/setup_future_climate.R
#   Rscript scripts/setup_future_climate.R --gcm MRI-ESM2-0 --ssp SSP5-8.5 --period 2061-2080
#
# Defaults: UKESM1-0-LL, SSP2-4.5, 2041-2060 (mid-century, intermediate emissions)

args <- commandArgs(TRUE)

parse_arg <- function(name, default) {
  idx <- which(grepl(paste0("^--", name, "="), args))
  if (length(idx) > 0) {
    sub(paste0("^--", name, "="), "", args[idx[1]])
  } else {
    default
  }
}

gcm    <- parse_arg("gcm",    "UKESM1-0-LL")
ssp    <- parse_arg("ssp",    "SSP2-4.5")
period <- parse_arg("period", "2041-2060")
out_dir <- parse_arg("out",   "Worldclim_future")

message("================================================================")
message("SDM Dashboard — Future Climate Setup")
message("================================================================")
message("GCM    : ", gcm)
message("SSP    : ", ssp)
message("Period : ", period)
message("Output : ", out_dir)
message("================================================================")

source("R/core/optimized_sdm.R")

message("\nDownloading CMIP6 climate layers...")
message("(This may take several minutes depending on your connection)\n")

result <- tryCatch({
  fetch_cmip6_worldclim(
    gcm = gcm,
    ssp = ssp,
    period = period,
    var = "bioc",
    res = 10,
    out_dir = out_dir,
    quiet = FALSE
  )
}, error = function(e) {
  message("ERROR: ", conditionMessage(e))
  message("\nTroubleshooting:")
  message("  - Check your internet connection")
  message("  - Ensure geodata is installed: install.packages('geodata')")
  message("  - Try a different GCM or period")
  NULL
})

if (!is.null(result)) {
  cache_subdir <- file.path(out_dir, paste(gcm, ssp, period, sep = "_"))
  actual_dir <- if (dir.exists(cache_subdir)) cache_subdir else {
    found <- list.files(out_dir, pattern = gcm, full.names = TRUE)[1]
    if (!is.na(found) && dir.exists(found)) found else out_dir
  }
  message("\n================================================================")
  message("Download complete!")
  message("Future climate layers saved to: ", actual_dir)
  message("")
  message("In the SDM Dashboard, set the 'Future/CMIP6 BIO folder' to:")
  message("  ", normalizePath(actual_dir))
  message("")
  message("Then enable 'Project a future climate scenario' in the sidebar.")
  message("================================================================")
}