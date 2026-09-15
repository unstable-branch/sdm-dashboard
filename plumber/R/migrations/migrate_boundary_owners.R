#!/usr/bin/env Rscript
# Migration: add .owner sidecars to existing custom boundary files.
#
# Before sdm_boundary_owned_by was fail-closed, files without a .owner sidecar
# were treated as publicly accessible (return TRUE).  After this migration all
# existing custom boundary files are marked as "legacy:anonymous" so they are
# NOT accessible to any non-admin user, matching the fail-closed default.
#
# Safe to re-run: files that already have a .owner sidecar are skipped.
#
# Usage: Rscript plumber/R/migrations/migrate_boundary_owners.R

app_dir <- if (Sys.getenv("SDM_PROJECT_ROOT") != "") {
  Sys.getenv("SDM_PROJECT_ROOT")
} else if (dir.exists(file.path(getwd(), "plumber"))) {
  normalizePath(getwd(), winslash = "/")
} else {
  normalizePath(file.path(getwd(), ".."), winslash = "/")
}

custom_dir <- file.path(app_dir, "data", "boundaries", "custom")

if (!dir.exists(custom_dir)) {
  cat("[migrate_boundary_owners] No custom boundary directory found; nothing to migrate.\n")
  quit(status = 0)
}

files <- list.files(custom_dir, pattern = "\\.geojson$", full.names = TRUE)
if (length(files) == 0) {
  cat("[migrate_boundary_owners] No .geojson files found; nothing to migrate.\n")
  quit(status = 0)
}

migrated <- 0
skipped <- 0
for (f in files) {
  sidecar <- paste0(f, ".owner")
  if (file.exists(sidecar)) {
    skipped <- skipped + 1
    next
  }
  writeLines("legacy:anonymous", sidecar)
  migrated <- migrated + 1
  cat("[migrate_boundary_owners] Migrated:", basename(f), "-> legacy:anonymous\n")
}

cat(sprintf("[migrate_boundary_owners] Done: %d migrated, %d already had owner files.\n", migrated, skipped))
