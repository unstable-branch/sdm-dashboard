test_that("select_by_vif handles perfectly correlated variables", {
  set.seed(42)
  n <- 200
  x1 <- rnorm(n)
  x2 <- x1 + rnorm(n, 0, 0.01)
  x3 <- rnorm(n)
  x4 <- rnorm(n)

  df <- data.frame(BIO1 = x1, BIO11 = x2, BIO4 = x3, BIO6 = x4)

  result <- select_by_vif(df, threshold = 10)

  expect_true(is.character(result$selected))
  expect_true(is.character(result$dropped))
  expect_true(is.numeric(result$vif_final))
  expect_true(is.data.frame(result$vif_history))

  expect_true(length(result$dropped) >= 1)
  expect_true(any(c("BIO1", "BIO11") %in% result$dropped))
  expect_true(result$vif_final <= 10)
})

test_that("select_by_vif respects threshold", {
  set.seed(42)
  n <- 200
  x1 <- rnorm(n)
  x2 <- x1 * 0.95 + rnorm(n, 0, 0.1)
  x3 <- rnorm(n)

  df <- data.frame(A = x1, B = x2, C = x3)

  result <- select_by_vif(df, threshold = 5)

  expect_true(result$vif_final <= 5)
})

test_that("select_by_vif handles when all variables pass", {
  set.seed(42)
  n <- 200
  df <- data.frame(
    var1 = rnorm(n),
    var2 = rnorm(n),
    var3 = rnorm(n)
  )

  result <- select_by_vif(df, threshold = 10)

  expect_equal(length(result$dropped), 0)
  expect_equal(sort(result$selected), sort(c("var1", "var2", "var3")))
  expect_true(result$vif_final <= 10)
})

test_that("select_by_vif returns all required elements", {
  set.seed(42)
  df <- data.frame(x = rnorm(100), y = rnorm(100), z = rnorm(100))

  result <- select_by_vif(df, threshold = 10)

  expect_true("selected" %in% names(result))
  expect_true("dropped" %in% names(result))
  expect_true("vif_final" %in% names(result))
  expect_true("vif_history" %in% names(result))
  expect_true(is.character(result$selected))
  expect_true(is.character(result$dropped))
  expect_true(is.numeric(result$vif_final))
  expect_true(is.data.frame(result$vif_history))
})

test_that("select_by_vif handles insufficient variables", {
  set.seed(42)
  df <- data.frame(x = rnorm(100), y = rnorm(100))

  result <- select_by_vif(df, threshold = 10)

  expect_equal(length(result$selected), 2)
  expect_equal(length(result$dropped), 0)
})

test_that("select_by_vif handles NA values", {
  set.seed(42)
  n <- 200
  df <- data.frame(
    x = c(rnorm(100), NA, rnorm(99)),
    y = rnorm(n),
    z = rnorm(n)
  )

  result <- select_by_vif(df, threshold = 10)

  expect_true(is.character(result$selected))
  expect_true(length(result$selected) >= 2)
})

test_that("select_by_vif handles zero-variance variables", {
  set.seed(42)
  df <- data.frame(
    x = rnorm(100),
    y = rep(1, 100),
    z = rnorm(100)
  )

  result <- select_by_vif(df, threshold = 10)

  expect_true("y" %in% result$dropped)
})

test_that("compute_vif returns correct values for independent variables", {
  set.seed(42)
  df <- data.frame(
    x = rnorm(1000),
    y = rnorm(1000),
    z = rnorm(1000)
  )

  vif_vals <- compute_vif(df)

  expect_true("x" %in% names(vif_vals))
  expect_true("y" %in% names(vif_vals))
  expect_true("z" %in% names(vif_vals))
  expect_true(all(vif_vals < 5))
})

test_that("compute_vif handles perfect collinearity", {
  set.seed(42)
  n <- 100
  x <- rnorm(n)
  df <- data.frame(x = x, y = x)

  vif_vals <- compute_vif(df)

  expect_true(is.infinite(vif_vals["x"]) || is.infinite(vif_vals["y"]))
})

test_that("apply_vif_selection returns correct structure", {
  set.seed(42)
  df <- data.frame(
    x = rnorm(200),
    y = rnorm(200),
    z = rnorm(200)
  )

  result <- apply_vif_selection(df, threshold = 10, log_fun = NULL)

  expect_true(is.character(result$selected))
  expect_true(is.character(result$dropped))
  expect_true(is.data.frame(result$covars_selected))
  expect_true(ncol(result$covars_selected) >= 2)
})

test_that("apply_vif_selection handles few variables", {
  set.seed(42)
  df <- data.frame(x = rnorm(100), y = rnorm(100))

  result <- apply_vif_selection(df, threshold = 10, log_fun = NULL)

  expect_equal(result$selected, c("x", "y"))
  expect_equal(length(result$dropped), 0)
  expect_true(is.null(result$vif_result))
})

test_that("select_by_vif stops at 2 variables", {
  set.seed(42)
  n <- 300
  x1 <- rnorm(n)
  x2 <- x1 + rnorm(n, 0, 0.01)
  x3 <- x1 + rnorm(n, 0, 0.01)
  x4 <- rnorm(n)

  df <- data.frame(A = x1, B = x2, C = x3, D = x4)

  result <- select_by_vif(df, threshold = 2)

  expect_true(length(result$selected) >= 2)
  expect_true(length(result$dropped) <= 2)
})

test_that("VIF history is properly recorded", {
  set.seed(42)
  n <- 300
  x1 <- rnorm(n)
  x2 <- x1 + rnorm(n, 0, 0.01)
  x3 <- x1 + rnorm(n, 0, 0.01)
  x4 <- rnorm(n)

  df <- data.frame(A = x1, B = x2, C = x3, D = x4)

  result <- select_by_vif(df, threshold = 5)

  expect_true(is.data.frame(result$vif_history))
  expect_true(nrow(result$vif_history) > 0)
  expect_true("iteration" %in% names(result$vif_history))
  expect_true("variable_removed" %in% names(result$vif_history))
  expect_true("max_vif" %in% names(result$vif_history))
})