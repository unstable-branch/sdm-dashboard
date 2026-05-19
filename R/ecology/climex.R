# CLIMEX parameter import — combine mechanistic + correlative SDM approaches.
# CLIMEX (Sutherst & Maywald 1985, 2005) uses species-specific
# temperature and moisture response parameters to model potential distribution.
# Reference: Kriticos et al. 2023, CLIMEX v4

#' Import and apply CLIMEX-like parameters for a species.
#'
#' Creates a composite suitability index from temperature and moisture
#' response curves, then combines with correlative SDM output.
#'
#' @param env_project SpatRaster with BIO1 (annual mean temp) and BIO12 (annual precipitation)
#' @param temp_params list with DV0 (lower threshold), DV1 (lower optimum),
#'   DV2 (upper optimum), DV3 (upper threshold) in degrees C
#' @param moisture_params list with SM0 (lower soil moisture threshold),
#'   SM1 (lower optimum), SM2 (upper optimum), SM3 (upper threshold)
#' @param combine_method how to combine with correlative SDM: "min" (conservative),
#'   "multiply" (synergistic), "average"
#' @param correlative_raster optional SpatRaster from correlative SDM
#' @param log_fun optional log function
#' @return list with mechanistic, correlative, and combined suitability rasters
apply_climex_params <- function(env_project,
                                 temp_params = list(DV0 = 10, DV1 = 20, DV2 = 30, DV3 = 40),
                                 moisture_params = list(SM0 = 0.1, SM1 = 0.3, SM2 = 0.8, SM3 = 1.0),
                                 combine_method = c("min", "multiply", "average"),
                                 correlative_raster = NULL,
                                 log_fun = NULL) {
  combine_method <- match.arg(combine_method)

  log_message(log_fun, "Applying CLIMEX parameters (combine: ", combine_method, ")")

  # Get temperature and precipitation layers
  raster_names <- names(env_project)
  raster_names_clean <- make.names(raster_names)

  # Find BIO1 and BIO12 (handle naming variations)
  bio1_idx <- which(raster_names_clean %in% c("bio1", "bio01", "BIO1", "BIO01"))
  bio12_idx <- which(raster_names_clean %in% c("bio12", "BIO12"))

  if (length(bio1_idx) == 0 || length(bio12_idx) == 0) {
    stop("CLIMEX requires BIO1 (annual mean temperature) and BIO12 (annual precipitation) in the raster stack", call. = FALSE)
  }

  temp <- env_project[[bio1_idx[1]]]
  precip <- env_project[[bio12_idx[1]]]

  # Temperature suitability index (0-1)
  # Based on CLIMEX diapause/growth response curve
  temp_suit <- compute_response_index(temp,
    lower_threshold = temp_params$DV0,
    lower_optimum = temp_params$DV1,
    upper_optimum = temp_params$DV2,
    upper_threshold = temp_params$DV3
  )
  names(temp_suit) <- "temperature_suitability"

  # Moisture suitability index (0-1)
  # Using annual precipitation as proxy for soil moisture
  # Convert mm to approximate soil moisture index (simplified)
  moisture_proxy <- precip / 3000  # rough normalisation
  moisture_proxy <- terra::ifel(moisture_proxy > 1, 1, moisture_proxy)

  moisture_suit <- compute_response_index(moisture_proxy,
    lower_threshold = moisture_params$SM0,
    lower_optimum = moisture_params$SM1,
    upper_optimum = moisture_params$SM2,
    upper_threshold = moisture_params$SM3
  )
  names(moisture_suit) <- "moisture_suitability"

  # Mechanistic suitability (geometric mean of temp and moisture)
  mechanistic <- sqrt(temp_suit * moisture_suit)
  names(mechanistic) <- "climex_suitability"

  log_message(log_fun, "  Mechanistic suitability computed")

  # Combine with correlative SDM if provided
  combined <- NULL
  if (!is.null(correlative_raster)) {
    if (combine_method == "min") {
      combined <- terra::ifel(mechanistic < correlative_raster, mechanistic, correlative_raster)
    } else if (combine_method == "multiply") {
      combined <- mechanistic * correlative_raster
    } else {
      combined <- (mechanistic + correlative_raster) / 2
    }
    names(combined) <- "combined_suitability"
    log_message(log_fun, "  Combined (", combine_method, ") suitability computed")
  }

  list(
    temperature_suitability = temp_suit,
    moisture_suitability = moisture_suit,
    mechanistic_suitability = mechanistic,
    combined_suitability = combined,
    params = list(
      temperature = temp_params,
      moisture = moisture_params,
      combine_method = combine_method
    )
  )
}

#' Compute CLIMEX-style response index from a variable and threshold/optimum parameters.
#' Returns 0 below lower_threshold, ramps to 1 at optimum, drops back to 0 above upper_threshold.
compute_response_index <- function(rast, lower_threshold, lower_optimum,
                                    upper_optimum, upper_threshold) {
  result <- terra::ifel(rast < lower_threshold, 0,
    terra::ifel(rast < lower_optimum,
      (rast - lower_threshold) / (lower_optimum - lower_threshold),
      terra::ifel(rast <= upper_optimum, 1,
        terra::ifel(rast < upper_threshold,
          1 - (rast - upper_optimum) / (upper_threshold - upper_optimum),
          0
        )
      )
    )
  )
  terra::ifel(result < 0, 0, terra::ifel(result > 1, 1, result))
}
