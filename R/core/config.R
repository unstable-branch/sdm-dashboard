# Central defaults for the SDM project. Keep secrets out of this file.

config <- new.env()

sdm_default_species <- "Untitled species"
sdm_default_occurrence_file <- "presence_data.csv"
sdm_demo_occurrence_file <- file.path("data", "examples", "synthetic_presence_data.csv")
sdm_default_worldclim_dir <- Sys.getenv("SDM_WORLDCLIM_DIR", "Worldclim")
sdm_default_chelsa_dir <- Sys.getenv("SDM_CHELSA_DIR", "chelsa")
sdm_default_chelsa_extras_dir <- Sys.getenv("SDM_CHELSA_EXTRAS_DIR", "chelsa")
sdm_default_future_worldclim_dir <- Sys.getenv("SDM_FUTURE_WORLDCLIM_DIR", "Worldclim_future")
sdm_default_chelsa_url <- Sys.getenv("SDM_CHELSA_URL", "https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/bioclim")
sdm_default_chelsa_timeout <- as.integer(Sys.getenv("SDM_CHELSA_TIMEOUT_SECONDS", "300"))
sdm_default_chelsa_retries <- as.integer(Sys.getenv("SDM_CHELSA_RETRIES", "3"))
sdm_geodata_cache_url <- Sys.getenv("SDM_GEODATA_CACHE_URL", "")
sdm_internet_check_enabled <- tolower(Sys.getenv("SDM_INTERNET_CHECK_ENABLED", "true")) %in% c("true", "1")
chelsa_extra_vars <- c(
  "gdd5" = "Growing degree days (5°C base)",
  "gdd10" = "Growing degree days (10°C base)",
  "gsl" = "Growing season length",
  "fcf" = "Frost change frequency",
  "npp" = "Net primary productivity",
  "scd" = "Snow cover duration"
)
sdm_default_output_dir <- "outputs"
sdm_default_covariate_cache_dir <- "covariates"
sdm_default_soil_vars <- c("sand", "clay", "phh2o")
sdm_default_soil_depths <- c("0-5cm", "30-60cm")
sdm_default_uv_vars <- c("UVB1", "UVB2")
sdm_default_ndvi_enabled <- FALSE
sdm_default_ndvi_year <- as.integer(format(Sys.Date(), "%Y")) - 1L
sdm_default_ndvi_periods <- "annual_mean"
sdm_default_veg_year <- as.integer(format(Sys.Date(), "%Y")) - 1L
sdm_default_veg_products <- c("ndvi_annual_mean")
sdm_default_veg_include_lai <- FALSE
sdm_default_veg_include_gpp <- FALSE
sdm_default_lulc_year <- 2020L
sdm_default_hfp_year <- 2020L

config$sdm_australia_boundary_path <- file.path("data", "examples", "geo", "australia.geojson")
config$sdm_world_boundary_path <- file.path("data", "examples", "geo", "world_boundary.geojson")
config$custom_boundary_path <- NULL
sdm_australia_boundary_path <- config$sdm_australia_boundary_path
sdm_world_boundary_path <- config$sdm_world_boundary_path

sdm_default_biovars <- c(1, 4, 6, 12, 15, 18)

sdm_default_background_n <- 10000L
sdm_default_min_source_records <- 15L
sdm_default_threshold <- 0.5
sdm_default_aggregation_factor <- 1L
sdm_default_cv_folds <- 3L
sdm_default_cv_strategy <- "random"
sdm_default_cv_block_size_km <- NA_real_
sdm_default_thinning_mode <- "auto"
sdm_default_thinning_distance_km <- 10
sdm_default_worldclim_res <- 10
sdm_default_climate_source <- "worldclim"
sdm_default_seed <- 42L
sdm_default_n_perm <- 5L
sdm_default_model_id <- "glm"
sdm_default_rangebag_n_bags <- 100L
sdm_default_rangebag_fraction <- 0.5
sdm_default_rangebag_vars_per_bag <- 3L
sdm_default_maxnet_features <- "lqp"
sdm_default_maxnet_regmult <- 1.0
sdm_default_ensemble_weighting <- "auc"
sdm_default_multi_ensemble_models <- c("glm", "rangebag")
sdm_default_multi_ensemble_weighting <- "auc"
sdm_default_multi_ensemble_export_components <- TRUE
sdm_default_ensemble_power <- 2
sdm_default_ensemble_min_auc <- 0.7
sdm_default_ensemble_min_tss <- 0.5
sdm_default_ensemble_uncertainty <- TRUE
sdm_default_elevation_demtype <- "COP90"
sdm_default_terrain_complexity_enabled <- FALSE
sdm_esm_min_occurrences <- 5L
sdm_esm_recommend_below <- 30L
sdm_esm_warn_below <- 10L
sdm_esm_default_min_auc <- 0.7
sdm_esm_default_power <- 1
sdm_esm_default_n_runs <- 5L
sdm_esm_default_split <- 70
sdm_esm_max_vars_warn <- 10L

sdm_default_validation_occurrences <- NULL
sdm_default_pa_replicates <- 1L

config$biomod2_default <- c("GLM", "RF", "GBM", "MAXNET")
config$biomod2_all <- c(
  "GLM", "GAM", "FDA", "MARS",
  "RF", "GBM", "BRT", "MAXNET",
  "SRE", "CTA", "ANN", "XGBOOST"
)
biomod2_choices <- c(
  config$biomod2_default,
  setdiff(config$biomod2_all, c(config$biomod2_default, "ANN"))
)
biomod2_nn_choices <- c("ANN" = "ANN")

config$dnn_default <- c("DNN_Medium")
config$dnn_arch <- list(
  "DNN_Small"   = list(hidden = c(64L), epochs = 150L, lr = 0.05, dropout = 0.3),
  "DNN_Medium"  = list(hidden = c(100L, 100L), epochs = 150L, lr = 0.05, dropout = 0.3),
  "DNN_Large"   = list(hidden = c(100L, 100L, 100L), epochs = 200L, lr = 0.05, dropout = 0.3)
)
dnn_choices <- c(
  "DNN Small (64 units, 1 hidden layer)" = "DNN_Small",
  "DNN Medium (100->100 units, 2 hidden layers)" = "DNN_Medium",
  "DNN Large (100->100->100 units, 3 hidden layers)" = "DNN_Large"
)
config$dnn_hard_block <- 50L
config$dnn_warning_threshold <- 100L
config$dnn_soft_warning <- 250L
config$dnn_device_default <- "auto"
dnn_device_choices <- c(
  "Auto-detect (Recommended)" = "auto",
  "CPU only (slower)" = "cpu",
  "GPU if available (faster)" = "gpu"
)
config$dnn_weight_default <- 0.3
config$ensemble_method_default <- "weighted_average"
config$use_rangebag <- FALSE

sdm_extent_presets <- list(
  "aus_full"   = c(112, 154, -44, -10),
  "aus_north"  = c(112, 154, -26, -10),
  "aus_east"   = c(138, 154, -44, -10),
  "world"      = c(-180, 180, -90, 90)
)
sdm_default_extent_preset <- "aus_full"
sdm_default_projection_extent <- sdm_extent_presets[[sdm_default_extent_preset]]
if (is.null(sdm_default_projection_extent)) sdm_default_projection_extent <- sdm_extent_presets$aus_full

sdm_default_dirs <- c(
  sdm_default_output_dir,
  sdm_default_covariate_cache_dir,
  file.path(sdm_default_covariate_cache_dir, "opentopo"),
  file.path(sdm_default_covariate_cache_dir, "soilgrids"),
  file.path(sdm_default_covariate_cache_dir, "gluv"),
  file.path(sdm_default_covariate_cache_dir, "gimms"),
  file.path(sdm_default_covariate_cache_dir, "lulc"),
  file.path(sdm_default_covariate_cache_dir, "human_footprint"),
  file.path(sdm_default_covariate_cache_dir, "drought"),
  file.path(sdm_default_covariate_cache_dir, "bioclim_season"),
  file.path(sdm_default_worldclim_dir, "climate", "wc2.1_10m"),
  sdm_default_future_worldclim_dir,
  sdm_default_chelsa_dir
)

sdm_biovar_choices <- c(
  "BIO1 Annual mean temperature" = "1", "BIO2 Mean diurnal range" = "2",
  "BIO3 Isothermality" = "3", "BIO4 Temperature seasonality" = "4",
  "BIO5 Max temp warmest month" = "5", "BIO6 Min temp coldest month" = "6",
  "BIO7 Temperature annual range" = "7", "BIO8 Mean temp wettest quarter" = "8",
  "BIO9 Mean temp driest quarter" = "9", "BIO10 Mean temp warmest quarter" = "10",
  "BIO11 Mean temp coldest quarter" = "11", "BIO12 Annual precipitation" = "12",
  "BIO13 Precip wettest month" = "13", "BIO14 Precip driest month" = "14",
  "BIO15 Precipitation seasonality" = "15", "BIO16 Precip wettest quarter" = "16",
  "BIO17 Precip driest quarter" = "17", "BIO18 Precip warmest quarter" = "18",
  "BIO19 Precip coldest quarter" = "19"
)

sdm_extent_choices <- c(
  "Occurrence extent" = "occurrence",
  "Full world" = "world",
  "Australia - full" = "aus_full",
  "Northern Australia" = "aus_north",
  "Eastern Australia" = "aus_east",
  "Custom extent" = "custom",
  "Custom boundary file" = "boundary_file"
)

# --- Analysis CRS options ---
sdm_analysis_crs_choices <- c(
  "Auto-detect (UTM zone)" = "auto",
  "Equal Earth (global equal-area)" = "eqearth",
  "Lambert Azimuthal Equal-Area" = "laea",
  "Azimuthal Equidistant" = "aeqd",
  "Mollweide" = "moll",
  "World Equidistant Cylindrical" = "eqc"
)
sdm_default_analysis_crs <- "auto"

sdm_resolve_crs <- function(analysis_crs = "auto", lon = NULL, lat = NULL) {
  if (!requireNamespace("sf", quietly = TRUE)) {
    return(structure(list(input = "EPSG:4326", wkt = "GEOGCS[\"WGS 84\",DATUM[\"WGS_1984\",SPHEROID[\"WGS 84\",6378137,298.257223563]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.0174532925199433]]"), class = "crs"))
  }
  if (is.null(analysis_crs) || is.na(analysis_crs) || identical(analysis_crs, "EPSG:4326")) {
    return(sf::st_crs(4326L))
  }

  # Handle dateline-straddling longitudes
  centroid_lon <- if (!is.null(lon) && length(lon) > 0) {
    lon_finite <- lon[is.finite(lon)]
    if (length(lon_finite) > 0 && diff(range(lon_finite)) > 180) {
      lon_finite[lon_finite < 0] <- lon_finite[lon_finite < 0] + 360
      raw <- mean(lon_finite)
      ((raw + 180) %% 360) - 180
    } else {
      mean(lon_finite)
    }
  } else 0
  centroid_lat <- if (!is.null(lat) && length(lat) > 0) mean(lat[is.finite(lat)]) else 0

  south_suffix <- if (centroid_lat < 0) " +south" else ""

  utm_zone <- function(lon) min(60, max(1, floor((lon + 180) / 6) + 1))

  proj_string <- switch(analysis_crs,
    "auto" = {
      zone <- utm_zone(centroid_lon)
      paste0("+proj=utm +zone=", zone, south_suffix, " +datum=WGS84 +units=m")
    },
    "utm" = {
      zone <- utm_zone(centroid_lon)
      paste0("+proj=utm +zone=", zone, south_suffix, " +datum=WGS84 +units=m")
    },
    "eqearth" = "+proj=eqearth +datum=WGS84 +units=m",
    "laea" = paste0("+proj=laea +lat_0=", centroid_lat, " +lon_0=", centroid_lon, " +datum=WGS84 +units=m"),
    "aeqd" = paste0("+proj=aeqd +lat_0=", centroid_lat, " +lon_0=", centroid_lon, " +datum=WGS84 +units=m"),
    "moll" = paste0("+proj=moll +lon_0=", centroid_lon, " +datum=WGS84 +units=m"),
    "eqc" = paste0("+proj=eqc +lat_ts=", centroid_lat, " +lon_0=", centroid_lon, " +datum=WGS84 +units=m"),
    {
      tryCatch(sf::st_crs(analysis_crs), error = function(e) sf::st_crs(4326L))
    }
  )

  if (!is.character(proj_string)) return(proj_string)

  tryCatch(sf::st_crs(proj_string), error = function(e) sf::st_crs(4326L))
}

sdm_auto_extent <- function(occ_df, buffer_deg = 2) {
  if (is.null(occ_df) || nrow(occ_df) == 0) {
    return(sdm_extent_presets$aus_full)
  }
  if (!all(c("longitude", "latitude") %in% names(occ_df))) {
    return(sdm_extent_presets$aus_full)
  }
  lon <- occ_df$longitude
  lat <- occ_df$latitude
  lon <- lon[is.finite(lon)]
  lat <- lat[is.finite(lat)]
  if (length(lon) < 2 || length(lat) < 2) {
    return(sdm_extent_presets$aus_full)
  }
  xmin <- max(-180, min(lon, na.rm = TRUE) - buffer_deg)
  xmax <- min(180, max(lon, na.rm = TRUE) + buffer_deg)
  ymin <- max(-90, min(lat, na.rm = TRUE) - buffer_deg)
  ymax <- min(90, max(lat, na.rm = TRUE) + buffer_deg)
  extent <- c(xmin, xmax, ymin, ymax)
  if (exists("validate_extent", mode = "function")) {
    validate_extent(extent, "auto_extent")
  }
  extent
}
