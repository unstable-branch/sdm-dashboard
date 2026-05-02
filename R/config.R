# Central defaults for the SDM project. Keep secrets out of this file.

sdm_default_species <- "Untitled species"
sdm_default_occurrence_file <- "presence_data.csv"
sdm_demo_occurrence_file <- file.path("data", "examples", "synthetic_presence_data.csv")
sdm_default_worldclim_dir <- "Worldclim"
sdm_default_future_worldclim_dir <- "Worldclim_future"
sdm_default_output_dir <- "outputs"
sdm_default_covariate_cache_dir <- "covariates"
sdm_default_soil_path <- file.path(sdm_default_covariate_cache_dir, "hwsd_v2", "HWSD_V2_SMU_selected.tif")

sdm_default_biovars <- c(1, 4, 6, 12, 15, 18)
sdm_default_background_n <- 10000L
sdm_default_min_source_records <- 15L
sdm_default_threshold <- 0.5
sdm_default_aggregation_factor <- 1L
sdm_default_cv_folds <- 3L
sdm_default_worldclim_res <- 10
sdm_default_seed <- 42L
sdm_default_model_id <- "glm"
sdm_default_rangebag_n_bags <- 100L
sdm_default_rangebag_fraction <- 0.5
sdm_default_rangebag_vars_per_bag <- 1L
sdm_default_ensemble_weighting <- "auc"
sdm_default_elevation_demtype <- "COP90"
sdm_default_soil_vars <- c("BULK_DENSITY", "DRAINAGE", "ROOT_DEPTH", "AWC")

sdm_extent_presets <- list(
  aus_full = c(112, 155, -45, -10),
  aus_north = c(112, 155, -30, -10),
  aus_east = c(140, 155, -38, -10)
)
sdm_default_extent_preset <- "occurrence"
sdm_default_projection_extent <- sdm_extent_presets[[sdm_default_extent_preset]]
if (is.null(sdm_default_projection_extent)) sdm_default_projection_extent <- sdm_extent_presets$aus_full

sdm_default_dirs <- c(
  sdm_default_output_dir,
  sdm_default_covariate_cache_dir,
  file.path(sdm_default_covariate_cache_dir, "opentopo"),
  file.path(sdm_default_covariate_cache_dir, "hwsd_v2"),
  file.path(sdm_default_worldclim_dir, "climate", "wc2.1_10m"),
  sdm_default_future_worldclim_dir
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
  "Australia - full" = "aus_full",
  "Northern Australia" = "aus_north",
  "Eastern Australia" = "aus_east",
  "Custom" = "custom"
)
