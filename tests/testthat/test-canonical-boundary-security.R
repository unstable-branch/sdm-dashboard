test_that("custom mask resolution uses only the server-resolved file", {
  server_path <- file.path(tempdir(), "canonical-boundary.geojson")
  expect_identical(
    resolve_mask_file(
      boundary_type = "custom",
      resolution = "auto",
      country = "/tmp/client-controlled.geojson",
      default_file = server_path
    ),
    server_path
  )
})
