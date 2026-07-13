# MESS (Multivariate Environmental Similarity Surface) Extrapolation Detection
# Reference: Elith, Kearney, Phillips (2010) The art of modelling range-shifting species

compute_mess <- function(env_train, env_proj) {
  stopifnot("env_train must be SpatRaster or data.frame" = inherits(env_train, "SpatRaster") || is.data.frame(env_train))
  stopifnot("env_proj must be SpatRaster" = inherits(env_proj, "SpatRaster"))

  train_vars <- names(env_train)
  proj_vars <- names(env_proj)

  if (!identical(sort(train_vars), sort(proj_vars))) {
    stop("Training and projection must have the same variable names", call. = FALSE)
  }

  common_vars <- intersect(train_vars, proj_vars)
  if (length(common_vars) == 0) {
    stop("No common variables between training and projection", call. = FALSE)
  }

  if (inherits(env_train, "SpatRaster")) {
    env_train <- env_train[[common_vars]]
  } else {
    env_train <- env_train[, common_vars, drop = FALSE]
  }
  env_proj <- env_proj[[common_vars]]

  per_variable <- list()
  train_ranges <- list()

  for (var in common_vars) {
    train_vals <- if (inherits(env_train, "SpatRaster")) {
      terra::values(env_train[[var]], mat = FALSE)
    } else {
      env_train[[var]]
    }
    train_ranges[[var]] <- c(min = min(train_vals, na.rm = TRUE), max = max(train_vals, na.rm = TRUE))
  }

  n_cells <- terra::ncell(env_proj)
  n_vars <- length(common_vars)

  use_gpu <- sdm_use_gpu_for(n_cells * n_vars)
  if (use_gpu) {
    dev <- gpu_device()
    proj_mat <- as.matrix(terra::values(env_proj[[common_vars]]))
    valid <- stats::complete.cases(proj_mat)
    proj_tensor <- torch::torch_tensor(proj_mat[valid, , drop = FALSE], device = dev)

    train_mins <- vapply(common_vars, function(v) train_ranges[[v]]["min"], numeric(1))
    train_maxs <- vapply(common_vars, function(v) train_ranges[[v]]["max"], numeric(1))
    train_ranges_v <- train_maxs - train_mins
    train_ranges_v[train_ranges_v == 0 | is.na(train_ranges_v) | !is.finite(train_ranges_v)] <- 1

    min_t <- torch::torch_tensor(train_mins, device = dev)$unsqueeze(1)
    range_t <- torch::torch_tensor(train_ranges_v, device = dev)$unsqueeze(1)

    d <- (proj_tensor - min_t) / range_t
    below <- proj_tensor < min_t
    above <- proj_tensor > (min_t + range_t)
    d <- torch::torch_where(below, -d, d)
    d <- torch::torch_where(above, -d, d)

    mess_vals <- as.numeric(torch::torch_min(d, dim = 2)$values$to(device = "cpu"))

    overall_mess <- terra::rast(env_proj[[1]])
    terra::values(overall_mess) <- NA_real_
    overall_mess[which(valid)] <- mess_vals
    names(overall_mess) <- "MESS"

    d_cpu <- as.matrix(d$to(device = "cpu"))
    for (i in seq_along(common_vars)) {
      var <- common_vars[i]
      var_vals <- d_cpu[, i]
      r <- terra::rast(env_proj[[1]])
      terra::values(r) <- NA_real_
      r[which(valid)] <- var_vals
      names(r) <- var
      per_variable[[var]] <- r
    }
    per_variable <- per_variable[common_vars]
    gpu_empty_cache()
  } else {
    for (var in common_vars) {
      train_vals <- if (inherits(env_train, "SpatRaster")) {
        terra::values(env_train[[var]], mat = FALSE)
      } else {
        env_train[[var]]
      }
      proj_vals <- env_proj[[var]]

      train_min <- train_ranges[[var]]["min"]
      train_max <- train_ranges[[var]]["max"]
      train_range <- train_max - train_min

      if (train_range == 0 || is.na(train_range) || !is.finite(train_range)) {
        per_variable[[var]] <- proj_vals
        per_variable[[var]][] <- NA_real_
        names(per_variable[[var]]) <- var
        next
      }

      d <- (proj_vals - train_min) / train_range

      below_min <- proj_vals < train_min
      above_max <- proj_vals > train_max

      d[below_min] <- -d[below_min]
      d[above_max] <- -d[above_max]

      d[is.na(proj_vals)] <- NA

      per_variable[[var]] <- d
      names(per_variable[[var]]) <- var
    }

    per_variable <- per_variable[common_vars]

    all_values <- Reduce(c, per_variable)
    overall_mess <- if (length(per_variable) == 1) {
      per_variable[[1]]
    } else {
      terra::app(all_values, min, na.rm = TRUE)
    }
    names(overall_mess) <- "MESS"
  }

  pct_extrapolation <- terra::global(overall_mess < 0, "mean", na.rm = TRUE)[1, 1]
  if (is.na(pct_extrapolation)) pct_extrapolation <- 0

  list(
    mess = overall_mess,
    per_variable = per_variable,
    pct_extrapolation = pct_extrapolation,
    train_ranges = train_ranges
  )
}

compute_mod <- function(per_variable_mess) {
  if (!is.list(per_variable_mess) || length(per_variable_mess) == 0) {
    stop("per_variable_mess must be a non-empty list of SpatRasters", call. = FALSE)
  }

  if (is.null(names(per_variable_mess)) || any(!nzchar(names(per_variable_mess)))) {
    stop("per_variable_mess list must have named elements", call. = FALSE)
  }

  var_names <- names(per_variable_mess)
  n_vars <- length(per_variable_mess)

  all_rasts <- Reduce(c, per_variable_mess)

  mod <- if (length(per_variable_mess) == 1) {
    per_variable_mess[[1]]
  } else {
    terra::app(all_rasts, which.min)
  }
  if (length(per_variable_mess) == 1) {
    mod[] <- 1L
  }
  names(mod) <- "MOD"

  mod
}

compute_current_mess <- function(env_train, env_project) {
  compute_mess(env_train, env_project)
}

compute_current_mess_from_env <- function(env) {
  compute_mess(env$env_train, env$env_project)
}
