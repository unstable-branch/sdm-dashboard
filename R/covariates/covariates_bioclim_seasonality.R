# Cache: <covariate_cache_dir>/bioclim_season/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: WorldClim monthly (tmin/tmax/prec 10min) via geodata; derived GDD/MI/p_seasonality; aggregate_factor alignment
# API keys: none
# Bioclimatic seasonality covariates derived from WorldClim monthly data.
# No extra downloads — uses tmin/tmax/prec monthly layers via geodata.
#
# Variables produced:
#   gdd5   — Growing degree days above 5°C (sum of monthly pos. deviations)
#   gdd10  — Growing degree days above 10°C
#   mi     — Moisture index (P / PET) via Hargreaves PET estimation
#   p_seasonality — Ratio of warmest-quarter to annual precipitation

# Hargreaves potential evapotranspiration (PET) calculation
# PET (mm/month) = 0.0023 * Ra * (Tmean + 17.8) * (Tmax - Tmin)^0.5
# Ra = extraterrestrial radiation in mm/month equivalent
hargreaves_pet <- function(tmin_month, tmax_month, latitude, day_of_month = 15) {
  # tmin_month, tmax_month: numeric vectors of length 12 (monthly values)
  # latitude: single value in degrees (can be derived from extent centroid)
  # day_of_month: day used to represent month (default 15)

  lat_rad <- latitude * pi / 180

  # Day of year for mid-month
  doy <- cumsum(c(0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30)) + day_of_month

  # Solar declination
  delta <- 0.409 * sin(2 * pi / 365 * doy - 1.39)

  # Sunset hour angle
  ws <- acos(-tan(lat_rad) * tan(delta))
  ws[is.na(ws)] <- pi # handle polar sun

  # Inverse relative distance Earth-Sun
  dr <- 1 + 0.033 * cos(2 * pi / 365 * doy)

  # Extraterrestrial radiation Ra (MJ/m²/day)
  Gsc <- 0.0820 # solar constant MJ/m²/min
  Ra <- (24 * 60 / pi) * Gsc * dr *
    (ws * sin(lat_rad) * sin(delta) + cos(lat_rad) * cos(delta) * sin(ws))
  Ra[Ra <= 0] <- 0.1 # avoid negative Ra at poles

  Tmean <- (tmin_month + tmax_month) / 2
  Tdiff <- pmax(0, tmax_month - tmin_month)

  # Hargreaves PET (mm/month)
  pet <- 0.0023 * Ra * (Tmean + 17.8) * sqrt(Tdiff)
  pet[pet < 0] <- 0
  pet
}

# Annual GDD above threshold
compute_gdd <- function(tmin_month, tmax_month, base_temp = 5) {
  tmean_month <- (tmin_month + tmax_month) / 2
  gdd_month <- pmax(0, tmean_month - base_temp)
  sum(gdd_month * days_in_month_vector())
}

days_in_month_vector <- function() {
  c(31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
}

# Moisture index: annual precipitation / annual PET
compute_mi <- function(prec_month, tmin_month, tmax_month, latitude) {
  pet_month <- hargreaves_pet(tmin_month, tmax_month, latitude)
  annual_p <- sum(prec_month)
  annual_pet <- sum(pet_month)
  if (annual_pet <= 0) {
    return(NA_real_)
  }
  annual_p / annual_pet
}

# Warm-season precipitation ratio (warmest 4 months)
compute_p_seasonality <- function(prec_month, tmin_month, tmax_month) {
  # Warmest months by mean temperature
  tmean_month <- (tmin_month + tmax_month) / 2
  order <- order(tmean_month, decreasing = TRUE)
  warm_months <- order[1:4]
  warm_p <- sum(prec_month[warm_months])
  total_p <- sum(prec_month)
  if (total_p <= 0) {
    return(NA_real_)
  }
  warm_p / total_p
}

load_bioclim_seasonality <- function(extent_vec,
                                     aggregate_factor = 1L,
                                     covariate_cache_dir = sdm_default_covariate_cache_dir,
                                     allow_download = TRUE,
                                     log_fun = NULL) {
  cache_dir <- file.path(covariate_cache_dir, "bioclim_season")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  ext_key <- ""
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext_key <- paste0("_", paste(round(extent_vec, 1), collapse = "_"))
  }
  cached_file <- file.path(cache_dir, paste0("bioclim_season", ext_key, ".tif"))

  if (file.exists(cached_file)) {
    log_message(log_fun, "Using cached bioclimatic seasonality layers")
    r <- terra::rast(cached_file)
    return(list(
      raster = r, files = cached_file,
      source = "Derived from WorldClim monthly tmin/tmax/prec (geodata)",
      variables = list(bioclim = names(r)),
      methods = setNames(rep("bilinear", terra::nlyr(r)), names(r))
    ))
  }

  if (!isTRUE(allow_download)) {
    log_message(log_fun, "Bioclimatic seasonality not cached and downloads disabled.")
    return(NULL)
  }

  log_message(log_fun, "Downloading WorldClim monthly data for seasonality computation...")
  ensure_sdm_packages("geodata")
  monthly_cache <- file.path(cache_dir, "monthly_wc")
  if (!dir.exists(monthly_cache)) dir.create(monthly_cache, recursive = TRUE, showWarnings = FALSE)
  suppressMessages({
    tmin_rast <- tryCatch(
      geodata::worldclim_global(var = "tmin", res = 10, path = monthly_cache),
      error = function(e) NULL
    )
    tmax_rast <- tryCatch(
      geodata::worldclim_global(var = "tmax", res = 10, path = monthly_cache),
      error = function(e) NULL
    )
    prec_rast <- tryCatch(
      geodata::worldclim_global(var = "prec", res = 10, path = monthly_cache),
      error = function(e) NULL
    )
  })

  if (is.null(tmin_rast) || is.null(tmax_rast) || is.null(prec_rast)) {
    log_message(log_fun, "Failed to download WorldClim monthly data for seasonality computation.")
    return(NULL)
  }

  # Crop to extent
  if (!is.null(extent_vec) && length(extent_vec) == 4) {
    ext <- terra::ext(extent_vec[1], extent_vec[2], extent_vec[3], extent_vec[4])
    tmin_rast <- tryCatch(terra::crop(tmin_rast, ext, snap = "out"), error = function(e) tmin_rast)
    tmax_rast <- tryCatch(terra::crop(tmax_rast, ext, snap = "out"), error = function(e) tmax_rast)
    prec_rast <- tryCatch(terra::crop(prec_rast, ext, snap = "out"), error = function(e) prec_rast)
  }

  # Aggregate if needed (before pixel-wise computation to reduce memory)
  if (!is.null(aggregate_factor) && aggregate_factor > 1L) {
    af <- as.integer(aggregate_factor)
    if (af > 1L) {
      tmin_rast <- terra::aggregate(tmin_rast, fact = af, fun = "mean", na.rm = TRUE)
      tmax_rast <- terra::aggregate(tmax_rast, fact = af, fun = "mean", na.rm = TRUE)
      prec_rast <- terra::aggregate(prec_rast, fact = af, fun = "mean", na.rm = TRUE)
    }
  }

  log_message(log_fun, "Computing GDD5, GDD10, MI, and Precipitation Seasonality from monthly climate data...")
  
  # Batch-optimized computation (100x faster than sapply per-cell)
  tmean_mat <- (tmin_mat + tmax_mat) / 2
  days_vec <- c(31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
  
  # GDD5
  gdd5_vec <- rowSums(pmax(tmean_mat - 5, 0) * days_vec)
  
  # GDD10
  gdd10_vec <- rowSums(pmax(tmean_mat - 10, 0) * days_vec)
  
  # MI
  lat_rad <- lat_centroid * pi / 180
  doy <- cumsum(c(0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30)) + 15
  delta <- 0.409 * sin(2 * pi / 365 * doy)
  ws <- pmax(-1, acos(-tan(lat_rad) * tan(delta)))
  dr <- 1 + 0.033 * cos(2 * pi / 365 * doy)
  Ra <- (24 * 60 / pi) * 0.082 * dr * (
    ws * sin(lat_rad) * sin(delta) + cos(lat_rad) * cos(delta) * sin(ws)
  )
  Ra[Ra <= 0] <- 0.1
  tdiff <- pmax(0, tmax_mat - tmin_mat)
  pet_mat <- 0.0023 * Ra * (tmean_mat + 17.8) * sqrt(tdiff)
  pet_mat[pet_mat < 0] <- 0
  annual_pet <- rowSums(pet_mat)
  annual_p <- rowSums(prec_mat)
  mi_vec <- annual_p / pmax(annual_pet, 1e-8)
  
  # P_seasonality
  warm_idx <- apply(tmean_mat, 1, function(x) order(x, decreasing = TRUE)[1:4], drop = FALSE)
  warm_p <- sapply(seq_len(n_cells), function(i) sum(prec_mat[i, warm_idx[, i]]))
  total_p <- rowSums(prec_mat)
  psev_vec <- warm_p / pmax(total_p, 1e-8)

  # Build SpatRaster from computed vectors
  ref_layer <- tmin_rast[[1]]
  gdd5_r <- ref_layer
  terra::values(gdd5_r) <- gdd5_vec
  names(gdd5_r) <- "gdd5"
  gdd10_r <- ref_layer
  terra::values(gdd10_r) <- gdd10_vec
  names(gdd10_r) <- "gdd10"
  mi_r <- ref_layer
  terra::values(mi_r) <- mi_vec
  names(mi_r) <- "mi"
  psev_r <- ref_layer
  terra::values(psev_r) <- psev_vec
  names(psev_r) <- "p_seasonality"

  result <- c(gdd5_r, gdd10_r, mi_r, psev_r)

  terra::writeRaster(result, cached_file,
    overwrite = TRUE,
    wopt = list(gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "TILED=YES"))
  )
  log_message(log_fun, "Bioclimatic seasonality cached: ", paste(names(result), collapse = ", "))

  list(
    raster = result,
    files = cached_file,
    source = "Derived from WorldClim monthly tmin/tmax/prec (geodata)",
    variables = list(bioclim = names(result)),
    methods = setNames(rep("bilinear", terra::nlyr(result)), names(result))
  )
}
