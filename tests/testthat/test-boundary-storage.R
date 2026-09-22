# Synthetic boundary storage tests. No provider or live network operation is used.

boundary_env <- new.env(parent = globalenv())
sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = boundary_env)

test_that("boundary storage uses one configured server-owned root", {
  expect_equal(
    boundary_env$sdm_boundary_storage_root("/app"),
    "/app/data/boundaries"
  )
  expect_equal(
    boundary_env$sdm_boundary_storage_root("/app", "/srv/sdm-boundaries"),
    "/srv/sdm-boundaries"
  )
})

test_that("boundary path resolution rejects traversal and accepts only regular in-root files", {
  root <- tempfile("sdm-boundary-root-")
  dir.create(file.path(root, "custom"), recursive = TRUE)
  safe <- file.path(root, "custom", "safe.geojson")
  writeLines("{}", safe)
  on.exit(unlink(root, recursive = TRUE, force = TRUE), add = TRUE)

  expect_equal(
    normalizePath(boundary_env$sdm_resolve_boundary_path(safe, root), winslash = "/"),
    normalizePath(safe, winslash = "/")
  )
  expect_null(boundary_env$sdm_resolve_boundary_path(file.path(root, "..", basename(root), "custom", "safe.geojson"), root))
  expect_null(boundary_env$sdm_resolve_boundary_path(file.path(dirname(root), "outside.geojson"), root))

  outside <- tempfile(fileext = ".geojson")
  writeLines("{}", outside)
  link <- file.path(root, "custom", "link.geojson")
  file.symlink(outside, link)
  expect_null(boundary_env$sdm_resolve_boundary_path(link, root))
  unlink(outside, force = TRUE)

  linkroot <- tempfile("sdm-boundary-link-root-")
  file.symlink(root, linkroot)
  expect_false(boundary_env$sdm_boundary_root_is_safe(linkroot))
  expect_null(boundary_env$sdm_resolve_boundary_path(file.path(linkroot, "custom", "safe.geojson"), linkroot))
  unlink(linkroot, force = TRUE)

  outside_dir <- tempfile("sdm-boundary-custom-target-")
  dir.create(outside_dir)
  custom_link <- file.path(root, "custom")
  unlink(custom_link, recursive = TRUE, force = TRUE)
  file.symlink(outside_dir, custom_link)
  expect_true(boundary_env$sdm_boundary_path_has_symlink(custom_link, root))
  unlink(custom_link, force = TRUE)
  unlink(outside_dir, recursive = TRUE, force = TRUE)
})

test_that("boundary conversion destinations reject pre-existing symlinks", {
  root <- tempfile("sdm-boundary-conversion-root-")
  dir.create(file.path(root, "custom"), recursive = TRUE)
  outside <- tempfile(fileext = ".geojson")
  writeLines("{}", outside)
  destination <- file.path(root, "custom", "converted.geojson")
  file.symlink(outside, destination)
  on.exit(unlink(c(root, outside), recursive = TRUE, force = TRUE), add = TRUE)

  expect_false(boundary_env$sdm_boundary_destination_is_safe(destination, root))
})

test_that("Natural Earth paths use the configured boundary root", {
  previous <- Sys.getenv("SDM_INPUT_ASSET_BOUNDARY_ROOT", unset = "")
  Sys.setenv(SDM_INPUT_ASSET_BOUNDARY_ROOT = "/srv/sdm-boundaries")
  on.exit(if (nzchar(previous)) Sys.setenv(SDM_INPUT_ASSET_BOUNDARY_ROOT = previous) else Sys.unsetenv("SDM_INPUT_ASSET_BOUNDARY_ROOT"), add = TRUE)
  ne_env <- new.env(parent = boundary_env)
  sys.source(file.path(project_root, "R", "covariates", "ne_boundary.R"), envir = ne_env)
  expect_equal(
    ne_env$get_ne_boundary_path("110m", "admin0"),
    "/srv/sdm-boundaries/ne/110m/ne_10m_admin_0_countries.geojson"
  )
})
test_that("Natural Earth descendant symlinks are rejected", {
  boundary_root <- tempfile("sdm-boundary-ne-root-")
  outside <- tempfile("sdm-boundary-ne-target-")
  dir.create(boundary_root, recursive = TRUE)
  dir.create(outside, recursive = TRUE)
  file.symlink(outside, file.path(boundary_root, "ne"))
  on.exit(unlink(c(boundary_root, outside), recursive = TRUE, force = TRUE), add = TRUE)
  ne_path <- file.path(boundary_root, "ne", "110m", "ne_10m_admin_0_countries.geojson")
  expect_true(boundary_env$sdm_boundary_path_has_symlink(ne_path, boundary_root))
})

test_that("custom mask resolution uses the server-resolved file instead of country paths", {
  ne_env <- new.env(parent = boundary_env)
  sys.source(file.path(project_root, "R", "covariates", "ne_boundary.R"), envir = ne_env)
  resolved <- tempfile(fileext = ".geojson")
  writeLines("{}", resolved)
  on.exit(unlink(resolved, force = TRUE), add = TRUE)

  expect_equal(ne_env$resolve_mask_file("custom", "110m", "/etc/passwd", default_file = resolved), resolved)
  expect_null(ne_env$resolve_mask_file("custom", "110m", "/etc/passwd", default_file = NULL))
})

test_that("Natural Earth archive members stay relative to the extraction root", {
  ne_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "R", "covariates", "ne_boundary.R"), ne_env)
  expect_true(ne_env$sdm_ne_archive_members_safe(c("ne/file.geojson", "ne/")))
  expect_false(ne_env$sdm_ne_archive_members_safe(c("../outside.geojson")))
  expect_false(ne_env$sdm_ne_archive_members_safe(c("/absolute.geojson")))
  expect_false(ne_env$sdm_ne_archive_members_safe(c("C:/absolute.geojson")))
})

test_that("download rejects custom path aliases before reading a source file", {
  download_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = download_env)
  download_env$resolve_mask_file <- function(...) stop("source file lookup must not run")
  app_dir <- tempfile("sdm-boundary-download-")
  dir.create(app_dir, recursive = TRUE)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)
  response <- new.env()
  result <- download_env$handle_boundary_download(response, app_dir, type = "custom", country = "/etc/passwd")
  expect_equal(response$status, 400L)
  expect_equal(result$status, "error")
})

test_that("extent rejects invalid selectors before resolving a boundary", {
  extent_env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = extent_env)
  app_dir <- tempfile("sdm-boundary-extent-")
  dir.create(app_dir, recursive = TRUE)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  response <- new.env()
  result <- extent_env$handle_boundary_extent(response, app_dir, type = "not-a-boundary", resolution = "110m")
  expect_equal(response$status, 400L)
  expect_equal(result$error, "Invalid boundary type or resolution")
})

test_that("custom producer reads require a canonical boundary asset ID", {
  app_dir <- tempfile("sdm-boundary-canonical-read-")
  dir.create(app_dir, recursive = TRUE)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)
  request <- list(user_id = "11111111-1111-4111-8111-111111111111", user_role = "editor")

  default_response <- new.env()
  default_result <- boundary_env$handle_boundary_default(
    default_response, app_dir, type = "custom", file_path = "/etc/passwd", req = request
  )
  expect_equal(default_response$status, 400L)
  expect_equal(default_result$error, "Custom boundaries require a canonical asset ID")

  extent_response <- new.env()
  extent_result <- boundary_env$handle_boundary_extent(
    extent_response, app_dir, file_path = "/etc/passwd", type = "custom", req = request
  )
  expect_equal(extent_response$status, 400L)
  expect_equal(extent_result$error, "Custom boundaries require a canonical asset ID")
})

test_that("download filenames are unique even for the same Natural Earth request", {
  first <- boundary_env$sdm_boundary_download_filename("admin0", "110m", "all")
  second <- boundary_env$sdm_boundary_download_filename("admin0", "110m", "all")
  expect_false(identical(first, second))
  expect_true(grepl("^ne_110m_admin0_admin0_[A-Za-z0-9]+\\.geojson$", first))
})
