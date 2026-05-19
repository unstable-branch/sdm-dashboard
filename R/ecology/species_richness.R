# Species richness stacking across multiple SDM outputs.
# Stacks binary presence/absence maps to produce community-level richness maps.

#' Stack multiple SDM outputs into a species richness map.
#'
#' @param rasters list of SpatRaster objects (suitability maps)
#' @param threshold numeric: threshold for binary conversion
#' @param method stacking method: "binary" (sum of presence/absence),
#'   "probabilistic" (sum of suitability values), or "weighted"
#' @param weights optional named numeric vector of weights per species
#' @param log_fun optional log function
#' @return list with richness raster, per-species binary maps, summary
stack_species_richness <- function(rasters, threshold = 0.5,
                                   method = c("binary", "probabilistic", "weighted"),
                                   weights = NULL, log_fun = NULL) {
  method <- match.arg(method)

  if (length(rasters) == 0) {
    stop("At least one raster is required for richness stacking", call. = FALSE)
  }

  species_names <- names(rasters)
  if (is.null(species_names)) species_names <- paste0("species_", seq_along(rasters))

  log_message(log_fun, "Stacking species richness (", method, ") from ", length(rasters), " species")

  # Ensure all rasters have the same extent and resolution
  ref <- rasters[[1]]
  aligned <- lapply(rasters, function(r) {
    if (!terra::compareGeom(r, ref, stopOnError = FALSE)) {
      tryCatch(terra::resample(r, ref), error = function(e) r)
    } else {
      r
    }
  })

  if (method == "binary") {
    # Convert each to binary (1/0) based on threshold
    binary_maps <- lapply(aligned, function(r) {
      terra::ifel(r >= threshold, 1, 0)
    })
    stack <- do.call(c, binary_maps)
    names(stack) <- species_names
    richness <- terra::app(stack, sum, na.rm = TRUE)
    names(richness) <- "species_richness"

  } else if (method == "probabilistic") {
    # Sum suitability values directly
    stack <- do.call(c, aligned)
    names(stack) <- species_names
    richness <- terra::app(stack, sum, na.rm = TRUE)
    names(richness) <- "species_richness"

  } else {
    # Weighted — weight by model quality or prior
    if (is.null(weights)) {
      weights <- rep(1, length(aligned))
    }
    weights <- weights / sum(weights)  # normalise

    weighted_maps <- mapply(function(r, w) r * w, aligned, weights, SIMPLIFY = FALSE)
    stack <- do.call(c, weighted_maps)
    names(stack) <- species_names
    richness <- terra::app(stack, sum, na.rm = TRUE)
    names(richness) <- "species_richness_weighted"
  }

  # Summary statistics
  richness_vals <- terra::values(richness, na.rm = TRUE)
  summary <- list(
    method = method,
    n_species = length(rasters),
    threshold = threshold,
    richness_mean = mean(richness_vals, na.rm = TRUE),
    richness_sd = stats::sd(richness_vals, na.rm = TRUE),
    richness_max = max(richness_vals, na.rm = TRUE),
    richness_min = min(richness_vals, na.rm = TRUE)
  )

  log_message(log_fun, "  Richness: mean=", sprintf("%.1f", summary$richness_mean),
    " max=", summary$richness_max, " across ", summary$n_species, " species")

  list(
    richness = richness,
    stack = if (method == "binary") stack else do.call(c, aligned),
    summary = summary
  )
}
