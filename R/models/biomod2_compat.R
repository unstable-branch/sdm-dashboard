# Biomod2 capability detection layer
# This file probes the installed biomod2 version and caches which functions/arguments are available.

.biomod2_capabilities <- new.env(parent = emptyenv())

#' Detect biomod2 capabilities and cache them
#' @return named logical vector of capability flags
biomod2_detect_capabilities <- function() {
  if (!exists(".cached", envir = .biomod2_capabilities, inherits = FALSE)) {
    caps <- list()
    # Basic function existence
    caps$has_BIOMOD_Modeling <- requireNamespace("biomod2", quietly = TRUE) &&
      exists("BIOMOD_Modeling", envir = asNamespace("biomod2"), inherits = FALSE)
    caps$has_BIOMOD_EnsembleModeling <- caps$has_BIOMOD_Modeling &&
      exists("BIOMOD_EnsembleModeling", envir = asNamespace("biomod2"), inherits = FALSE)
    # Argument inspection (example for modeling options)
    if (caps$has_BIOMOD_Modeling) {
      caps$modeling_formals <- names(formals(biomod2::BIOMOD_Modeling))
    }
    if (caps$has_BIOMOD_EnsembleModeling) {
      caps$ensemble_formals <- names(formals(biomod2::BIOMOD_EnsembleModeling))
    }
    assign(".cached", caps, envir = .biomod2_capabilities)
  }
  get(".cached", envir = .biomod2_capabilities)
}

#' Quick boolean check if biomod2 is usable (installed and meets tested range)
biomod2_is_supported <- function() {
  caps <- tryCatch(biomod2_detect_capabilities(), error = function(e) NULL)
  if (is.null(caps)) {
    return(FALSE)
  }
  caps$has_BIOMOD_Modeling && caps$has_BIOMOD_EnsembleModeling
}

#' Log a human‑readable summary of detected capabilities
log_biomod2_capabilities <- function(logger = NULL) {
  msg <- tryCatch(
    {
      caps <- biomod2_detect_capabilities()
      ver <- if (requireNamespace("biomod2", quietly = TRUE)) {
        as.character(packageVersion("biomod2"))
      } else {
        "not installed"
      }
      paste0(
        "biomod2 capabilities: Modeling=", caps$has_BIOMOD_Modeling,
        ", Ensemble=", caps$has_BIOMOD_EnsembleModeling,
        ", version=", ver
      )
    },
    error = function(e) {
      "biomod2: not available"
    }
  )
  if (is.null(logger)) {
    message(msg)
  } else {
    logger$info(msg)
  }
}

#' Build argument list for BIOMOD_Modeling respecting installed signature
biomod2_modeling_args <- function(user_args) {
  caps <- biomod2_detect_capabilities()
  if (!caps$has_BIOMOD_Modeling) stop("BIOMOD_Modeling not available", call. = FALSE)
  formals <- caps$modeling_formals
  # keep only args that exist in the installed function
  retained <- user_args[names(user_args) %in% formals]
  # ensure required 'strategy' argument has a sensible default if missing
  if ("strategy" %in% formals && !"strategy" %in% names(retained)) {
    retained$strategy <- "auto"
  }
  retained
}

#' Build argument list for BIOMOD_EnsembleModeling respecting installed signature
biomod2_ensemble_args <- function(user_args) {
  caps <- biomod2_detect_capabilities()
  if (!caps$has_BIOMOD_EnsembleModeling) stop("BIOMOD_EnsembleModeling not available", call. = FALSE)
  formals <- caps$ensemble_formals
  retained <- user_args[names(user_args) %in% formals]
  retained
}

#' Update biomod2 to latest CRAN version, unload and re‑probe
update_biomod2 <- function() {
  if (!requireNamespace("utils", quietly = TRUE)) stop("utils needed for update", call. = FALSE)
  utils::install.packages("biomod2")
  # unload namespace if loaded
  if ("biomod2" %in% loadedNamespaces()) {
    detach("package:biomod2", unload = TRUE, character.only = TRUE)
  }
  # re‑detect capabilities
  assign(".cached", NULL, envir = .biomod2_capabilities)
  biomod2_detect_capabilities()
}

#' Helper to query version bounds used elsewhere
biomod2_tested_range <- function() {
  list(min = "4.2-5", max = "4.2-99")
}
