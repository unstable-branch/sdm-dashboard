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

test_that("custom boundary default types unparseable content as a client content denial", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-corrupt-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  corrupt <- file.path(custom_dir, "corrupt.geojson")
  writeBin(as.raw(c(0x00, 0x01, 0xff, 0x7b, 0x80, 0x20)), corrupt)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$sdm_boundary_asset_path <- function(...) corrupt
  response <- new.env()
  result <- env$handle_boundary_default(
    response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111",
    req = list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  )
  # A hash-verified but unparseable own asset is a content-integrity denial,
  # not an upstream server fault, and the body must not carry the path.
  expect_equal(response$status, 422L)
  expect_equal(result$error, "Boundary content is not valid GeoJSON")
  expect_false(grepl(app_dir, result$error, fixed = TRUE))
})

test_that("a readable custom boundary asset still resolves its GeoJSON body", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-valid-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  valid <- file.path(custom_dir, "valid.geojson")
  writeLines('{"type":"FeatureCollection","features":[]}', valid)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$sdm_boundary_asset_path <- function(...) valid
  response <- new.env()
  result <- env$handle_boundary_default(
    response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111",
    req = list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  )
  expect_null(response$status)
  expect_equal(result$type, "FeatureCollection")
})

test_that("unreadable Natural Earth boundary data stays an upstream failure", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-ne-corrupt-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  corrupt <- file.path(custom_dir, "ne_corrupt.geojson")
  writeBin(as.raw(c(0x00, 0x01, 0xff, 0x80)), corrupt)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$resolve_mask_file <- function(...) corrupt
  response <- new.env()
  result <- env$handle_boundary_default(response, app_dir, type = "admin0", resolution = "110m")
  expect_equal(response$status, 500L)
  expect_equal(result$error, "Boundary read failed")
})

test_that("custom boundary extent types unparseable content as a client content denial", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-extent-corrupt-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  corrupt <- file.path(custom_dir, "corrupt.geojson")
  writeBin(as.raw(c(0x00, 0x01, 0xff, 0x7b, 0x80, 0x20)), corrupt)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$sdm_boundary_asset_path <- function(...) corrupt
  response <- new.env()
  result <- env$handle_boundary_extent(
    response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111",
    req = list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  )
  expect_equal(response$status, 422L)
  expect_equal(result$error, "Boundary content is not a usable geometry")
  expect_false(grepl(app_dir, result$error, fixed = TRUE))
})

test_that("a valid canonical custom asset still resolves its extent", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-extent-valid-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  valid <- file.path(custom_dir, "valid.geojson")
  writeLines(
    paste0('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"x"},',
           '"geometry":{"type":"Polygon","coordinates":[[[100.0,-1.0],[101.0,-1.0],',
           '[101.0,0.0],[100.0,0.0],[100.0,-1.0]]]}}]}'),
    valid
  )
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$sdm_boundary_asset_path <- function(...) valid
  response <- new.env()
  result <- env$handle_boundary_extent(
    response, app_dir, type = "custom", buffer_deg = 1,
    boundary_asset_id = "11111111-1111-4111-8111-111111111111",
    req = list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  )
  expect_null(response$status)
  expect_equal(as.numeric(result$xmin), 99)
  expect_equal(as.numeric(result$xmax), 102)
  expect_equal(as.numeric(result$ymin), -2)
  expect_equal(as.numeric(result$ymax), 1)
})

test_that("a read failure for a canonical custom asset stays an upstream failure", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-read-failure-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  valid <- file.path(custom_dir, "valid.geojson")
  writeLines('{"type":"FeatureCollection","features":[]}', valid)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  request <- list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  env$sdm_boundary_asset_path <- function(...) valid
  env$sdm_boundary_read_asset_bytes <- function(...) stop("injected read failure")

  default_response <- new.env()
  default_result <- env$handle_boundary_default(
    default_response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111", req = request
  )
  expect_equal(default_response$status, 500L)
  expect_equal(default_result$error, "Boundary read failed")

  extent_response <- new.env()
  extent_result <- env$handle_boundary_extent(
    extent_response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111", req = request
  )
  expect_equal(extent_response$status, 500L)
  expect_equal(extent_result$error, "Boundary read failed")
})

test_that("an unavailable JSON parser for canonical custom content stays an upstream failure", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-parser-unavailable-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  valid <- file.path(custom_dir, "valid.geojson")
  writeLines('{"type":"FeatureCollection","features":[]}', valid)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  request <- list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  env$sdm_boundary_asset_path <- function(...) valid
  env$sdm_boundary_parser_available <- function() FALSE

  default_response <- new.env()
  default_result <- env$handle_boundary_default(
    default_response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111", req = request
  )
  expect_equal(default_response$status, 500L)
  expect_equal(default_result$error, "Boundary read failed")

  extent_response <- new.env()
  extent_result <- env$handle_boundary_extent(
    extent_response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111", req = request
  )
  expect_equal(extent_response$status, 500L)
  expect_equal(extent_result$error, "Boundary read failed")
})

test_that("an unavailable geometry runtime stays an upstream failure", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-terra-unavailable-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  valid <- file.path(custom_dir, "valid.geojson")
  writeLines('{"type":"FeatureCollection","features":[]}', valid)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$sdm_boundary_asset_path <- function(...) valid
  env$sdm_boundary_terra_available <- function() FALSE

  # A syntactically valid canonical asset must not become a 422 simply because
  # the geometry runtime is missing.
  custom_response <- new.env()
  custom_result <- env$handle_boundary_extent(
    custom_response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111",
    req = list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  )
  expect_equal(custom_response$status, 500L)
  expect_equal(custom_result$error, "Boundary processing is unavailable")

  # Natural Earth sources are unaffected and stay an upstream failure.  Use a
  # present server-owned NE file so the case never reaches a download.
  ne_dir <- file.path(app_dir, "data", "boundaries", "ne", "110m")
  dir.create(ne_dir, recursive = TRUE)
  ne_file <- file.path(ne_dir, "ne_10m_admin_0_countries.geojson")
  writeLines('{"type":"FeatureCollection","features":[]}', ne_file)
  ne_env <- env
  sys.source(file.path(project_root, "R", "covariates", "ne_boundary.R"), envir = ne_env)
  ne_response <- new.env()
  ne_result <- ne_env$handle_boundary_extent(ne_response, app_dir, type = "admin0", resolution = "110m")
  expect_equal(ne_response$status, 500L)
  expect_equal(ne_result$error, "Boundary processing is unavailable")
})

test_that("an unexpected geometry processing failure for a canonical asset stays an upstream failure", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-processing-failure-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  # A structurally valid GeoJSON document, so content classification passes; the
  # geometry runtime then fails for a server-side reason.  That must stay 5xx.
  valid <- file.path(custom_dir, "valid.geojson")
  writeLines(
    paste0('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},',
           '"geometry":{"type":"Point","coordinates":[1.0,2.0]}}]}'),
    valid
  )
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)

  env$sdm_boundary_asset_path <- function(...) valid
  env$sdm_boundary_compute_extent <- function(...) stop("injected geometry runtime failure")
  response <- new.env()
  result <- suppressWarnings(env$handle_boundary_extent(
    response, app_dir, type = "custom",
    boundary_asset_id = "11111111-1111-4111-8111-111111111111",
    req = list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")
  ))
  expect_equal(response$status, 500L)
  expect_equal(result$error, "Boundary extent failed")
})

test_that("clearly invalid GeoJSON content is a typed client denial from both readers", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)
  app_dir <- tempfile("sdm-boundary-invalid-geojson-")
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(custom_dir, recursive = TRUE)
  on.exit(unlink(app_dir, recursive = TRUE, force = TRUE), add = TRUE)
  request <- list(user_id = "22222222-2222-4222-8222-222222222222", user_role = "editor")

  invalid_documents <- list(
    # Unsupported top-level type: demonstrably not a GeoJSON document.
    bogus_type = '{"type":"BogusCollection","features":[]}',
    # Structurally invalid FeatureCollection: the required member is absent.
    missing_features = '{"type":"FeatureCollection"}',
    # Geometry type without the required coordinates member.
    polygon_without_coordinates = '{"type":"Polygon"}',
    # Coordinates that are not an array at all (reviewer round-3 case A).
    point_coordinates_not_array = '{"type":"Point","coordinates":"not-an-array"}',
    # Coordinates that are an array but whose ordinals are not numbers.
    point_coordinates_not_numbers = '{"type":"Point","coordinates":["a","b"]}',
    # Nesting shape does not match the declared geometry type.
    polygon_coordinates_not_rings = '{"type":"Polygon","coordinates":[1,2]}',
    # A Feature whose nested geometry declares an unsupported type
    # (reviewer round-3 case B).
    feature_with_unsupported_geometry =
      '{"type":"Feature","geometry":{"type":"BogusGeometry","coordinates":[]},"properties":{}}',
    # A Feature whose nested geometry has a malformed coordinate shape.
    feature_with_malformed_geometry =
      '{"type":"Feature","geometry":{"type":"LineString","coordinates":[1,2]},"properties":{}}',
    # A FeatureCollection whose single feature carries malformed nested content.
    collection_with_invalid_feature = paste0(
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},',
      '"geometry":{"type":"MultiPolygon","coordinates":"nope"}}]}'
    ),
    # Feature without the required properties member (reviewer round-4 case A).
    feature_missing_properties = '{"type":"Feature","geometry":null}',
    # Feature whose properties member is not an object or null (round-4 case B).
    feature_properties_not_object = '{"type":"Feature","geometry":null,"properties":"not-an-object"}',
    feature_properties_array = '{"type":"Feature","geometry":null,"properties":[]}',
    # An optional Feature id must be a JSON string or number.
    feature_id_not_string_or_number = '{"type":"Feature","id":{"a":1},"geometry":null,"properties":{}}',
    # A Polygon linear ring must be closed (round-4 case C).
    polygon_unclosed_ring =
      '{"type":"Polygon","coordinates":[[[0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]]]}',
    # A linear ring needs four or more positions.
    polygon_ring_too_short = '{"type":"Polygon","coordinates":[[[0.0,0.0],[1.0,0.0],[0.0,0.0]]]}',
    # The closure comparison includes the ordinal count.
    polygon_ring_closure_ordinal_mismatch =
      '{"type":"Polygon","coordinates":[[[0.0,0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,0.0]]]}',
    multipolygon_unclosed_ring =
      '{"type":"MultiPolygon","coordinates":[[[[0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]]]]}',
    # A nested Feature in a collection must satisfy the same Feature rules.
    collection_feature_missing_properties =
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}',
    # A GeometryCollection member must be a Geometry object.
    geometry_collection_invalid_member =
      '{"type":"GeometryCollection","geometries":[{"type":"BogusGeometry","coordinates":[]}]}',
    # MultiPoint coordinates must be an array of Position arrays.
    multipoint_positions_not_arrays = '{"type":"MultiPoint","coordinates":[1.0,2.0]}',
    # A LineString needs two or more positions.
    linestring_single_position = '{"type":"LineString","coordinates":[[1.0,2.0]]}',
    # RFC 7946 section 7.1: an object must not carry the defining member of
    # another GeoJSON type (reviewer round-6 case A).
    feature_collection_with_geometry_member =
      '{"type":"FeatureCollection","features":[],"geometry":null}',
    feature_collection_with_properties_member =
      '{"type":"FeatureCollection","features":[],"properties":{}}',
    feature_collection_with_coordinates_member =
      '{"type":"FeatureCollection","features":[],"coordinates":[[0.0,0.0]]}',
    feature_collection_with_geometries_member =
      '{"type":"FeatureCollection","features":[],"geometries":[]}',
    feature_collection_with_id_member =
      '{"type":"FeatureCollection","features":[],"id":1}',
    # A Feature must not carry the FeatureCollection or Geometry members.
    feature_with_features_member =
      '{"type":"Feature","geometry":null,"properties":{},"features":[]}',
    feature_with_coordinates_member =
      '{"type":"Feature","geometry":null,"properties":{},"coordinates":[[0.0,0.0]]}',
    feature_with_geometries_member =
      '{"type":"Feature","geometry":null,"properties":{},"geometries":[]}',
    # A Geometry must not carry the Feature or FeatureCollection members.
    point_with_geometry_member = '{"type":"Point","coordinates":[1.0,2.0],"geometry":null}',
    point_with_properties_member = '{"type":"Point","coordinates":[1.0,2.0],"properties":{}}',
    point_with_features_member = '{"type":"Point","coordinates":[1.0,2.0],"features":[]}',
    # A geometry must not carry the GeometryCollection member, and a
    # GeometryCollection must not carry coordinates.
    point_with_geometries_member = '{"type":"Point","coordinates":[1.0,2.0],"geometries":[]}',
    geometry_collection_with_coordinates_member =
      '{"type":"GeometryCollection","geometries":[],"coordinates":[]}',
    # The same §7.1 rule holds for a nested Feature/geometry in a collection.
    collection_feature_with_properties_member = paste0(
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},',
      '"geometry":{"type":"Point","coordinates":[1.0,2.0],"properties":{}}}]}'
    ),
    # A present Feature id must be a JSON string or number (RFC 7946 §3.2).
    feature_id_null = '{"type":"Feature","id":null,"geometry":null,"properties":{}}',
    feature_id_boolean = '{"type":"Feature","id":true,"geometry":null,"properties":{}}',
    feature_id_array = '{"type":"Feature","id":[1],"geometry":null,"properties":{}}',
    # The "type" member must be present under its exact name.  R's `$` performs
    # partial matching on named lists, so a misnamed member such as "typex" was
    # read as the declared type (reviewer round-7 case).
    top_level_type_misnamed = '{"typex":"Point","coordinates":[1.0,2.0]}',
    top_level_feature_type_misnamed = '{"typex":"Feature","geometry":null,"properties":{}}',
    # ... and the same rule applies to the nested Feature/geometry validators.
    nested_feature_type_misnamed = paste0(
      '{"type":"FeatureCollection","features":[{"typex":"Feature","geometry":null,"properties":{}}]}'
    ),
    nested_geometry_type_misnamed = paste0(
      '{"type":"Feature","geometry":{"typex":"Point","coordinates":[1.0,2.0]},"properties":{}}'
    ),
    nested_geometry_collection_member_type_misnamed = paste0(
      '{"type":"GeometryCollection","geometries":[{"typex":"Point","coordinates":[1.0,2.0]}]}'
    ),
    # Two members that both start with "type" are an ambiguous partial match.
    ambiguous_type_members = '{"typex":"Point","typey":"Point","coordinates":[1.0,2.0]}',
    # A present but JSON-null "type" member is not a declared type.
    type_null = '{"type":null,"coordinates":[1.0,2.0]}'
  )

  for (fixture in invalid_documents) {
    target <- file.path(custom_dir, "invalid.geojson")
    writeLines(fixture, target)
    env$sdm_boundary_asset_path <- function(...) target

    default_response <- new.env()
    default_result <- env$handle_boundary_default(
      default_response, app_dir, type = "custom",
      boundary_asset_id = "11111111-1111-4111-8111-111111111111", req = request
    )
    expect_equal(default_response$status, 422L)
    expect_equal(default_result$error, "Boundary content is not valid GeoJSON")
    expect_false(grepl(app_dir, default_result$error, fixed = TRUE))

    extent_response <- new.env()
    extent_result <- suppressWarnings(env$handle_boundary_extent(
      extent_response, app_dir, type = "custom",
      boundary_asset_id = "11111111-1111-4111-8111-111111111111", req = request
    ))
    expect_equal(extent_response$status, 422L)
    expect_equal(extent_result$error, "Boundary content is not a usable geometry")
    expect_false(grepl(app_dir, extent_result$error, fixed = TRUE))
  }
})

test_that("structurally valid GeoJSON documents are not over-rejected", {
  env <- new.env(parent = globalenv())
  sys.source(file.path(project_root, "plumber", "R", "helpers", "boundary_helpers.R"), envir = env)

  valid_documents <- list(
    point = '{"type":"Point","coordinates":[1.0,2.0]}',
    point_3d = '{"type":"Point","coordinates":[1.0,2.0,3.0]}',
    multipoint = '{"type":"MultiPoint","coordinates":[[1.0,2.0],[3.0,4.0]]}',
    linestring = '{"type":"LineString","coordinates":[[1.0,2.0],[3.0,4.0]]}',
    polygon_with_hole = paste0(
      '{"type":"Polygon","coordinates":[',
      '[[0.0,0.0],[4.0,0.0],[4.0,4.0],[0.0,4.0],[0.0,0.0]],',
      '[[1.0,1.0],[2.0,1.0],[2.0,2.0],[1.0,2.0],[1.0,1.0]]]}'
    ),
    multipolygon = paste0(
      '{"type":"MultiPolygon","coordinates":[[',
      '[[0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0],[0.0,0.0]]]]}'
    ),
    geometry_collection = paste0(
      '{"type":"GeometryCollection","geometries":[',
      '{"type":"Point","coordinates":[1.0,2.0]},',
      '{"type":"LineString","coordinates":[[1.0,2.0],[3.0,4.0]]}]}'
    ),
    # RFC 7946 permits a Feature with a null geometry.
    feature_null_geometry = '{"type":"Feature","geometry":null,"properties":{}}',
    # ... and a null properties value, plus string/number identifiers.
    feature_null_properties = '{"type":"Feature","geometry":null,"properties":null}',
    feature_string_id = '{"type":"Feature","id":"abc","geometry":null,"properties":{}}',
    feature_numeric_id = '{"type":"Feature","id":7,"geometry":null,"properties":{}}',
    multilinestring = paste0(
      '{"type":"MultiLineString","coordinates":[',
      '[[0.0,0.0],[1.0,1.0]],[[2.0,2.0],[3.0,3.0]]]}'
    ),
    polygon_3d_closed_ring = paste0(
      '{"type":"Polygon","coordinates":[[',
      '[0.0,0.0,0.0],[1.0,0.0,0.0],[1.0,1.0,0.0],[0.0,0.0,0.0]]]}'
    ),
    geometry_collection_nested = paste0(
      '{"type":"GeometryCollection","geometries":[',
      '{"type":"GeometryCollection","geometries":[]}]}'
    ),
    # Foreign members (including the sf/GDAL "name" and "crs" members) are not
    # rejected, so a converted upload stays a valid boundary.
    feature_collection_with_foreign_members = paste0(
      '{"type":"FeatureCollection","name":"file","crs":{"type":"name","properties":',
      '{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},"features":[{"type":"Feature","properties":{},',
      '"geometry":{"type":"Polygon","coordinates":[[[0.0,0.0],[4.0,0.0],[4.0,4.0],[0.0,4.0],[0.0,0.0]]]}}]}'
    ),
    feature_collection = paste0(
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"x"},',
      '"geometry":{"type":"Point","coordinates":[1.0,2.0]}}]}'
    ),
    empty_feature_collection = '{"type":"FeatureCollection","features":[]}',
    # "bbox" is an optional member of every GeoJSON object (RFC 7946 §5), and a
    # Feature may combine it with an id and foreign members.
    point_with_bbox = '{"type":"Point","coordinates":[1.0,2.0],"bbox":[1.0,2.0,1.0,2.0]}',
    feature_with_id_bbox_and_foreign_member =
      '{"type":"Feature","id":"abc","geometry":null,"properties":{},"bbox":[0.0,0.0,0.0,0.0],"name":"file"}',
    feature_collection_with_bbox_and_foreign_members = paste0(
      '{"type":"FeatureCollection","name":"file","crs":{"type":"name"},',
      '"bbox":[0.0,0.0,1.0,1.0],"features":[{"type":"Feature","properties":null,',
      '"geometry":{"type":"Point","coordinates":[1.0,2.0]}}]}'
    )
  )

  for (fixture in valid_documents) {
    parsed <- jsonlite::fromJSON(fixture, simplifyVector = FALSE)
    expect_true(env$sdm_boundary_geojson_is_valid(parsed))
  }
})

test_that("download filenames are unique even for the same Natural Earth request", {
  first <- boundary_env$sdm_boundary_download_filename("admin0", "110m", "all")
  second <- boundary_env$sdm_boundary_download_filename("admin0", "110m", "all")
  expect_false(identical(first, second))
  expect_true(grepl("^ne_110m_admin0_admin0_[A-Za-z0-9]+\\.geojson$", first))
})
