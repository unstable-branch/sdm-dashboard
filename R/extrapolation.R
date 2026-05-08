# MESS (Multivariate Environmental Similarity Surface) Extrapolation Detection
# Reference: Elith, Kearney, Phillips (2010) The art of modelling range-shifting species

compute_mess <- function(env_train, env_proj) {
  stopifnot("env_train must be SpatRaster or data.frame" = inherits(env_train, "SpatRaster") || is.data.frame(env_train))
  stopifnot("env_proj must be SpatRaster" = inherits(env_proj, "SpatRaster"))

  if (is.data.frame(env_train)) {
    env_train <- as.matrix(env_train)
  }

  train_vars <- names(env_train)
  proj_vars <- names(env_proj)

  if (!identical(sort(train_vars), sort(proj_vars))) {
    stop("Training and projection must have the same variable names", call. = FALSE)
  }

  common_vars <- intersect(train_vars, proj_vars)
  if (length(common_vars) == 0) {
    stop("No common variables between training and projection", call. = FALSE)
  }

  env_train <- env_train[[common_vars]]
  env_proj <- env_proj[[common_vars]]

  per_variable <- list()
  train_ranges <- list()

  for (var in common_vars) {
    train_vals <- env_train[[var]]
    proj_vals <- env_proj[[var]]

    train_min <- terra::global(train_vals, "min", na.rm = TRUE)[1, 1]
    train_max <- terra::global(train_vals, "max", na.rm = TRUE)[1, 1]
    train_range <- train_max - train_min

    train_ranges[[var]] <- c(min = train_min, max = train_max)

    if (train_range == 0 || is.na(train_range) || !is.finite(train_range)) {
      per_variable[[var]] <- terra::app(proj_vals, function(x) NA)
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

  all_values <- do.call(c, per_variable)
  overall_mess <- terra::app(all_values, function(x) {
    if (all(is.na(x))) return(NA)
    min(x, na.rm = TRUE)
  })
  names(overall_mess) <- "MESS"

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

  var_names <- names(per_variable_mess)
  n_vars <- length(per_variable_mess)

  all_rasts <- do.call(c, per_variable_mess)

  mod <- terra::app(all_rasts, function(x) {
    if (all(is.na(x))) return(NA)
    which.min(x)
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