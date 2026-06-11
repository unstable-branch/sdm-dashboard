#!/usr/bin/env Rscript
# Plumber container entrypoint — libtorch and lantern are pre-installed at build time.
app_dir <- Sys.getenv("SDM_PROJECT_ROOT", "/app")
source(file.path(app_dir, "plumber", "R", "run_server.R"))
