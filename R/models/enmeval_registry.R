# ENMdetails registry for ENMeval multi-algorithm support.
# Maps algorithm names to ENMdetails S4 objects.

sdm_enmdetails_registry <- new.env(parent = emptyenv())

register_enmdetails <- function(name, enm_object) {
  assign(name, enm_object, envir = sdm_enmdetails_registry)
}

get_enmdetails <- function(name) {
  get(name, envir = sdm_enmdetails_registry, inherits = FALSE)
}

has_enmdetails <- function(name) {
  exists(name, envir = sdm_enmdetails_registry, inherits = FALSE)
}

# Built-in ENMeval algorithms
if (requireNamespace("ENMeval", quietly = TRUE)) {
  register_enmdetails("maxnet", ENMeval:::enm.maxnet)
  register_enmdetails("bioclim", ENMeval:::enm.bioclim)

  # Custom: dashboard-adapted GLM via glmnet
  glm.errors <- function(occs, envs, bg, tune.args, partitions, algorithm,
                         partition.settings, other.settings, categoricals, doClamp, clamp.directions) {
    if (!("alpha" %in% names(tune.args))) {
      stop("GLM tuning requires 'alpha' parameter (elastic net mixing, 0=ridge 1=lasso)", call. = FALSE)
    }
  }

  glm.msgs <- function(tune.args, other.settings) {
    paste0("GLM (glmnet) v", paste0(packageVersion("glmnet"), collapse = "."))
  }

  glm.args <- function(occs.z, bg.z, tune.tbl.i, other.settings) {
    n_occ <- nrow(occs.z)
    n_bg <- nrow(bg.z)
    x <- rbind(occs.z, bg.z)
    y <- c(rep(1, n_occ), rep(0, n_bg))
    # Case weights: presence = 1, background = n_occ/n_bg (balance classes)
    weights <- c(rep(1, n_occ), rep(n_occ / max(n_bg, 1), n_bg))
    list(
      x = as.matrix(x), y = y, family = "binomial",
      alpha = as.numeric(tune.tbl.i$alpha),
      weights = weights, standardize = TRUE
    )
  }

  glm.predict <- function(mod, envs, other.settings) {
    if (inherits(envs, "SpatRaster")) {
      terra::predict(envs, mod, type = "response", cores = 1)
    } else {
      as.numeric(stats::predict(mod, as.matrix(envs), type = "response", s = "lambda.min"))
    }
  }

  glm.ncoefs <- function(mod) {
    length(stats::coef(mod, s = "lambda.min"))
  }

  glm.variable.importance <- function(mod) NULL

  enm.glm.dashboard <- methods::new("ENMdetails",
    name = "glm", fun = glmnet::glmnet,
    errors = glm.errors, msgs = glm.msgs, args = glm.args,
    predict = glm.predict, ncoefs = glm.ncoefs,
    variable.importance = glm.variable.importance
  )
  register_enmdetails("glm", enm.glm.dashboard)

  # Custom: dashboard-adapted Random Forest via ranger
  rf.errors <- function(occs, envs, bg, tune.args, partitions, algorithm,
                        partition.settings, other.settings, categoricals, doClamp, clamp.directions) {
    if (!("mtry" %in% names(tune.args))) {
      stop("RF tuning requires 'mtry' parameter", call. = FALSE)
    }
  }

  rf.msgs <- function(tune.args, other.settings) {
    paste0("RF (ranger) v", paste0(packageVersion("ranger"), collapse = "."))
  }

  rf.args <- function(occs.z, bg.z, tune.tbl.i, other.settings) {
    x <- rbind(occs.z, bg.z)
    y <- factor(c(rep(1, nrow(occs.z)), rep(0, nrow(bg.z))))
    list(
      x = x, y = y,
      num.trees = 500, mtry = as.numeric(tune.tbl.i$mtry),
      min.node.size = as.numeric(tune.tbl.i$min.node.size %||% 10),
      probability = TRUE, seed = other.settings$seed %||% 42,
      num.threads = other.settings$num.threads %||% 1,
      verbose = FALSE
    )
  }

  rf.predict <- function(mod, envs, other.settings) {
    if (inherits(envs, "SpatRaster")) {
      terra::predict(envs, mod, type = "response", cores = 1)
    } else {
      pred <- stats::predict(mod, as.data.frame(envs))$predictions[, "1", drop = TRUE]
      as.numeric(pred)
    }
  }

  rf.ncoefs <- function(mod) NA_integer_

  rf.variable.importance <- function(mod) NULL

  enm.rf.dashboard <- methods::new("ENMdetails",
    name = "rf", fun = ranger::ranger,
    errors = rf.errors, msgs = rf.msgs, args = rf.args,
    predict = rf.predict, ncoefs = rf.ncoefs,
    variable.importance = rf.variable.importance
  )
  register_enmdetails("rf", enm.rf.dashboard)
}
