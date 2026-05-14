test_that("fit_esm returns standard contract", {
  skip_if_not_installed("ecospat")
  skip_if_not_installed("biomod2")

  set.seed(42)
  n_pres <- 20
  env_data <- data.frame(
    presence = c(rep(1, n_pres), rep(0, 200)),
    BIO1  = rnorm(n_pres + 200),
    BIO12 = rnorm(n_pres + 200),
    BIO15 = rnorm(n_pres + 200),
    BIO4  = rnorm(n_pres + 200)
  )

  occ_df <- data.frame(
    longitude = rnorm(n_pres, mean = 140, sd = 2),
    latitude  = rnorm(n_pres, mean = -28, sd = 2),
    species   = rep("Test species", n_pres),
    presence  = rep(1L, n_pres)
  )

  fit <- fit_esm(
    occ              = occ_df,
    env_train_scaled = env_data,
    biovars          = c("BIO1", "BIO12", "BIO15", "BIO4"),
    algorithm        = "GLM",
    n_runs_eval      = 3L,
    seed             = 42
  )

  expect_type(fit, "list")
  expect_named(fit, c("model", "formula", "coefficients", "occurrence_used",
                      "background_xy", "cv", "covariates",
                      "variable_importance", "esm_config"))
  expect_true(is.finite(fit$cv$auc_mean))
  expect_equal(fit$cv$strategy, "split-sample")
  expect_true(is.data.frame(fit$coefficients))
  expect_true(ncol(fit$coefficients) >= 2)
  expect_false(any(duplicated(fit$coefficients$pair)))
})

test_that("fit_esm fails gracefully with < 5 presences", {
  skip_if_not_installed("ecospat")
  set.seed(42)
  env_data <- data.frame(presence = c(1,1,1,0,0,0,0,0,0,0),
                         BIO1 = rnorm(10), BIO12 = rnorm(10))
  occ_df <- data.frame(longitude = rnorm(3), latitude = rnorm(3),
                       species = "test", presence = 1)
  expect_error(
    fit_esm(occ_df, env_data, c("BIO1", "BIO12")),
    "at least 5 presence records"
  )
})

test_that("fit_esm fails when only 1 covariate", {
  skip_if_not_installed("ecospat")
  set.seed(42)
  env_data <- data.frame(presence = c(rep(1, 10), rep(0, 50)),
                         BIO1 = rnorm(60))
  occ_df <- data.frame(longitude = rnorm(10), latitude = rnorm(10),
                       species = "test", presence = 1)
  expect_error(
    fit_esm(occ_df, env_data, c("BIO1")),
    "at least 2 predictor variables"
  )
})

test_that("extract_esm_importance returns one row per variable", {
  skip_if_not_installed("ecospat")
  mock_ensemble <- list(weights = c(BIO1_BIO12 = 0.8, BIO1_BIO15 = 0.7,
                                     BIO12_BIO15 = 0.6))
  imp <- extract_esm_importance(mock_ensemble, c("BIO1", "BIO12", "BIO15"))
  expect_equal(nrow(imp), 3)
  expect_true(all(imp$importance >= 0))
  expect_true(max(imp$importance, na.rm = TRUE) <= 1)
})

test_that("esm_config is populated correctly", {
  skip_if_not_installed("ecospat")
  skip_if_not_installed("biomod2")

  set.seed(42)
  n_pres <- 15
  env_data <- data.frame(
    presence = c(rep(1, n_pres), rep(0, 150)),
    BIO1  = rnorm(n_pres + 150),
    BIO12 = rnorm(n_pres + 150),
    BIO4  = rnorm(n_pres + 150)
  )
  occ_df <- data.frame(longitude = rnorm(n_pres), latitude = rnorm(n_pres),
                       species = "test", presence = 1)

  fit <- fit_esm(
    occ              = occ_df,
    env_train_scaled = env_data,
    biovars          = c("BIO1", "BIO12", "BIO4"),
    algorithm        = "GLM",
    n_runs_eval      = 2L,
    min_auc          = 0.5,
    seed             = 42
  )

  esm <- fit$esm_config
  expect_equal(esm$n_vars, 3)
  expect_equal(esm$n_pairs_total, 3)
  expect_equal(esm$algorithm, "GLM")
  expect_true(esm$n_pairs_used >= 0)
  expect_true(esm$n_pairs_dropped >= 0)
  expect_false(is.null(esm$min_auc))
})

test_that("esm_glm registered in model registry", {
  skip_if_not_installed("ecospat")
  skip_if_not_installed("biomod2")
  ids <- sdm_model_ids()
  expect_true("esm_glm" %in% ids)
  spec <- get_sdm_model("esm_glm")
  expect_equal(spec$id, "esm_glm")
  expect_equal(spec$maturity, "experimental")
  expect_equal(spec$min_records, 5L)
})

test_that("esm_maxnet registered when maxnet available", {
  skip_if_not_installed("ecospat")
  skip_if_not_installed("biomod2")
  if (!requireNamespace("maxnet", quietly = TRUE)) {
    skip("maxnet not installed")
  }
  ids <- sdm_model_ids()
  expect_true("esm_maxnet" %in% ids)
  spec <- get_sdm_model("esm_maxnet")
  expect_equal(spec$id, "esm_maxnet")
  expect_equal(spec$min_records, 5L)
})

test_that("plot_esm_pair_heatmap returns ggplot or NULL", {
  skip_if_not_installed("ecospat")
  skip_if_not_installed("biomod2")

  set.seed(42)
  n_pres <- 12
  env_data <- data.frame(
    presence = c(rep(1, n_pres), rep(0, 100)),
    BIO1  = rnorm(n_pres + 100),
    BIO12 = rnorm(n_pres + 100)
  )
  occ_df <- data.frame(longitude = rnorm(n_pres), latitude = rnorm(n_pres),
                       species = "test", presence = 1)
  fit <- fit_esm(occ_df, env_data, c("BIO1", "BIO12"),
                 algorithm = "GLM", n_runs_eval = 2L, seed = 42)

  p <- plot_esm_pair_heatmap(fit)
  if (!is.null(p)) {
    expect_true(inherits(p, "ggplot"))
  }
})