# End-to-end regressions for content identity at the climate and RDS cache boundaries.

cache_integrity_root <- if (exists("project_root", inherits = TRUE)) {
  project_root
} else {
  normalizePath(file.path("..", ".."), mustWork = TRUE)
}

if (!exists("handle_climate_check", mode = "function", inherits = TRUE)) {
  source(file.path(cache_integrity_root, "plumber", "R", "helpers", "climate_helpers.R"), local = FALSE)
}
if (!exists("sdm_read_result", mode = "function", inherits = TRUE)) {
  source(file.path(cache_integrity_root, "plumber", "R", "helpers", "plumber_helpers.R"), local = FALSE)
}
if (!exists("find_worldclim_files", mode = "function", inherits = TRUE)) {
  source(file.path(cache_integrity_root, "R", "covariates", "covariates_climate.R"), local = FALSE)
}
if (!exists("find_cmip6_files", mode = "function", inherits = TRUE)) {
  source(file.path(cache_integrity_root, "R", "covariates", "covariates_climate_future.R"), local = FALSE)
}

cache_integrity_stub_tif <- function(path, payload = as.raw(1:24)) {
  writeBin(c(as.raw(c(0x49, 0x49, 0x2A, 0x00)), payload), path)
  path
}

test_that("climate availability rejects same-size content changed after manifest write", {
  skip_if_not(requireNamespace("digest", quietly = TRUE), "digest required for SHA-256 manifest contract")
  d <- tempfile("climate-integrity-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- file.path(d, "wc2.1_10m_bio_1.tif")
  cache_integrity_stub_tif(path)
  write_cache_manifest(d, "worldclim", "10", path)
  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)
  valid_result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_equal(unlist(valid_result$available), 1L)

  original_size <- file.info(path)$size
  cache_integrity_stub_tif(path, payload = as.raw(25:48))
  expect_equal(file.info(path)$size, original_size)

  result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_length(result$available, 0)
  expect_equal(unlist(result$missing), 1L)
})

test_that("climate availability fails closed for a present malformed manifest", {
  d <- tempfile("climate-malformed-manifest-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- file.path(d, "wc2.1_10m_bio_1.tif")
  cache_integrity_stub_tif(path)
  writeLines("{not json", file.path(d, SDM_CLIMATE_MANIFEST_NAME))
  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)

  result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_length(result$available, 0)
  expect_equal(unlist(result$missing), 1L)
})

test_that("climate availability fails closed when manifest files are not a record map", {
  d <- tempfile("climate-malformed-record-map-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- file.path(d, "wc2.1_10m_bio_1.tif")
  cache_integrity_stub_tif(path)
  writeLines('{"source":"worldclim","files":"bad"}', file.path(d, SDM_CLIMATE_MANIFEST_NAME))
  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)

  result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_length(result$available, 0)
  expect_equal(unlist(result$missing), 1L)
})

test_that("climate availability fails closed for a malformed manifest entry", {
  d <- tempfile("climate-malformed-manifest-entry-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- file.path(d, "wc2.1_10m_bio_1.tif")
  cache_integrity_stub_tif(path)
  writeLines('{"source":"worldclim","files":{"wc2.1_10m_bio_1.tif":"bad"}}',
             file.path(d, SDM_CLIMATE_MANIFEST_NAME))
  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)

  result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_length(result$available, 0)
  expect_equal(unlist(result$missing), 1L)
})

test_that("result cache separates paths with identical mtimes", {
  d <- tempfile("result-path-integrity-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  first <- file.path(d, "first.rds")
  second <- file.path(d, "second.rds")
  saveRDS(list(label = "first"), first)
  saveRDS(list(label = "second"), second)
  stamp <- as.POSIXct("2024-01-01 00:00:00", tz = "UTC")
  Sys.setFileTime(first, stamp)
  Sys.setFileTime(second, stamp)
  expect_false(identical(sdm_result_cache_key(first), sdm_result_cache_key(second)))

  expect_identical(sdm_read_result(first)$label, "first")
  expect_identical(sdm_read_result(second)$label, "second")
})

test_that("malformed result records fail closed", {
  d <- tempfile("result-malformed-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- file.path(d, "result.rds")
  writeLines("not an RDS record", path)

  expect_null(sdm_read_result(path))
})

test_that("result cache rereads same-path bytes overwritten with preserved mtime", {
  d <- tempfile("result-content-integrity-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- file.path(d, "result.rds")
  saveRDS(list(label = "before"), path)
  stamp <- as.POSIXct("2024-01-01 00:00:00", tz = "UTC")
  Sys.setFileTime(path, stamp)
  expect_identical(sdm_read_result(path)$label, "before")
  before_key <- sdm_result_cache_key(path)

  saveRDS(list(label = "after"), path)
  Sys.setFileTime(path, stamp)
  expect_false(identical(before_key, sdm_result_cache_key(path)))
  expect_identical(sdm_read_result(path)$label, "after")
})

test_that("climate availability binds manifest identity to matcher-selected file", {
  skip_if_not(requireNamespace("digest", quietly = TRUE), "digest required for SHA-256 manifest contract")
  d <- tempfile("climate-misbound-")
  external <- tempfile("climate-external-")
  dir.create(d)
  dir.create(external)
  on.exit(unlink(c(d, external), recursive = TRUE), add = TRUE)
  filename <- "wc2.1_10m_bio_1.tif"
  selected <- cache_integrity_stub_tif(file.path(d, filename))
  cached_elsewhere <- cache_integrity_stub_tif(file.path(external, filename))
  write_cache_manifest(d, "worldclim", "10", cached_elsewhere)
  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)

  result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_length(result$available, 0)
  expect_equal(unlist(result$missing), 1L)
  expect_false(identical(normalizePath(selected), normalizePath(cached_elsewhere)))
})

test_that("CHELSA and CMIP6 availability requires matching verified manifests", {
  skip_if_not(requireNamespace("digest", quietly = TRUE), "digest required for SHA-256 manifest contract")
  root <- tempfile("climate-provider-manifests-")
  chelsa <- file.path(root, "chelsa")
  future <- file.path(root, "future")
  cmip6 <- file.path(future, "GCM_SSP_period")
  dir.create(chelsa, recursive = TRUE)
  dir.create(cmip6, recursive = TRUE)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  old_chelsa <- sdm_default_chelsa_dir
  old_future <- sdm_default_future_worldclim_dir
  assign("sdm_default_chelsa_dir", chelsa, envir = globalenv())
  assign("sdm_default_future_worldclim_dir", future, envir = globalenv())
  on.exit(assign("sdm_default_chelsa_dir", old_chelsa, envir = globalenv()), add = TRUE)
  on.exit(assign("sdm_default_future_worldclim_dir", old_future, envir = globalenv()), add = TRUE)

  chelsa_file <- cache_integrity_stub_tif(file.path(chelsa, "CHELSA_bio01_1981-2010_V.2.1.tif"))
  write_cache_manifest(chelsa, "chelsa", "0.5", chelsa_file)
  chelsa_check <- function() handle_climate_check(NULL, cache_integrity_root, "chelsa", "0.5", "1")
  expect_equal(unlist(chelsa_check()$available), 1L)
  manifest_path <- file.path(chelsa, SDM_CLIMATE_MANIFEST_NAME)
  manifest <- read_cache_manifest(chelsa)
  manifest$source <- "CHELSA"
  jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
  expect_length(chelsa_check()$available, 0)
  write_cache_manifest(chelsa, "chelsa", "0.5", chelsa_file)
  manifest <- read_cache_manifest(chelsa)
  manifest$files[[basename(chelsa_file)]]$sha256 <- NULL
  jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
  expect_length(chelsa_check()$available, 0)
  write_cache_manifest(chelsa, "chelsa", "0.5", chelsa_file)
  cache_integrity_stub_tif(chelsa_file, payload = as.raw(25:48))
  chelsa_result <- handle_climate_check(NULL, cache_integrity_root, "chelsa", "0.5", "1")
  expect_length(chelsa_result$available, 0)
  expect_equal(unlist(chelsa_result$missing), 1L)

  cmip6_file <- cache_integrity_stub_tif(file.path(cmip6, "wc2.1_10m_bioc1.tif"))
  write_cache_manifest(cmip6, "cmip6", "GCM_SSP_period", cmip6_file)
  cmip6_check <- function() handle_climate_check(NULL, cache_integrity_root, "cmip6", "10", "1",
                                                  gcm = "GCM", ssp = "SSP", period = "period")
  expect_equal(unlist(cmip6_check()$available), 1L)
  manifest_path <- file.path(cmip6, SDM_CLIMATE_MANIFEST_NAME)
  manifest <- read_cache_manifest(cmip6)
  manifest$source <- "CMIP6"
  jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
  expect_length(cmip6_check()$available, 0)
  write_cache_manifest(cmip6, "cmip6", "GCM_SSP_period", cmip6_file)
  manifest <- read_cache_manifest(cmip6)
  manifest$files[[basename(cmip6_file)]]$sha256 <- NULL
  jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
  expect_length(cmip6_check()$available, 0)
  write_cache_manifest(cmip6, "cmip6", "GCM_SSP_period", cmip6_file)
  cache_integrity_stub_tif(cmip6_file, payload = as.raw(25:48))
  cmip6_result <- handle_climate_check(NULL, cache_integrity_root, "cmip6", "10", "1",
                                       gcm = "GCM", ssp = "SSP", period = "period")
  expect_length(cmip6_result$available, 0)
  expect_equal(unlist(cmip6_result$missing), 1L)
})

test_that("availability checks only the real loader-selected duplicate path", {
  skip_if_not(requireNamespace("digest", quietly = TRUE), "digest required for SHA-256 manifest contract")
  d <- tempfile("climate-selected-duplicate-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  small <- cache_integrity_stub_tif(file.path(d, "wc2.1_10m_bio_1_small.tif"), as.raw(1:8))
  large <- cache_integrity_stub_tif(file.path(d, "wc2.1_10m_bio_1_large.tif"), as.raw(1:40))
  selected <- find_worldclim_files(d, 1L, "worldclim", "10")[[1L]]
  expect_identical(normalizePath(selected), normalizePath(large))
  write_cache_manifest(d, "worldclim", "10", c(small, large))

  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)
  result <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_equal(unlist(result$available), 1L)
  mixed <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1,2")
  expect_equal(unlist(mixed$available), 1L)
  expect_equal(unlist(mixed$missing), 2L)

  manifest_path <- file.path(d, SDM_CLIMATE_MANIFEST_NAME)
  manifest <- read_cache_manifest(d)
  manifest$source <- "WorldClim"
  jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
  expect_length(handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")$available, 0)
  write_cache_manifest(d, "worldclim", "10", c(small, large))
  manifest <- read_cache_manifest(d)
  manifest$files[[basename(large)]]$sha256 <- NULL
  jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
  expect_length(handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")$available, 0)
  write_cache_manifest(d, "worldclim", "10", c(small, large))

  cache_integrity_stub_tif(large, payload = as.raw(41:80))
  denied <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1")
  expect_length(denied$available, 0)
  expect_equal(unlist(denied$missing), 1L)
  expect_true(file.exists(small))

  future <- file.path(tempfile("climate-cmip6-duplicate-"), "GCM_SSP_period")
  dir.create(future, recursive = TRUE)
  on.exit(unlink(dirname(future), recursive = TRUE), add = TRUE)
  first <- cache_integrity_stub_tif(file.path(future, "a_wc2.1_10m_bioc1.tif"))
  later <- cache_integrity_stub_tif(file.path(future, "b_wc2.1_10m_bioc1.tif"), as.raw(25:48))
  selected_cmip6 <- find_cmip6_files(future, 1L)[[1L]]
  expect_identical(normalizePath(selected_cmip6), normalizePath(first))
  write_cache_manifest(future, "cmip6", "GCM_SSP_period", c(first, later))
  old_future <- sdm_default_future_worldclim_dir
  assign("sdm_default_future_worldclim_dir", dirname(future), envir = globalenv())
  on.exit(assign("sdm_default_future_worldclim_dir", old_future, envir = globalenv()), add = TRUE)
  selected_result <- handle_climate_check(NULL, cache_integrity_root, "cmip6", "10", "1",
                                           gcm = "GCM", ssp = "SSP", period = "period")
  expect_equal(unlist(selected_result$available), 1L)
  cache_integrity_stub_tif(first, payload = as.raw(49:72))
  denied_cmip6 <- handle_climate_check(NULL, cache_integrity_root, "cmip6", "10", "1",
                                       gcm = "GCM", ssp = "SSP", period = "period")
  expect_length(denied_cmip6$available, 0)
  expect_equal(unlist(denied_cmip6$missing), 1L)
})

test_that("sequential partial cache-manifest writes preserve verified records only", {
  skip_if_not(requireNamespace("digest", quietly = TRUE), "digest required for SHA-256 manifest contract")
  d <- tempfile("climate-partial-manifest-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  first <- cache_integrity_stub_tif(file.path(d, "wc2.1_10m_bio_1.tif"))
  second <- cache_integrity_stub_tif(file.path(d, "wc2.1_10m_bio_2.tif"), as.raw(25:48))
  write_cache_manifest(d, "worldclim", "10", first)
  write_cache_manifest(d, "worldclim", "10", second)
  manifest <- read_cache_manifest(d)
  expect_true(all(c(basename(first), basename(second)) %in% names(manifest$files)))

  old_dir <- sdm_default_worldclim_dir
  assign("sdm_default_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_worldclim_dir", old_dir, envir = globalenv()), add = TRUE)
  both <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1,2")
  expect_equal(sort(unlist(both$available)), c(1L, 2L))

  cache_integrity_stub_tif(first, payload = as.raw(49:72))
  write_cache_manifest(d, "worldclim", "10", second)
  preserved <- handle_climate_check(NULL, cache_integrity_root, "worldclim", "10", "1,2")
  expect_equal(unlist(preserved$available), 2L)
  expect_equal(unlist(preserved$missing), 1L)

  chelsa_dir <- file.path(d, "chelsa")
  dir.create(chelsa_dir)
  chelsa1 <- cache_integrity_stub_tif(file.path(chelsa_dir, "CHELSA_bio01_1981-2010_V.2.1.tif"))
  chelsa2 <- cache_integrity_stub_tif(file.path(chelsa_dir, "CHELSA_bio02_1981-2010_V.2.1.tif"), as.raw(25:48))
  write_cache_manifest(chelsa_dir, "chelsa", "0.5", chelsa1)
  write_cache_manifest(chelsa_dir, "chelsa", "0.5", chelsa2)
  old_chelsa <- sdm_default_chelsa_dir
  assign("sdm_default_chelsa_dir", chelsa_dir, envir = globalenv())
  on.exit(assign("sdm_default_chelsa_dir", old_chelsa, envir = globalenv()), add = TRUE)
  chelsa_both <- handle_climate_check(NULL, cache_integrity_root, "chelsa", "0.5", "1,2")
  expect_equal(sort(unlist(chelsa_both$available)), c(1L, 2L))
  cache_integrity_stub_tif(chelsa1, payload = as.raw(49:72))
  write_cache_manifest(chelsa_dir, "chelsa", "0.5", chelsa2)
  chelsa_preserved <- handle_climate_check(NULL, cache_integrity_root, "chelsa", "0.5", "1,2")
  expect_equal(unlist(chelsa_preserved$available), 2L)
  expect_equal(unlist(chelsa_preserved$missing), 1L)

  cmip6_dir <- file.path(d, "GCM_SSP_period")
  dir.create(cmip6_dir)
  cmip1 <- cache_integrity_stub_tif(file.path(cmip6_dir, "wc2.1_10m_bioc1.tif"))
  cmip2 <- cache_integrity_stub_tif(file.path(cmip6_dir, "wc2.1_10m_bioc2.tif"), as.raw(25:48))
  write_cache_manifest(cmip6_dir, "cmip6", "GCM_SSP_period", cmip1)
  write_cache_manifest(cmip6_dir, "cmip6", "GCM_SSP_period", cmip2)
  old_future <- sdm_default_future_worldclim_dir
  assign("sdm_default_future_worldclim_dir", d, envir = globalenv())
  on.exit(assign("sdm_default_future_worldclim_dir", old_future, envir = globalenv()), add = TRUE)
  cmip_both <- handle_climate_check(NULL, cache_integrity_root, "cmip6", "10", "1,2",
                                    gcm = "GCM", ssp = "SSP", period = "period")
  expect_equal(sort(unlist(cmip_both$available)), c(1L, 2L))
  cache_integrity_stub_tif(cmip1, payload = as.raw(49:72))
  write_cache_manifest(cmip6_dir, "cmip6", "GCM_SSP_period", cmip2)
  cmip_preserved <- handle_climate_check(NULL, cache_integrity_root, "cmip6", "10", "1,2",
                                         gcm = "GCM", ssp = "SSP", period = "period")
  expect_equal(unlist(cmip_preserved$available), 2L)
  expect_equal(unlist(cmip_preserved$missing), 1L)
})

test_that("names_fn resolves canonical manifest basenames", {
  skip_if_not(requireNamespace("digest", quietly = TRUE), "digest required for SHA-256 manifest contract")
  d <- tempfile("climate-names-fn-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  path <- cache_integrity_stub_tif(file.path(d, "custom_bio_1.tif"))
  write_cache_manifest(d, "worldclim", "10", path)
  expect_equal(check_manifest_for_biovars(d, "worldclim", 1L,
                                          names_fn = function(bv) "custom_bio_1.tif"), 1L)
})

test_that("availability rejects manifest identity inconsistent with the production writer", {
  root <- tempfile("climate-manifest-identity-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  old_worldclim <- sdm_default_worldclim_dir
  old_chelsa <- sdm_default_chelsa_dir
  old_future <- sdm_default_future_worldclim_dir
  on.exit(assign("sdm_default_worldclim_dir", old_worldclim, envir = globalenv()), add = TRUE)
  on.exit(assign("sdm_default_chelsa_dir", old_chelsa, envir = globalenv()), add = TRUE)
  on.exit(assign("sdm_default_future_worldclim_dir", old_future, envir = globalenv()), add = TRUE)

  for (provider in c("worldclim", "chelsa", "cmip6")) {
    directory <- file.path(root, provider)
    if (provider == "cmip6") directory <- file.path(directory, "GCM_SSP_period")
    dir.create(directory, recursive = TRUE)
    filename <- switch(provider, worldclim = "wc2.1_10m_bio_1.tif",
                       chelsa = "CHELSA_bio01_1981-2010_V.2.1.tif",
                       cmip6 = "wc2.1_10m_bioc1.tif")
    path <- cache_integrity_stub_tif(file.path(directory, filename))
    identity <- switch(provider, worldclim = "10", chelsa = "0.5",
                       cmip6 = "GCM_SSP_period")
    assign("sdm_default_worldclim_dir", directory, envir = globalenv())
    assign("sdm_default_chelsa_dir", directory, envir = globalenv())
    assign("sdm_default_future_worldclim_dir", dirname(directory), envir = globalenv())
    check <- function() handle_climate_check(NULL, cache_integrity_root, provider,
                                            if (provider == "chelsa") "0.5" else "10", "1",
                                            gcm = "GCM", ssp = "SSP", period = "period")
    # CMIP6's existing writer stores scenario identity in res, not pixel resolution.
    write_cache_manifest(directory, provider, identity, path)
    expect_equal(unlist(check()$available), 1L, info = provider)
    manifest <- read_cache_manifest(directory)
    manifest$res <- if (provider == "cmip6") "OTHER_SSP_period" else "5"
    jsonlite::write_json(manifest, file.path(directory, SDM_CLIMATE_MANIFEST_NAME),
                         auto_unbox = TRUE, pretty = TRUE)
    expect_length(check()$available, 0)
    expect_equal(unlist(check()$missing), 1L, info = provider)
  }
})
