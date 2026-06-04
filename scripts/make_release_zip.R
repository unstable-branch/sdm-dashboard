#!/usr/bin/env Rscript
# Build source-only or Windows-ready release zips from a clean project tree.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
script_path <- if (length(file_arg) > 0) {
  normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE)
} else {
  normalizePath(file.path("scripts", "make_release_zip.R"), winslash = "/", mustWork = FALSE)
}
project_root <- dirname(dirname(script_path))
direct_execution <- identical(
  normalizePath(script_path, winslash = "/", mustWork = FALSE),
  normalizePath(file.path(project_root, "scripts", "make_release_zip.R"), winslash = "/", mustWork = FALSE)
)
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "core", "optimized_sdm.R"))

args <- commandArgs(trailingOnly = TRUE)
flags <- args[grepl("^--", args)]
positional <- args[!grepl("^--", args)]
mode <- if (length(positional) >= 1) tolower(positional[[1]]) else "ready"
include_worldclim <- mode %in% c("ready", "windows-ready", "with-worldclim")
require_worldclim <- mode %in% c("with-worldclim")
mode_label <- if (include_worldclim) "windows-ready" else "source"
dry_run <- any(flags %in% c("--dry-run", "--list"))
version_arg <- grep("^--version=", flags, value = TRUE)

project_version <- function() {
  desc <- read.dcf(file.path(project_root, "DESCRIPTION"))
  version <- unname(desc[1, "Version"])
  if (is.na(version) || !nzchar(version)) "0.0.0" else version
}

release_version <- if (length(version_arg) > 0) {
  sub("^--version=", "", version_arg[[1]])
} else {
  paste0("v", project_version())
}
release_version <- sub("^v?", "v", release_version)
if (!grepl("^v[0-9]+[.][0-9]+[.][0-9]+([-.][A-Za-z0-9._-]+)?$", release_version)) {
  stop("Release version must look like v0.1.0 or v0.1.0-beta.", call. = FALSE)
}

release_exclude_patterns <- function(include_worldclim = FALSE) {
  worldclim_pattern <- if (include_worldclim) "^Worldclim_future(/|$)|^worldclim_future(/|$)|^WorldClim_future(/|$)" else "^Worldclim(/|$)|^worldclim(/|$)|^WorldClim(/|$)|^Worldclim_future(/|$)|^worldclim_future(/|$)|^WorldClim_future(/|$)"
  c(
    "(^|/)presence_data\\.csv$",
    "^outputs(/|$)", "^screenshots(/|$)", "^logs(/|$)", "^docs(/|$)", "^data/boundaries(/|$)",
    "^covariates(/|$)", worldclim_pattern,
    "(^|/)AGENTS\\.md$", "(^|/)\\.Renviron$", "(^|/)\\.env$", "(^|/)\\.env[.A-Za-z0-9_-]*$",
    "\\.zip$", "\\.log$", "(^|/)[^/]*hyprshot[^/]*\\.(png|jpg|jpeg)$"
  )
}

release_should_exclude <- function(paths, include_worldclim = FALSE) {
  paths <- gsub("\\\\", "/", paths)
  patterns <- release_exclude_patterns(include_worldclim)
  vapply(paths, function(path) any(vapply(patterns, grepl, logical(1), x = path, ignore.case = TRUE, perl = TRUE)), logical(1))
}

expand_release_paths <- function(include_paths, include_worldclim = FALSE) {
  include_paths <- include_paths[file.exists(include_paths)]
  files <- unlist(lapply(include_paths, function(path) {
    if (dir.exists(path)) list.files(path, all.files = TRUE, no.. = TRUE, recursive = TRUE, full.names = TRUE) else path
  }), use.names = FALSE)
  files <- gsub("^\\./", "", gsub("\\\\", "/", files))
  files[!release_should_exclude(files, include_worldclim)]
}

source_release_paths <- function() {
  expand_release_paths(c(
    "app.R", "launch_app.R", "run_app_windows.bat",
    "README.md", "README_WINDOWS.md", "install_packages.R", "pipeline.R",
    "optimized_sdm.R", "SDM.Rproj", ".gitignore", ".dockerignore",
    "DESCRIPTION", "LICENSE", "CITATION.cff", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md",
    "Dockerfile", "docker-compose.yml", ".github", "R", "scripts", "data", "tests", "www"
  ), include_worldclim = FALSE)
}

ready_release_paths <- function(include_worldclim = TRUE) {
  files <- expand_release_paths(c(
    "app.R", "launch_app.R", "run_app_windows.bat",
    "README.md", "README_WINDOWS.md", "install_packages.R", "pipeline.R",
    "optimized_sdm.R", "DESCRIPTION", "LICENSE", "CITATION.cff", "SECURITY.md",
    "R", "data", "www", file.path("scripts", "windows_setup.R")
  ), include_worldclim = include_worldclim)

  if (include_worldclim) {
    wc_files <- unname(find_worldclim_files(sdm_default_worldclim_dir, sdm_default_biovars))
    wc_files <- gsub("^\\./", "", gsub("\\\\", "/", wc_files[!is.na(wc_files)]))
    files <- c(files, wc_files)
  }

  unique(files[!release_should_exclude(files, include_worldclim)])
}

release_included_paths <- function(include_worldclim = FALSE) {
  if (include_worldclim) ready_release_paths(include_worldclim = TRUE) else source_release_paths()
}

if (direct_execution) {

if (require_worldclim) {
  missing <- is.na(find_worldclim_files(sdm_default_worldclim_dir, sdm_default_biovars))
  if (any(missing)) {
    stop("WorldClim-bundled zip requested, but default WorldClim layers are missing: ",
         paste(paste0("BIO", sdm_default_biovars[missing]), collapse = ", "),
         ". Run scripts/download_worldclim.R first or build a source zip.", call. = FALSE)
  }
}

bundle_name <- paste0("sdm-dashboard-", release_version)
stage_root <- tempfile("sdm_release_")
bundle_root <- file.path(stage_root, bundle_name)
dir.create(bundle_root, recursive = TRUE, showWarnings = FALSE)
on.exit(unlink(stage_root, recursive = TRUE, force = TRUE), add = TRUE)

include_files <- release_included_paths(include_worldclim)

if (dry_run) {
  cat("Release files (", mode_label, "):\n", sep = "")
  cat(paste(include_files, collapse = "\n"), "\n", sep = "")
  quit(save = "no", status = 0)
}

for (path in include_files) {
  target <- file.path(bundle_root, path)
  dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
  ok <- file.copy(path, target, copy.date = TRUE)
  if (!ok) stop("Failed to copy release path: ", path, call. = FALSE)
}

if (include_worldclim) {
  empty_dirs <- c(sdm_default_output_dir, sdm_default_covariate_cache_dir,
                  file.path(sdm_default_covariate_cache_dir, "opentopo"),
                  file.path(sdm_default_covariate_cache_dir, "hwsd_v2"), "logs")
  for (dir in empty_dirs) dir.create(file.path(bundle_root, dir), recursive = TRUE, showWarnings = FALSE)
}

zip_name <- paste0("sdm-dashboard-", release_version, "-", mode_label, ".zip")
zip_path <- file.path(dirname(sdm_project_root()), zip_name)
if (file.exists(zip_path)) unlink(zip_path)

old_wd <- setwd(stage_root)
on.exit(setwd(old_wd), add = TRUE)
utils::zip(zipfile = zip_path, files = bundle_name, flags = "-r9X")

cat("Created release zip: ", normalizePath(zip_path, winslash = "/", mustWork = FALSE), "\n", sep = "")
included_worldclim <- include_worldclim && length(grep("^Worldclim/.+[.]tif$", include_files, ignore.case = TRUE)) > 0
cat("Mode: ", mode_label,
    if (included_worldclim) " (includes default WorldClim layers)"
    else if (include_worldclim) " (without bundled WorldClim layers)"
    else " (source only)",
    "\n", sep = "")

}
