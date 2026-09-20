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
test_that("download filenames are unique even for the same Natural Earth request", {
  first <- boundary_env$sdm_boundary_download_filename("admin0", "110m", "all")
  second <- boundary_env$sdm_boundary_download_filename("admin0", "110m", "all")
  expect_false(identical(first, second))
  expect_true(grepl("^ne_110m_admin0_admin0_[A-Za-z0-9]+\\.geojson$", first))
})
