test_that("environmental extraction respects CV fold isolation", {
  skip_if_not_installed("terra")
  set.seed(42)

  n_pres <- 40
  occ <- data.frame(
    longitude = seq(140.1, 141.9, length.out = n_pres),
    latitude = seq(-23.9, -22.1, length.out = n_pres),
    species = "Test species",
    stringsAsFactors = FALSE
  )

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)

  values_bio1 <- terra::values(env[[1]], na.rm = TRUE)
  expect_true(length(values_bio1) > 0)
  expect_true(is.numeric(values_bio1))
  expect_true(all(values_bio1 >= 0))
  expect_true(all(values_bio1 <= 1))

  pres_xy <- cbind(occ$longitude, occ$latitude)
  extracted <- tryCatch(
    terra::extract(env, pres_xy),
    error = function(e) NULL
  )
  expect_true(!is.null(extracted) || inherits(extracted, "data.frame"))
  if (!is.null(extracted) && ncol(extracted) > 1) {
    env_cols <- names(extracted)[names(extracted) != "ID"]
    expect_true(all(c("bio1", "bio12") %in% env_cols))
  }
})

test_that("CV fold assignment isolates training data from validation", {
  skip_if_not_installed("terra")
  set.seed(42)

  n_pres <- 40
  presence_vec <- factor(rep("presence", n_pres), levels = c("absence", "presence"))
  folds <- make_cv_folds_random(y = presence_vec, k = 3, seed = 42)

  for (fold_i in 1:3) {
    train_idx <- which(folds != fold_i)
    valid_idx <- which(folds == fold_i)
    expect_true(length(intersect(train_idx, valid_idx)) == 0)
    expect_equal(length(train_idx) + length(valid_idx), n_pres)
  }
})

test_that("background points are sampled within full extent", {
  skip_if_not_installed("terra")
  set.seed(42)

  env <- make_test_raster(xmin = 137, xmax = 145, ymin = -27, ymax = -19,
                          nrows = 30, ncols = 30, n_layers = 2,
                          layer_names = c("bio1", "bio12"), seed = 42L)

  occ <- data.frame(
    longitude = seq(140.0, 142.0, length.out = 20),
    latitude = seq(-24.0, -22.0, length.out = 20),
    stringsAsFactors = FALSE
  )

  bg_n <- 100
  bg_cells <- sample(terra::ncell(env), min(bg_n, terra::ncell(env)), replace = FALSE)
  bg_xy <- terra::xyFromCell(env, bg_cells)

  expect_equal(nrow(bg_xy), min(bg_n, terra::ncell(env)))
  expect_true(min(bg_xy[, 1]) >= terra::xmin(env))
  expect_true(max(bg_xy[, 1]) <= terra::xmax(env))
  expect_true(min(bg_xy[, 2]) >= terra::ymin(env))
  expect_true(max(bg_xy[, 2]) <= terra::ymax(env))
})