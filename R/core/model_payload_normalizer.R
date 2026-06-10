# Normalize fragile model payload fields across camelCase and snake_case inputs.

sdm_payload_coalesce <- function(...) {
  values <- list(...)
  for (value in values) {
    if (!is.null(value) && length(value) > 0L) return(value)
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

sdm_payload_coalesce_logical <- function(...) {
  value <- sdm_payload_coalesce(...)
  if (is.null(value)) return(NULL)
  if (is.logical(value)) return(value)
  if (is.numeric(value)) return(as.logical(value))
  tolower(as.character(value)) %in% c("true", "t", "yes", "y", "1")
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
  payload$dnn_mixed_precision <- sdm_payload_coalesce(
    payload$dnn_mixed_precision,
    payload$dnnMixedPrecision
  )
  payload$dnn_cuda_graphs <- sdm_payload_coalesce(
    payload$dnn_cuda_graphs,
    payload$dnnCudaGraphs
  )

  payload$gllvm_family <- sdm_payload_coalesce(
    payload$gllvm_family,
    payload$gllvmFamily
  )
  payload$gllvm_num_lv <- sdm_payload_coalesce_integer(
    payload$gllvm_num_lv,
    payload$gllvmNumLv
  )
  payload$gllvm_num_rows <- sdm_payload_coalesce_integer(
    payload$gllvm_num_rows,
    payload$gllvmNumRows
  )
  payload$gllvm_lv_corr <- sdm_payload_coalesce_logical(
    payload$gllvm_lv_corr,
    payload$gllvmLvCorr
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
  payload$mask_boundary_type <- sdm_payload_coalesce(
    payload$mask_boundary_type,
    payload$maskBoundaryType
  )
  payload$mask_resolution <- sdm_payload_coalesce(
    payload$mask_resolution,
    payload$maskResolution
  )
  payload$mask_country <- sdm_payload_coalesce(
    payload$mask_country,
    payload$maskCountry
  )
  payload$restrict_background <- sdm_payload_coalesce_logical(
    payload$restrict_background,
    payload$restrictBackground
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

  payload$tuning_method <- sdm_payload_coalesce(
    payload$tuning_method,
    payload$tuningMethod
  )
  payload$enmeval_algorithm <- sdm_payload_coalesce(
    payload$enmeval_algorithm,
    payload$enmevalAlgorithm
  )
  payload$enmeval_partitions <- sdm_payload_coalesce(
    payload$enmeval_partitions,
    payload$enmevalPartitions
  )
  payload$enmeval_selection_metric <- sdm_payload_coalesce(
    payload$enmeval_selection_metric,
    payload$enmevalSelectionMetric
  )
  payload$enmeval_categoricals <- sdm_payload_coalesce(
    payload$enmeval_categoricals,
    payload$enmevalCategoricals
  )
  payload$enmeval_null_iterations <- sdm_payload_coalesce_integer(
    payload$enmeval_null_iterations,
    payload$enmevalNullIterations
  )

  payload
}
