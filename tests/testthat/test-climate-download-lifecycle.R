test_that("climate data paths are rooted independently of the working directory", {
  root <- tempfile("sdm-project-")
  dir.create(root)
  relative <- sdm_resolve_project_path("chelsa", root = root)
  expect_equal(relative, normalizePath(file.path(root, "chelsa"), winslash = "/", mustWork = FALSE))

  absolute <- normalizePath(tempfile("absolute-climate-"), winslash = "/", mustWork = FALSE)
  expect_equal(sdm_resolve_project_path(absolute, root = root), absolute)
})


test_that("WorldClim resolution labels and cached archives are reusable", {
  expect_equal(sdm_worldclim_res_label(0.5), "30s")
  expect_equal(sdm_worldclim_res_label(2.5), "2.5m")

  cache <- tempfile("worldclim-archive-")
  dir.create(cache)
  source_dir <- tempfile("zip-source-")
  dir.create(source_dir)
  tif <- file.path(source_dir, "wc2.1_10m_bio_1.tif")
  writeBin(as.raw(rep(1, 32)), tif)
  archive <- file.path(cache, "wc2.1_10m_bio.zip")
  old <- setwd(source_dir)
  on.exit(setwd(old), add = TRUE)
  utils::zip(archive, basename(tif), flags = "-q")

  events <- list()
  reused <- download_worldclim_archive(
    10, cache,
    progress_fun = function(event) events[[length(events) + 1L]] <<- event
  )

  expect_equal(reused, archive)
  expect_true(isTRUE(events[[1]]$cached))
  expect_equal(events[[1]]$bytes_downloaded, as.numeric(file.info(archive)$size))
})

test_that("WorldClim cache reuse emits structured per-file byte progress", {
  cache <- tempfile("worldclim-cache-")
  dir.create(cache)
  files <- file.path(cache, sprintf("wc2.1_10m_bio_%d.tif", c(1, 12)))
  writeBin(as.raw(rep(1, 32)), files[1])
  writeBin(as.raw(rep(2, 64)), files[2])

  events <- list()
  result <- download_worldclim_bio(
    cache, c(1, 12), res = 10,
    progress_fun = function(event) events[[length(events) + 1L]] <<- event
  )

  expect_true(isTRUE(result$cached))
  expect_length(result$downloaded, 0)
  expect_equal(length(events), 2)
  expect_true(all(vapply(events, function(x) isTRUE(x$cached), logical(1))))
  expect_equal(vapply(events, `[[`, integer(1), "file_index"), 1:2)
  expect_true(all(vapply(events, function(x) is.numeric(x$bytes_downloaded) && x$bytes_downloaded > 0, logical(1))))
  expect_true(all(vapply(events, function(x) identical(x$stage, "climate_download"), logical(1))))
})

test_that("CHELSA valid cache files are reused without being rewritten", {
  cache <- tempfile("chelsa-cache-")
  dir.create(cache)
  path <- file.path(cache, "CHELSA_bio01_1981-2010_V.2.1.tif")
  # Classic little-endian TIFF signature; cache validation is intentionally cheap.
  writeBin(c(as.raw(c(73, 73, 42, 0)), as.raw(rep(0, 64))), path)
  before <- file.info(path)$mtime
  events <- list()

  result <- download_chelsa_bio(
    cache, 1,
    progress_fun = function(event) events[[length(events) + 1L]] <<- event
  )

  expect_true(isTRUE(result$cached))
  expect_length(result$downloaded, 0)
  expect_equal(file.info(path)$mtime, before)
  expect_true(isTRUE(events[[1]]$cached))
  expect_equal(events[[1]]$file_index, 1)
  expect_equal(events[[1]]$file_total, 1)
  expect_equal(events[[1]]$bytes_downloaded, as.numeric(file.info(path)$size))
})

test_that("pre-generated XYZ tiles are opt-in", {
  expect_false(sdm_default_generate_tiles)
  cfg <- sdm_config(
    occurrence_file = "unused.csv",
    projection_extent = c(112, 154, -44, -10)
  )
  expect_false(cfg$generate_tiles)
  explicit <- sdm_config(
    occurrence_file = "unused.csv",
    projection_extent = c(112, 154, -44, -10),
    generate_tiles = TRUE
  )
  expect_true(explicit$generate_tiles)
})
