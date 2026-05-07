# Central defaults for the SDM project. Keep secrets out of this file.

config <- new.env()

sdm_default_species <- "Untitled species"
sdm_default_occurrence_file <- "presence_data.csv"
sdm_demo_occurrence_file <- file.path("data", "examples", "synthetic_presence_data.csv")
sdm_default_worldclim_dir <- "Worldclim"
sdm_default_future_worldclim_dir <- "Worldclim_future"
sdm_default_output_dir <- "outputs"
sdm_default_covariate_cache_dir <- "covariates"
sdm_default_soil_path <- file.path(sdm_default_covariate_cache_dir, "hwsd_v2", "HWSD_V2_SMU_selected.tif")

config$sdm_australia_boundary_path <- file.path("data", "examples", "geo", "australia.geojson")
config$sdm_world_boundary_path     <- file.path("data", "examples", "geo", "world_boundary.geojson")
config$custom_boundary_path         <- NULL
sdm_australia_boundary_path <- config$sdm_australia_boundary_path
sdm_world_boundary_path     <- config$sdm_world_boundary_path

sdm_default_biovars <- c(1, 4, 6, 12, 15, 18)

biovars_choices <- c(
  "BIO1: Annual Mean Temperature" = 1,
  "BIO2: Mean Diurnal Range" = 2,
  "BIO3: Isothermality" = 3,
  "BIO4: Temperature Seasonality" = 4,
  "BIO5: Max Temperature of Warmest Month" = 5,
  "BIO6: Min Temperature of Coldest Month" = 6,
  "BIO7: Temperature Annual Range" = 7,
  "BIO8: Mean Temperature of Wettest Quarter" = 8,
  "BIO9: Mean Temperature of Driest Quarter" = 9,
  "BIO10: Mean Temperature of Warmest Quarter" = 10,
  "BIO11: Mean Temperature of Coldest Quarter" = 11,
  "BIO12: Annual Precipitation" = 12,
  "BIO13: Precipitation of Wettest Month" = 13,
  "BIO14: Precipitation of Driest Month" = 14,
  "BIO15: Precipitation Seasonality" = 15,
  "BIO16: Precipitation of Wettest Quarter" = 17,
  "BIO17: Precipitation of Driest Quarter" = 17,
  "BIO18: Precipitation of Warmest Quarter" = 18,
  "BIO19: Precipitation of Coldest Quarter" = 19
)

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
sdm_default_seed <- 42L
sdm_default_model_id <- "glm"
sdm_default_rangebag_n_bags <- 100L
sdm_default_rangebag_fraction <- 0.5
sdm_default_rangebag_vars_per_bag <- 1L
sdm_default_ensemble_weighting <- "auc"
sdm_default_elevation_demtype <- "COP90"
sdm_default_soil_vars <- c("BULK_DENSITY", "DRAINAGE", "ROOT_DEPTH", "AWC")

config$biomod2_default <- c('GLM','RF','GBM','MAXNET')
config$biomod2_all <- c(
  'GLM','GAM','FDA','MARS',
  'RF','GBM','BRT','MAXNET',
  'SRE','CTA','ANN','XGBOOST'
)
biomod2_choices <- c(
  config$biomod2_default,
  setdiff(config$biomod2_all, c(config$biomod2_default, 'ANN'))
)
biomod2_nn_choices <- c('ANN' = 'ANN')

config$dnn_default <- c('DNN_Medium')
config$dnn_arch <- list(
  'DNN_Small'   = list(hidden = c(64L),    epochs = 150L, lr = 0.05,  dropout = 0.3),
  'DNN_Medium'  = list(hidden = c(100L, 100L), epochs = 150L, lr = 0.05, dropout = 0.3),
  'DNN_Large'   = list(hidden = c(100L, 100L, 100L), epochs = 200L, lr = 0.05, dropout = 0.3)
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

config$soil_vars_default <- c(
  'Sand','Silt','Clay','OC','PHH2O','BD','CF','CEC','N','EC','WHC'
)
config$soil_depths_default <- c('0-30cm','0-60cm')

sdm_extent_presets <- list(
  "aus_full"   = c(112, 154, -44, -10),
  "aus_north"  = c(112, 154, -26, -10),
  "aus_east"   = c(138, 154, -44, -10),
  "world"      = c(-180, 180, -90, 90),
  "Australia"  = c(112, 154, -44, -10),
  "World"      = c(-180, 180, -90, 90)
)
sdm_default_extent_preset <- "aus_full"
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
  "Full world" = "world",
  "Australia - full" = "aus_full",
  "Northern Australia" = "aus_north",
  "Eastern Australia" = "aus_east",
  "Custom extent" = "custom",
  "Custom boundary file" = "boundary_file"
)