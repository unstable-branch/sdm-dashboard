#!/usr/bin/env Rscript
# Fast public-release audit. Does not download data or build models.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
script_path <- if (length(file_arg) > 0) {
  normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE)
} else {
  normalizePath(file.path("scripts", "audit_release.R"), winslash = "/", mustWork = FALSE)
}
project_root <- dirname(dirname(script_path))
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)
source("R/core/optimized_sdm.R")

fail <- function(...) stop(paste0(...), call. = FALSE)

expected <- c(
  "R/engine_load.R", "R/load_compute.R", "R/core/optimized_sdm.R",
  "scripts/make_release_zip.R", "scripts/smoke_test.R",
  "README.md", "LICENSE", "CONTRIBUTING.md", "CITATION.cff", "VERSION",
  "CODE_OF_CONDUCT.md", "SECURITY.md", ".dockerignore",
  ".github/workflows/r-quality.yml", "data/examples/synthetic_presence_data.csv"
)
missing <- expected[!file.exists(expected)]
if (length(missing) > 0) fail("Missing expected release file(s): ", paste(missing, collapse = ", "))

removed_public_clutter <- c("Main.R", "prepare_windows.bat", "docs/index.md",
  "app.R", "launch_app.R", "run_app_windows.bat", "README_WINDOWS.md", "install_packages.R", "pipeline.R", "Dockerfile")
tracked_public_clutter <- tryCatch(
  system2("git", c("-C", project_root, "ls-files", "--", removed_public_clutter), stdout = TRUE, stderr = FALSE),
  error = function(e) character()
)
tracked_public_clutter <- tracked_public_clutter[nzchar(tracked_public_clutter)]
if (length(tracked_public_clutter) > 0) {
  fail("Public clutter file(s) should not be tracked: ", paste(tracked_public_clutter, collapse = ", "))
}

make_release_env <- new.env(parent = .GlobalEnv)
source("scripts/make_release_zip.R", local = make_release_env)

assert_no_match <- function(paths, pattern, label) {
  hits <- paths[grepl(pattern, paths, ignore.case = TRUE, perl = TRUE)]
  if (length(hits) > 0) fail(label, ": ", paste(hits, collapse = ", "))
}

source_files <- make_release_env$release_included_paths(include_worldclim = FALSE)
blocked <- source_files[make_release_env$release_should_exclude(source_files, include_worldclim = FALSE)]
if (length(blocked) > 0) fail("Source release includes blocked file(s): ", paste(blocked, collapse = ", "))
assert_no_match(source_files, "^Worldclim(/|$)|^worldclim(/|$)|^WorldClim(/|$)|^Worldclim_future(/|$)|^worldclim_future(/|$)|^WorldClim_future(/|$)|^outputs(/|$)|^covariates(/|$)|^logs(/|$)", "Source release includes generated output/cache files")
assert_no_match(source_files, "(^|/)AGENTS[.]md$|^docs(/|$)|^Main[.]R$|^prepare_windows[.]bat$", "Source release includes public clutter")

audit_zip <- function(zip_path) {
  entries <- utils::unzip(zip_path, list = TRUE)$Name
  file_entries <- entries[!grepl("/$", entries)]
  base <- basename(zip_path)
  assert_no_match(entries, "^SDM-Web(/|$)", paste(base, "uses stale internal folder name"))
  assert_no_match(entries, "(^|/)presence_data[.]csv$|(^|/)[.]env$|(^|/)[.]Renviron$|(^|/)AGENTS[.]md$|(^|/)docs/|hyprshot.*[.](png|jpg|jpeg)$|[.]log$", paste(base, "contains blocked entries"))
  assert_no_match(file_entries, "^[^/]+/(outputs|logs|covariates)/.+", paste(base, "contains generated output/log/cache files"))
  if (grepl("-source[.]zip$", base)) {
    assert_no_match(entries, "(^|/)Worldclim(/|$)|(^|/)Main[.]R$|(^|/)prepare_windows[.]bat$", paste(base, "contains source-bundle clutter or rasters"))
  }
}

zip_paths <- list.files(sdm_project_root(), pattern = "^sdm-dashboard-v.+-source[.]zip$", full.names = TRUE)
for (zip_path in zip_paths) audit_zip(zip_path)

cat("Release audit passed. Source selection is clean.\n")
