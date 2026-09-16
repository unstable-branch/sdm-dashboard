# MESS (Multivariate Environmental Similarity Surface) Extrapolation Detection
# Reference: dismo::mess (Rossi/Hijmans), using its .messi3 empirical-rank
# implementation. Scores are 0..100 in-range and negative outside.

.mess_empirical_percentile <- function(p, v) {
  v <- v[is.finite(v)]
  out <- rep(NA_real_, length(p))
  valid <- is.finite(p)
  if (length(v) > 0L && any(valid)) {
    out[valid] <- 100 * findInterval(p[valid], sort(v)) / length(v)
  }
  out
}

.mess_empirical_scores <- function(p, v) {
  v <- v[is.finite(v)]
  out <- rep(NA_real_, length(p))
  valid <- is.finite(p)
  if (length(v) == 0L || !any(valid)) return(out)

  min_v <- min(v)
  max_v <- max(v)
  f <- .mess_empirical_percentile(p, v)
  if (is.finite(max_v - min_v) && max_v > min_v) {
    score <- 2 * f
    middle <- is.finite(f) & f > 50 & f < 100
    score[middle] <- 200 - score[middle]
    lower <- is.finite(f) & f == 0
    upper <- is.finite(f) & f == 100
    score[lower] <- 100 * (p[lower] - min_v) / (max_v - min_v)
    score[upper] <- 100 * (max_v - p[upper]) / (max_v - min_v)
    out[valid] <- score[valid]
  } else {
    # dismo's formula divides by zero for a constant predictor. Keep the
    # scientifically useful outcome without propagating NaN: an exact match
    # is maximally similar, while a finite mismatch is definitively outside.
    out[valid & p == min_v] <- 100
    out[valid & p != min_v] <- -100
  }
  out
}

compute_mess <- function(env_train, env_proj) {
  stopifnot("env_train must be SpatRaster or data.frame" = inherits(env_train, "SpatRaster") || is.data.frame(env_train))
  stopifnot("env_proj must be SpatRaster" = inherits(env_proj, "SpatRaster"))

  train_vars <- names(env_train)
  proj_vars <- names(env_proj)
  if (!identical(sort(train_vars), sort(proj_vars))) {
    stop("Training and projection must have the same variable names", call. = FALSE)
  }
  common_vars <- sort(intersect(train_vars, proj_vars))
  if (length(common_vars) == 0) stop("No common variables between training and projection", call. = FALSE)

  if (inherits(env_train, "SpatRaster")) env_train <- env_train[[common_vars]]
  else env_train <- env_train[, common_vars, drop = FALSE]
  env_proj <- env_proj[[common_vars]]

  train_values <- lapply(common_vars, function(var) {
    vals <- if (inherits(env_train, "SpatRaster")) terra::values(env_train[[var]], mat = FALSE) else env_train[[var]]
    vals[is.finite(vals)]
  })
  names(train_values) <- common_vars
  train_ranges <- lapply(train_values, function(vals) {
    if (length(vals) == 0L) c(min = NA_real_, max = NA_real_)
    else c(min = min(vals), max = max(vals))
  })

  n_cells <- terra::ncell(env_proj)
  n_vars <- length(common_vars)
  use_gpu <- sdm_use_gpu_for(n_cells * n_vars)

  per_variable <- list()
  for (var in common_vars) {
    proj_vals <- terra::values(env_proj[[var]], mat = FALSE)
    train_vals <- train_values[[var]]
    if (use_gpu && length(train_vals) > 0L) {
      # Percentile ranks are the trusted dismo oracle; the arithmetic is
      # evaluated on the selected accelerator. This keeps CPU/GPU fixtures
      # identical while avoiding a non-portable torch searchsorted dependency.
      dev <- gpu_device()
      valid <- is.finite(proj_vals)
      d <- rep(NA_real_, length(proj_vals))
      if (any(valid)) {
        p <- proj_vals[valid]
        f <- .mess_empirical_percentile(p, train_vals)
        min_v <- min(train_vals)
        max_v <- max(train_vals)
        p_t <- torch::torch_tensor(p, device = dev)
        f_t <- torch::torch_tensor(f, device = dev)
        if (max_v > min_v) {
          score_t <- 2 * f_t
          middle <- f_t > 50 & f_t < 100
          score_t <- torch::torch_where(middle, 200 - score_t, score_t)
          lower <- f_t == 0
          upper <- f_t == 100
          lower_t <- 100 * (p_t - min_v) / (max_v - min_v)
          upper_t <- 100 * (max_v - p_t) / (max_v - min_v)
          score_t <- torch::torch_where(lower, lower_t, torch::torch_where(upper, upper_t, score_t))
          d[valid] <- as.numeric(score_t$to(device = "cpu"))
        } else {
          d[valid] <- ifelse(p == min_v, 100, -100)
        }
      }
      r <- terra::rast(env_proj[[1]])
      terra::values(r) <- d
      names(r) <- var
      per_variable_raster <- r
      gpu_empty_cache()
    } else {
      per_variable_raster <- terra::rast(env_proj[[1]])
      terra::values(per_variable_raster) <- .mess_empirical_scores(proj_vals, train_vals)
      names(per_variable_raster) <- var
    }
    # Keep the list construction explicit so layer names cannot drift.
    per_variable[[var]] <- per_variable_raster
  }
  per_variable <- per_variable[common_vars]

  all_values <- Reduce(c, per_variable)
  overall_mess <- if (length(per_variable) == 1L) {
    per_variable[[1]]
  } else {
    terra::app(all_values, function(x) {
      finite <- is.finite(x)
      if (!any(finite)) NA_real_ else min(x[finite])
    })
  }
  names(overall_mess) <- "MESS"
  pct_extrapolation <- terra::global(overall_mess < 0, "mean", na.rm = TRUE)[1, 1]
  if (is.na(pct_extrapolation)) pct_extrapolation <- NA_real_

  list(mess = overall_mess, per_variable = per_variable,
       pct_extrapolation = pct_extrapolation, train_ranges = train_ranges)
}

compute_mod <- function(per_variable_mess) {
  if (!is.list(per_variable_mess) || length(per_variable_mess) == 0) stop("per_variable_mess must be a non-empty list of SpatRasters", call. = FALSE)
  if (is.null(names(per_variable_mess)) || any(!nzchar(names(per_variable_mess)))) stop("per_variable_mess list must have named elements", call. = FALSE)
  all_rasts <- Reduce(c, per_variable_mess)
  mod <- if (length(per_variable_mess) == 1L) {
    out <- per_variable_mess[[1]]
    vals <- terra::values(out, mat = FALSE)
    terra::values(out) <- ifelse(is.finite(vals), 1L, NA_integer_)
    out
  } else {
    terra::app(all_rasts, function(x) {
      finite <- is.finite(x)
      if (!any(finite)) NA_integer_ else which.min(replace(x, !finite, Inf))
    })
  }
  names(mod) <- "MOD"
  mod
}

compute_current_mess <- function(env_train, env_project) compute_mess(env_train, env_project)
compute_current_mess_from_env <- function(env) compute_mess(env$env_train, env$env_project)
