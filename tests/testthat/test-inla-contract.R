test_that("INLA registry entry absent when INLA not installed", {
  ids <- sdm_model_ids()
  if (!requireNamespace("INLA", quietly = TRUE)) {
    expect_false("inla_spde" %in% ids)
  } else {
    expect_true("inla_spde" %in% ids)
  }
})

test_that("build_inla_mesh returns expected structure", {
  skip_if_not_installed("INLA")
  coords <- data.frame(x = runif(20, 140, 142), y = runif(20, -24, -22))
  mesh <- build_inla_mesh(coords)
  expect_true(is.list(mesh))
  expect_true(mesh$n >= 10)
})
