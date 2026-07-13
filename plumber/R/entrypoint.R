#!/usr/bin/env Rscript
# Plumber container entrypoint shared by CPU, CUDA, and ROCm images.
app_dir <- Sys.getenv("SDM_PROJECT_ROOT", "/app")
source(file.path(app_dir, "plumber", "R", "run_server.R"))
