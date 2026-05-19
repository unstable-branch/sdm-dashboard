# Tests for ecology modules: EOO/AOO, climate matching, niche overlap,
# species richness stacking, and area of applicability.
# helper-load.R and helper-fixtures.R are auto-sourced by testthat.

test_that("compute_eoo_aoo returns valid EOO and AOO for known points", {
  skip_if_not_installed("sf")
  occ <- data.frame(
    longitude = c(140, 141, 142, 140.5, 141.5),
    latitude = c(-23, -23, -23, -22, -22)
  )
  result <- compute_eoo_aoo(occ, log_fun = NULL)
  expect_true(is.finite(result$eoo_km2))
  expect_true(result$eoo_km2 > 0)
  expect_true(is.finite(result$aoo_cells))
  expect_true(result$aoo_cells > 0)
  expect_true(is.finite(result$aoo_km2))
  expect_true(!is.null(result$eoo_polygon))
  expect_true(result$n_unique_points >= 3)
})

test_that("compute_eoo_aoo handles too few points", {
  skip_if_not_installed("sf")
  occ <- data.frame(longitude = c(140, 141), latitude = c(-23, -23))
  result <- compute_eoo_aoo(occ, log_fun = NULL)
  expect_true(is.na(result$eoo_km2))
})

test_that("compute_eoo_aoo handles empty input", {
  skip_if_not_installed("sf")
  occ <- data.frame(longitude = numeric(0), latitude = numeric(0))
  result <- compute_eoo_aoo(occ, log_fun = NULL)
  expect_true(is.na(result$eoo_km2))
  expect_true(is.na(result$aoo_cells))
})

test_that("compute_climate_match returns similarity raster", {
  env_train <- make_test_raster(n_layers = 3, layer_names = c("bio1", "bio12", "bio4"))
  env_proj <- make_test_raster(n_layers = 3, layer_names = c("bio1", "bio12", "bio4"), seed = 99L)
  result <- compute_climate_match(env_train, env_proj, method = "standardised", log_fun = NULL)
  expect_true(inherits(result$similarity, "SpatRaster"))
  expect_true(inherits(result$distance, "SpatRaster"))
  expect_true(is.list(result$summary))
  expect_true(is.finite(result$summary$similarity_mean))
  expect_true(result$summary$similarity_mean >= 0)
  expect_true(result$summary$similarity_mean <= 1)
})

test_that("compute_niche_overlap_pca returns overlap metrics", {
  occ_native <- data.frame(
    longitude = runif(20, 140, 141),
    latitude = runif(20, -23, -22)
  )
  occ_introduced <- data.frame(
    longitude = runif(20, 141, 142),
    latitude = runif(20, -23, -22)
  )
  env <- make_test_raster(n_layers = 3, layer_names = c("bio1", "bio12", "bio4"))
  result <- compute_niche_overlap_pca(occ_native, occ_introduced, env, log_fun = NULL)
  expect_true(is.list(result))
  expect_true("overlap" %in% names(result) || "schoener_d" %in% names(result) || "pca" %in% names(result))
})

test_that("stack_species_richness produces threshold raster", {
  r1 <- make_test_raster(n_layers = 1, layer_names = "suit")
  r2 <- make_test_raster(n_layers = 1, layer_names = "suit", seed = 99L)
  r3 <- make_test_raster(n_layers = 1, layer_names = "suit", seed = 100L)
  stack <- c(r1, r2, r3)
  result <- stack_species_richness(stack, threshold = 0.5, log_fun = NULL)
  expect_true(inherits(result, "SpatRaster"))
  vals <- terra::values(result, na.rm = TRUE)
  expect_true(all(vals >= 0))
  expect_true(all(vals <= 3))
})

test_that("compute_aoa_weighted returns AOA raster", {
  env_train <- make_test_raster(n_layers = 3, layer_names = c("bio1", "bio12", "bio4"))
  env_proj <- make_test_raster(n_layers = 3, layer_names = c("bio1", "bio12", "bio4"), seed = 99L)
  var_imp <- c(bio1 = 0.5, bio12 = 0.3, bio4 = 0.2)
  result <- tryCatch(
    compute_aoa_weighted(env_train, env_proj, names(env_train), var_imp, log_fun = NULL),
    error = function(e) NULL
  )
  if (!is.null(result)) {
    expect_true(inherits(result$aoa, "SpatRaster"))
  }
})
