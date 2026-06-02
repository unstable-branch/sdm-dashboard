test_that("build_community_matrix errors with single-species input", {
  env <- make_test_raster(n_layers = 1, layer_names = "bio1")
  sp1 <- data.frame(longitude = 140.5, latitude = -23.5)
  expect_error(build_community_matrix(list(sp1), env), "least 2 species")
})

test_that("build_community_matrix errors with insufficient sites", {
  env <- make_test_raster(n_layers = 1, layer_names = "bio1")
  sp1 <- data.frame(longitude = 140.1, latitude = -23.1)
  sp2 <- data.frame(longitude = 141.0, latitude = -24.0)
  expect_error(build_community_matrix(list(a = sp1, b = sp2), env, background_n = 5), "least 2 species")
})

test_that("build_community_matrix returns correct dimensions", {
  env <- make_test_raster(n_layers = 2, layer_names = c("bio1", "bio12"), nrows = 15, ncols = 15)
  sp1 <- data.frame(longitude = c(140.1, 140.5, 141.0), latitude = c(-23.1, -23.5, -23.8))
  sp2 <- data.frame(longitude = c(140.2, 140.8, 141.5), latitude = c(-23.2, -23.6, -23.9))
  cm <- build_community_matrix(list(sp_a = sp1, sp_b = sp2), env, background_n = 30, seed = 42)
  expect_equal(cm$n_species, 2)
  expect_equal(ncol(cm$community_mat), 2)
  expect_true(cm$n_sites >= 10)
  expect_equal(length(cm$species_names), 2)
  expect_true(is.character(cm$covariates))
})
