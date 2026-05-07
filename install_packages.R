# Optional helper: pre-install packages needed by the web interface.
source("R/optimized_sdm.R")
n_cores <- max(1L, detect_available_cores(TRUE) - 1L)
ensure_sdm_packages(sdm_setup_packages, n_cores = n_cores)
cat("Packages are installed. You can now run launch_app.R or app.R.\n")

# Optional: enable the MaxEnt backend
# install.packages("maxnet")