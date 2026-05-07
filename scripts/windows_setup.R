#!/usr/bin/env Rscript
# One-time/first-run preparation used by run_app_windows.bat.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
setup_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath(file.path("scripts", "windows_setup.R"), winslash = "/", mustWork = FALSE)
project_root <- dirname(dirname(setup_path))
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)

source(file.path("R", "optimized_sdm.R"))

n_cores <- normalize_core_count(NULL, reserve_one = TRUE)
cat("Preparing SDM app with ", n_cores, " worker(s).\n", sep = "")

ensure_sdm_packages(sdm_app_packages, n_cores = n_cores)

sdm_ensure_project_dirs()

missing_worldclim <- any(is.na(find_worldclim_files(sdm_default_worldclim_dir, sdm_default_biovars)))
if (missing_worldclim) {
  cat("Default WorldClim layers are missing. Attempting download now.\n")
  wc_ok <- tryCatch({
    ensure_sdm_packages("geodata", n_cores = n_cores)
    download_worldclim_layers(sdm_default_worldclim_dir, sdm_default_biovars, res = sdm_default_worldclim_res, n_cores = n_cores)
    TRUE
  }, error = function(e) {
    message("WorldClim pre-download skipped: ", conditionMessage(e))
    FALSE
  })
  if (!wc_ok) {
    cat("The app will still launch. Keep download enabled in the app and check your internet connection before running a model.\n")
  }
} else {
  cat("Default WorldClim layers are already available.\n")
}

if (!nzchar(Sys.getenv("OPENTOPOGRAPHY_API_KEY", unset = ""))) {
  cat("OpenTopography API key is not set. Elevation can still be used by entering a key in the app.\n")
}

cat("Windows setup complete. Launching the app next.\n")
