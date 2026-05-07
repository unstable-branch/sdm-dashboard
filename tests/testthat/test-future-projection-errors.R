test_that("future projection files check returns clear missing BIO message", {
  tmp <- tempfile("future-worldclim-")
  dir.create(tmp)
  file.create(file.path(tmp, "wc2.1_10m_bio_1.tif"))

  files <- future_projection_files(tmp, c(1, 12))
  expect_true(is.na(files["12"]))

  expect_false(future_projection_ready(tmp, c(1, 12)))
  expect_true(future_projection_ready(tmp, c(1)))
})

test_that("future projection dies with helpful message on missing BIO", {
  tmp <- tempfile("future-worldclim-")
  dir.create(tmp)
  file.create(file.path(tmp, "wc2.1_10m_bio_1.tif"))

  expect_error(
    project_future_suitability(
      fit = list(),
      current_suitability = terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 142, ymin = -24, ymax = -22),
      env = list(env_project = terra::rast(nrows = 10, ncols = 10, xmin = 140, xmax = 142, ymin = -24, ymax = -22, val = seq(0.1, 0.9, length.out = 100)), means = c(bio1 = 0.5), sds = c(bio1 = 0.1)),
      future_worldclim_dir = tmp,
      selected_biovars = c(1, 12),
      projection_extent = c(140, 142, -24, -22),
      output_future_tif = tempfile(fileext = ".tif"),
      output_delta_tif = tempfile(fileext = ".tif"),
      n_cores = 1
    ),
    "Missing future climate layer"
  )
})