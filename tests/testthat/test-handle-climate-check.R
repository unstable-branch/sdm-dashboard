# Tests for the climate-layer availability check used by the modern frontend.
#
# Before this fix, handle_climate_check in plumber/R/helpers/climate_helpers.R
# used the regex `wc2.1_<res>m_bio_\d+\.tif$` which required an underscore
# between `bio` and the digit. Real on-disk files use the geodata naming
# `wc2.1_<res>m_bio<n>.tif` (NO underscore). The regex never matched, so the
# frontend always saw `available:[]` for any worldclim files on disk and
# perpetually offered to "re-download" layers that were already present.
#
# These tests guard the shared matcher module (R/covariates/match_climate_layers.R)
# against regression. The matcher is now consumed by:
#   - find_worldclim_files          (modeling pipeline)
#   - verify_worldclim_cache        (Shiny readiness panel)
#   - handle_climate_check          (modern frontend)
#   - preflight_climate_download    (modern frontend download pre-flight)

# Matchers and validate_geotiff are sourced by helper-load.R + tests/setup paths.
# We also try a project-root-relative load here in case the harness runs in
# isolation (e.g. R CMD check).
if (!exists("match_worldclim_biovars")) {
  candidate <- file.path("R", "covariates", "match_climate_layers.R")
  if (file.exists(candidate)) source(candidate, local = FALSE)
}
if (!exists("validate_geotiff")) {
  candidate <- file.path("R", "covariates", "covariates_climate.R")
  if (file.exists(candidate)) source(candidate, local = FALSE)
}
if (!exists("handle_climate_check")) {
  candidate <- file.path("plumber", "R", "helpers", "climate_helpers.R")
  if (!file.exists(candidate)) candidate <- file.path("..", "..", "plumber", "R", "helpers", "climate_helpers.R")
  if (file.exists(candidate)) source(candidate, local = FALSE)
}

# Helper used to write a file with valid little-endian TIFF magic so that
# validate_geotiff() accepts it as a real GeoTIFF.

make_stub_geotiff <- function(path, n_bytes = 32) {
  tif_magic <- as.raw(c(0x49, 0x49, 0x2A, 0x00))
  con <- file(path, "wb")
  on.exit(close(con))
  writeBin(tif_magic, con)
  writeBin(as.raw(rep(1L, n_bytes - 4L)), con)
  invisible(path)
}

test_that("match_worldclim_biovars detects files written by geodata (no underscore)", {
  d <- tempfile("worldclim-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  paths <- c(
    file.path(d, "wc2.1_10m_bio_1.tif"),
    file.path(d, "wc2.1_10m_bio_4.tif"),
    file.path(d, "wc2.1_10m_bio_6.tif")
  )
  for (p in paths) make_stub_geotiff(p)

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result <- match_worldclim_biovars(all_tifs, c(1, 4, 6, 12, 18), "10m")
  expect_setequal(result$biovars, c(1, 4, 6))
  expect_length(result$files, 3)
  expect_equal(basename(result$files["1"]), "wc2.1_10m_bio_1.tif")
})

test_that("match_worldclim_biovars handles zero-padded bio IDs", {
  d <- tempfile("worldclim-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  paths <- c(
    file.path(d, "wc2.1_10m_bio01.tif"),
    file.path(d, "wc2.1_10m_bio05.tif")
  )
  for (p in paths) make_stub_geotiff(p)

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result <- match_worldclim_biovars(all_tifs, c(1, 5, 19), "10m")
  expect_setequal(result$biovars, c(1, 5))
})

test_that("match_worldclim_biovars handles legacy underscore-prefixed naming", {
  d <- tempfile("worldclim-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  paths <- c(
    file.path(d, "wc2.1_10m_wc2.1_10m_bio_1.tif"),
    file.path(d, "wc2.1_10m_wc2.1_10m_bio_5.tif")
  )
  for (p in paths) make_stub_geotiff(p)

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result <- match_worldclim_biovars(all_tifs, c(1, 5, 19), "10m")
  expect_setequal(result$biovars, c(1, 5))
})

test_that("match_worldclim_biovars excludes non-TIFF files with .tif extension", {
  d <- tempfile("worldclim-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  html_path <- file.path(d, "wc2.1_10m_bio_5.htm")
  writeLines("<html><body>404 not found</body></html>", html_path)
  file.rename(html_path, sub("\\.htm$", ".tif", html_path))
  real_path <- file.path(d, "wc2.1_10m_bio_7.tif")
  make_stub_geotiff(real_path)

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result <- match_worldclim_biovars(all_tifs, c(5, 7), "10m")
  expect_setequal(result$biovars, 7)
})

test_that("match_worldclim_biovars filters by resolution when res_label supplied", {
  d <- tempfile("worldclim-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  writeBin(as.raw(c(0x49, 0x49, 0x2A, 0x00, 1, 2, 3, 4)),
           file.path(d, "wc2.1_10m_bio_1.tif"))
  writeBin(as.raw(c(0x49, 0x49, 0x2A, 0x00, 1, 2, 3, 4)),
           file.path(d, "wc2.1_5m_bio_1.tif"))

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result_10m <- match_worldclim_biovars(all_tifs, c(1), "10m")
  result_5m  <- match_worldclim_biovars(all_tifs, c(1), "5m")
  expect_setequal(result_10m$biovars, 1L)
  expect_setequal(result_5m$biovars, 1L)
  expect_match(basename(result_10m$files["1"]), "^wc2\\.1_10m_")
  expect_match(basename(result_5m$files["1"]),  "^wc2\\.1_5m_")
})

test_that("match_chelsa_biovars handles zero-padded CHELSA names", {
  d <- tempfile("chelsa-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  paths <- c(
    file.path(d, "CHELSA_bio01_1981-2010_V.2.1.tif"),
    file.path(d, "CHELSA_bio12_1981-2010_V.2.1.tif")
  )
  for (p in paths) make_stub_geotiff(p)

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result <- match_chelsa_biovars(all_tifs, c(1, 12, 19))
  expect_setequal(result$biovars, c(1, 12))
  expect_match(basename(result$files["1"]), "^CHELSA_bio01_")
})

test_that("match_cmip6_biovars handles bioc_<n>.tif naming", {
  d <- tempfile("cmip6-check-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  paths <- c(
    file.path(d, "wc2.1_10m_bioc_7.tif"),
    file.path(d, "wc2.1_10m_bioc_8.tif")
  )
  for (p in paths) make_stub_geotiff(p)

  all_tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE)
  result <- match_cmip6_biovars(all_tifs, c(7, 8, 19))
  expect_setequal(result$biovars, c(7, 8))
})

# ── handle_climate_check regression tests ─────────────────────────────────
#
# The live Plumber bug this guards against: the matcher and manifest modules
# were absent from both module loaders, the handler's runtime-sourcing fallback
# called a non-existent source_local() helper, and the tryCatch error handler
# used exists("requested", inherits = FALSE) — which cannot see the tryCatch
# body's frame — so it reported `available:[]` AND `missing:[]` simultaneously.
# Symptom: the frontend Download button never enabled and every layer looked
# perpetually unknown.

test_that("handle_climate_check splits available/missing for worldclim", {
  skip_if_not(exists("handle_climate_check"), "climate_helpers.R not sourced")
  skip_if_not(exists("match_worldclim_biovars"), "matcher module not loaded")
  skip_if_not(exists("check_manifest_for_biovars"), "manifest module not loaded")

  d <- tempfile("worldclim-handler-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  for (bv in c(1, 4)) make_stub_geotiff(file.path(d, paste0("wc2.1_10m_bio_", bv, ".tif")))

  old_dir <- if (exists("sdm_default_worldclim_dir", inherits = TRUE)) sdm_default_worldclim_dir else "Worldclim"
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)

  result <- handle_climate_check(NULL, ".", "worldclim", "10", "1,4,6,12")
  expect_setequal(unlist(result$available), c(1, 4))
  expect_setequal(unlist(result$missing), c(6, 12))
  expect_equal(result$source, "worldclim")
  expect_equal(result$res, "10")
})

test_that("handle_climate_check error handler preserves requested biovars", {
  skip_if_not(exists("handle_climate_check"), "climate_helpers.R not sourced")
  skip_if_not(exists("match_worldclim_biovars"), "matcher module not loaded")

  old_dir <- if (exists("sdm_default_chelsa_dir", inherits = TRUE)) sdm_default_chelsa_dir else "chelsa"
  assign("sdm_default_chelsa_dir", tempfile("chelsa-empty-"), envir = globalenv())
  on.exit(assign("sdm_default_chelsa_dir", old_dir, envir = globalenv()), add = TRUE)

  # chelsa against a non-existent directory exercises an internal failure via
  # the manifest/matcher path; the handler must degrade to missing=requested,
  # never to BOTH lists empty.
  result <- handle_climate_check(NULL, ".", "chelsa", "10", "5,9")
  expect_setequal(unlist(result$missing), c(5, 9))
})

test_that("handle_climate_check surfaces internal errors instead of swallowing", {
  skip_if_not(exists("handle_climate_check"), "climate_helpers.R not sourced")

  expect_message(
    result <- handle_climate_check(NULL, ".", "cmip6", "10", "5,9", gcm = "../evil", ssp = "x", period = "y"),
    "\\[climate-check\\] error"
  )
  expect_setequal(unlist(result$missing), c(5, 9))
})

test_that("matcher and manifest modules are registered in both module loaders", {
  # The live Plumber runtime loads modules via engine_load.R; the Shiny app via
  # load.R. If either omits the matcher/manifest modules the handler fails at
  # runtime (this is exactly what shipped broken).
  root <- if (exists("project_root")) project_root else normalizePath(file.path("..", ".."))
  eng <- readLines(file.path(root, "R", "engine_load.R"))
  ldr <- readLines(file.path(root, "R", "load.R"))
  for (mod in c("match_climate_layers.R", "climate_cache_manifest.R")) {
    expect_true(any(grepl(paste0('"', mod, '"'), eng, fixed = TRUE)),
                info = paste("engine_load.R is missing", mod))
    expect_true(any(grepl(paste0('"', mod, '"'), ldr, fixed = TRUE)),
                info = paste("load.R is missing", mod))
  }
})
