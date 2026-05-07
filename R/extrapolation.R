# MESS (Multivariate Environmental Similarity Surface) Extrapolation Detection
# Reference: Elith, Kearney, Phillips (2010) The art of modelling range-shifting species

combine_mess_layers <- function(layers) {
  if (!is.list(layers) || length(layers) == 0) stop("layers must be a non-empty list", call. = FALSE)
  combined <- layers[[1]]
  if (length(layers) > 1) {
    for (i in 2:length(layers)) combined <- c(combined, layers[[i]])
  }
  combined
}

compute_mess <- function(env_train, env_proj) {
  stopifnot("env_train must be SpatRaster or data.frame" = inherits(env_train, "SpatRaster") || is.data.frame(env_train))
  stopifnot("env_proj must be SpatRaster" = inherits(env_proj, "SpatRaster"))

  train_is_raster <- inherits(env_train, "SpatRaster")
  train_extent <- if (train_is_raster) terra::ext(env_train) else NULL

  train_vars <- names(env_train)
  proj_vars <- names(env_proj)

  if (!identical(sort(train_vars), sort(proj_vars))) {
    stop("Training and projection must have the same variable names", call. = FALSE)
  }

  common_vars <- intersect(train_vars, proj_vars)
  if (length(common_vars) == 0) {
    stop("No common variables between training and projection", call. = FALSE)
  }

  if (train_is_raster) {
    env_train <- env_train[[common_vars]]
  } else {
    env_train <- as.data.frame(env_train[, common_vars, drop = FALSE])
  }
  env_proj <- env_proj[[common_vars]]

  per_variable <- list()
  train_ranges <- list()

  for (var in common_vars) {
    proj_vals <- env_proj[[var]]

    if (train_is_raster) {
      train_vals <- env_train[[var]]
      train_min <- terra::global(train_vals, "min", na.rm = TRUE)[1, 1]
      train_max <- terra::global(train_vals, "max", na.rm = TRUE)[1, 1]
    } else {
      train_vector <- as.numeric(env_train[[var]])
      train_min <- min(train_vector, na.rm = TRUE)
      train_max <- max(train_vector, na.rm = TRUE)
    }

    train_range <- train_max - train_min
    train_ranges[[var]] <- c(min = train_min, max = train_max)

    if (!is.finite(train_range) || train_range <= 0) {
      per_variable[[var]] <- proj_vals * NA_real_
      names(per_variable[[var]]) <- var
      next
    }

    lower_similarity <- (proj_vals - train_min) / train_range
    upper_similarity <- (train_max - proj_vals) / train_range
    similarity <- terra::ifel(lower_similarity <= upper_similarity, lower_similarity, upper_similarity)
    names(similarity) <- var
    per_variable[[var]] <- similarity
  }

  per_variable <- per_variable[common_vars]
  all_values <- combine_mess_layers(per_variable)
  overall_mess <- terra::app(all_values, function(x) {
    if (is.null(dim(x))) {
      if (all(is.na(x))) return(NA_real_)
      return(min(x, na.rm = TRUE))
    }
    apply(x, 1, function(row) {
      if (all(is.na(row))) NA_real_ else min(row, na.rm = TRUE)
    })
  })
  names(overall_mess) <- "MESS"

  if (!is.null(train_extent)) {
    xy <- terra::xyFromCell(env_proj[[1]], seq_len(terra::ncell(env_proj[[1]])))
    outside_training_extent <- xy[, 1] < train_extent$xmin | xy[, 1] > train_extent$xmax |
      xy[, 2] < train_extent$ymin | xy[, 2] > train_extent$ymax
    mess_values <- terra::values(overall_mess, mat = FALSE)
    update <- outside_training_extent & is.finite(mess_values)
    mess_values[update] <- pmin(mess_values[update], -1e-9)
    terra::values(overall_mess) <- mess_values
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

  if (is.null(names(per_variable_mess)) || any(nzchar(names(per_variable_mess)) == 0)) {
    stop("per_variable_mess list must have named elements", call. = FALSE)
  }

  all_rasts <- combine_mess_layers(per_variable_mess)
  mod <- terra::app(all_rasts, function(x) {
    if (is.null(dim(x))) {
      if (all(is.na(x))) return(NA_real_)
      return(which.min(x))
    }
    apply(x, 1, function(row) {
      if (all(is.na(row))) NA_real_ else which.min(row)
    })
  })
  names(mod) <- "MOD"
  mod
}

compute_current_mess <- function(env_train, env_project) {
  compute_mess(env_train, env_project)
}

compute_current_mess_from_env <- function(env) {
  compute_mess(env$env_train, env$env_project)
}
