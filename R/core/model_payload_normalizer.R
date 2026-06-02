# Normalize fragile model payload fields across camelCase and snake_case inputs.

sdm_payload_coalesce <- function(...) {
  values <- list(...)
  for (value in values) {
    if (!is.null(value)) return(value)
  }
  NULL
}

sdm_payload_coalesce_integer <- function(...) {
  value <- sdm_payload_coalesce(...)
  if (is.null(value)) return(NULL)
  suppressWarnings(as.integer(value))
}

sdm_payload_coalesce_numeric <- function(...) {
  value <- sdm_payload_coalesce(...)
  if (is.null(value)) return(NULL)
  suppressWarnings(as.numeric(value))
}

sdm_normalize_model_payload <- function(payload) {
  payload <- as.list(payload %||% list())

  payload$dnn_model_type <- sdm_payload_coalesce(
    payload$dnn_model_type,
    payload$dnnModelType,
    payload$dnnArchitecture
  )
  payload$dnn_n_seeds <- sdm_payload_coalesce_integer(
    payload$dnn_n_seeds,
    payload$dnnNSeeds
  )
  payload$dnn_device <- sdm_payload_coalesce(
    payload$dnn_device,
    payload$dnnDevice
  )
  payload$dnn_dropout <- sdm_payload_coalesce_numeric(
    payload$dnn_dropout,
    payload$dnnDropout
  )
  payload$dnn_lambda <- sdm_payload_coalesce_numeric(
    payload$dnn_lambda,
    payload$dnnLambda,
    payload$dnnL2Lambda
  )

  payload$dnn_architecture <- sdm_payload_coalesce(
    payload$dnn_architecture,
    payload$dnn_multispecies_architecture,
    payload$dnnMultispeciesArchitecture,
    payload$dnn_model_type
  )
  payload$dnn_multispecies_architecture <- sdm_payload_coalesce(
    payload$dnn_multispecies_architecture,
    payload$dnnMultispeciesArchitecture,
    payload$dnn_model_type
  )
  payload$dnn_multispecies_n_seeds <- sdm_payload_coalesce_integer(
    payload$dnn_multispecies_n_seeds,
    payload$dnnMultispeciesNSeeds
  )

  payload$xgb_max_depth <- sdm_payload_coalesce_integer(
    payload$xgb_max_depth,
    payload$xgbMaxDepth
  )
  payload$xgb_eta <- sdm_payload_coalesce_numeric(
    payload$xgb_eta,
    payload$xgbEta
  )
  payload$xgb_nrounds <- sdm_payload_coalesce_integer(
    payload$xgb_nrounds,
    payload$xgbNrounds,
    payload$xgbNRounds
  )

  payload$multi_ensemble_models <- sdm_payload_coalesce(
    payload$multi_ensemble_models,
    payload$multiEnsembleModels
  )
  payload$multi_ensemble_weighting <- sdm_payload_coalesce(
    payload$multi_ensemble_weighting,
    payload$multiEnsembleWeighting
  )
  payload$multi_ensemble_power <- sdm_payload_coalesce_numeric(
    payload$multi_ensemble_power,
    payload$multiEnsemblePower
  )
  payload$multi_ensemble_min_auc <- sdm_payload_coalesce_numeric(
    payload$multi_ensemble_min_auc,
    payload$multiEnsembleMinAuc
  )
  payload$multi_ensemble_min_tss <- sdm_payload_coalesce_numeric(
    payload$multi_ensemble_min_tss,
    payload$multiEnsembleMinTss
  )
  payload$multi_ensemble_export <- sdm_payload_coalesce(
    payload$multi_ensemble_export,
    payload$multiEnsembleExport
  )
  payload$multi_ensemble_uncertainty <- sdm_payload_coalesce(
    payload$multi_ensemble_uncertainty,
    payload$multiEnsembleUncertainty
  )
  payload$biomod2_models <- sdm_payload_coalesce(
    payload$biomod2_models,
    payload$biomod2Models,
    payload$multiEnsembleBiomod2
  )

  payload$mask_type <- sdm_payload_coalesce(
    payload$mask_type,
    payload$maskType
  )
  payload$mask_file <- sdm_payload_coalesce(
    payload$mask_file,
    payload$maskFile
  )
  payload$mask_buffer_deg <- sdm_payload_coalesce_numeric(
    payload$mask_buffer_deg,
    payload$maskBufferDeg
  )
  payload$selected_uv_months <- sdm_payload_coalesce(
    payload$selected_uv_months,
    payload$selectedUvMonths,
    payload$uvMonths,
    payload$uv_months
  )
  payload$selected_drought_periods <- sdm_payload_coalesce(
    payload$selected_drought_periods,
    payload$selectedDroughtPeriods,
    payload$droughtPeriods,
    payload$drought_periods
  )
  payload$selected_chelsa_extras <- sdm_payload_coalesce(
    payload$selected_chelsa_extras,
    payload$selectedChelsaExtras,
    payload$chelsa_extras,
    payload$chelsaExtras
  )
  payload$analysis_crs <- sdm_payload_coalesce(
    payload$analysis_crs,
    payload$analysisCrs
  )
  payload$generate_tiles <- sdm_payload_coalesce(
    payload$generate_tiles,
    payload$generateTiles
  )

  payload
}
