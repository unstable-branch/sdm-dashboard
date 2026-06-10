# Tests for fused Adam optimizer in DNN training.

test_that("fused_adam_init creates correct state structure", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  p1 <- torch::torch_tensor(c(1.0, 2.0, 3.0), requires_grad = TRUE)
  p2 <- torch::torch_tensor(c(4.0, 5.0), requires_grad = TRUE)
  params <- list(p1, p2)

  state <- fused_adam_init(params, lr = 0.01, betas = c(0.9, 0.999), eps = 1e-8, weight_decay = 0.001)

  expect_equal(length(state$params), 2)
  expect_equal(length(state$exp_avgs), 2)
  expect_equal(length(state$exp_avg_sqs), 2)
  expect_equal(length(state$state_steps), 2)
  expect_equal(state$lr, 0.01)
  expect_equal(state$b1, 0.9)
  expect_equal(state$b2, 0.999)
  expect_equal(state$eps, 1e-8)
  expect_equal(state$weight_decay, 0.001)

  for (i in seq_along(params)) {
    expect_equal(dim(state$exp_avgs[[i]]), dim(params[[i]]))
    expect_equal(dim(state$exp_avg_sqs[[i]]), dim(params[[i]]))
    expect_equal(as.numeric(state$state_steps[[i]]), 0L)
  }
})

test_that("fused_adam_step modifies params in-place", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  fa <- get("torch__fused_adam_", envir = asNamespace("torch"))
  skip_if(is.null(fa), "torch__fused_adam_ not available")

  p <- torch::torch_tensor(c(1.0, 2.0, 3.0), requires_grad = TRUE)
  params <- list(p)
  state <- fused_adam_init(params, lr = 0.01)

  # Set gradient AFTER zero_grad (fused_adam_zero_grad is for use BEFORE backward)
  p$grad <- torch::torch_tensor(c(0.1, 0.2, 0.3))
  initial_sum <- as.numeric(p$sum())

  fused_adam_step(state, device = "cpu")

  final_sum <- as.numeric(p$sum())
  expect_true(final_sum != initial_sum,
    info = "fused_adam_step should modify parameters")
})

test_that("fused Adam and standard Adam are numerically equivalent", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  fa <- get("torch__fused_adam_", envir = asNamespace("torch"))
  skip_if(is.null(fa), "torch__fused_adam_ not available")

  # Standard Adam — step 0
  p_std <- torch::torch_tensor(c(1.0, 2.0, 3.0, 4.0, 5.0), requires_grad = TRUE)
  opt <- torch::optim_adam(list(p_std), lr = 0.01, betas = c(0.9, 0.999), eps = 1e-8, weight_decay = 0.001)
  p_std$grad <- torch::torch_tensor(c(0.1, 0.2, 0.3, 0.4, 0.5))
  opt$step()
  std_vals <- as.numeric(p_std$detach())

  # Fused Adam — fused_adam_step increments steps to 1 internally
  p_fused <- torch::torch_tensor(c(1.0, 2.0, 3.0, 4.0, 5.0), requires_grad = TRUE)
  p_fused$grad <- torch::torch_tensor(c(0.1, 0.2, 0.3, 0.4, 0.5))
  state <- fused_adam_init(list(p_fused), lr = 0.01, weight_decay = 0.001)
  fused_adam_step(state, device = "cpu")
  fused_vals <- as.numeric(p_fused$detach())

  expect_equal(std_vals, fused_vals, tolerance = 1e-6)
})

test_that("fused_adam_zero_grad zeros gradients", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  p <- torch::torch_tensor(c(1.0, 2.0, 3.0), requires_grad = TRUE)
  p$grad <- torch::torch_tensor(c(0.1, 0.2, 0.3))
  params <- list(p)
  state <- fused_adam_init(params)

  fused_adam_zero_grad(state)
  expect_equal(as.numeric(p$grad), c(0, 0, 0))
})

test_that("train_dnn_model with use_fused_adam='off' still works", {
  skip_if_not(requireNamespace("cito", quietly = TRUE))
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  set.seed(42)
  n <- 50
  df <- data.frame(x1 = rnorm(n), x2 = rnorm(n), y = rbinom(n, 1, 0.5))

  train_data <- list(
    train_x = as.matrix(df[, c("x1", "x2")]),
    train_y = df$y,
    test_x = as.matrix(df[, c("x1", "x2")]),
    test_y = df$y,
    feature_names = c("x1", "x2")
  )

  model <- train_dnn_model(
    train_data, model_type = "DNN_Small", device = "cpu",
    use_fused_adam = "off"
  )

  expect_true(inherits(model, "citodnn"))
  expect_true(is.finite(model$losses$train_l[1]))
})

test_that("fused Adam and standard Adam multi-step equivalence", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  fa <- get("torch__fused_adam_", envir = asNamespace("torch"))
  skip_if(is.null(fa), "torch__fused_adam_ not available")

  # Standard Adam — 3 steps
  p_std <- torch::torch_tensor(c(1.0, 2.0, 3.0), requires_grad = TRUE)
  opt <- torch::optim_adam(list(p_std), lr = 0.01, betas = c(0.9, 0.999), eps = 1e-8)
  for (i in 1:3) {
    p_std$grad <- torch::torch_tensor(c(0.1 * i, 0.2 * i, 0.3 * i))
    opt$step()
  }
  std_vals <- as.numeric(p_std$detach())

  # Fused Adam — 3 steps (fused_adam_step increments state_steps)
  p_fused <- torch::torch_tensor(c(1.0, 2.0, 3.0), requires_grad = TRUE)
  state <- fused_adam_init(list(p_fused), lr = 0.01, weight_decay = 0)
  for (i in 1:3) {
    p_fused$grad <- torch::torch_tensor(c(0.1 * i, 0.2 * i, 0.3 * i))
    fused_adam_step(state, device = "cpu")
  }
  fused_vals <- as.numeric(p_fused$detach())

  expect_equal(std_vals, fused_vals, tolerance = 1e-6)
})

test_that("torch__fused_adam_ works on CPU", {
  skip_if_not(requireNamespace("torch", quietly = TRUE))
  skip_if_not(torch::torch_is_installed())

  fa <- get("torch__fused_adam_", envir = asNamespace("torch"))
  skip_if(is.null(fa), "torch__fused_adam_ not available")

  p1 <- torch::torch_tensor(rnorm(10), requires_grad = TRUE)
  p2 <- torch::torch_tensor(rnorm(5), requires_grad = TRUE)
  p1$grad <- torch::torch_randn(10)
  p2$grad <- torch::torch_randn(5)

  ea1 <- torch::torch_zeros(10); ea2 <- torch::torch_zeros(5)
  es1 <- torch::torch_zeros(10); es2 <- torch::torch_zeros(5)
  ss1 <- torch::torch_tensor(1L, dtype = torch::torch_int64())
  ss2 <- torch::torch_tensor(1L, dtype = torch::torch_int64())

  lr_t <- torch::torch_tensor(0.01)
  fa(list(p1, p2), list(p1$grad, p2$grad), list(ea1, ea2), list(es1, es2), list(), list(ss1, ss2),
    lr_t, 0.9, 0.999, 0.001, 1e-8, FALSE, FALSE)

  expect_true(is.finite(as.numeric(p1$sum())))
  expect_true(is.finite(as.numeric(p2$sum())))
})
