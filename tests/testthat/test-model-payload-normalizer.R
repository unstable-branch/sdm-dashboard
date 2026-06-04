test_that("model payload normalizer prefers snake_case DNN fields", {
  payload <- sdm_normalize_model_payload(list(
    dnn_model_type = "DNN_Large",
    dnnArchitecture = "DNN_Small",
    dnn_n_seeds = "7",
    dnnNSeeds = 3,
    dnn_device = "cpu",
    dnnDevice = "cuda",
    dnn_lambda = "0.02",
    dnnL2Lambda = 0.001,
    dnn_dropout = "0.4"
  ))

  expect_equal(payload$dnn_model_type, "DNN_Large")
  expect_equal(payload$dnn_n_seeds, 7L)
  expect_equal(payload$dnn_device, "cpu")
  expect_equal(payload$dnn_lambda, 0.02)
  expect_equal(payload$dnn_dropout, 0.4)
})

test_that("model payload normalizer accepts legacy camelCase DNN aliases", {
  payload <- sdm_normalize_model_payload(list(
    dnnArchitecture = "DNN_Small",
    dnnNSeeds = "4",
    dnnDevice = "auto",
    dnnL2Lambda = "0.005",
    dnnDropout = "0.25"
  ))

  expect_equal(payload$dnn_model_type, "DNN_Small")
  expect_equal(payload$dnn_n_seeds, 4L)
  expect_equal(payload$dnn_device, "auto")
  expect_equal(payload$dnn_lambda, 0.005)
  expect_equal(payload$dnn_dropout, 0.25)
})

test_that("model payload normalizer preserves multispecies DNN aliases", {
  payload <- sdm_normalize_model_payload(list(
    dnn_model_type = "DNN_Medium",
    dnn_multispecies_architecture = "DNN_Large",
    dnnMultispeciesArchitecture = "DNN_Small",
    dnn_multispecies_n_seeds = "9",
    dnnMultispeciesNSeeds = 2
  ))

  expect_equal(payload$dnn_architecture, "DNN_Large")
  expect_equal(payload$dnn_multispecies_architecture, "DNN_Large")
  expect_equal(payload$dnn_multispecies_n_seeds, 9L)

  fallback <- sdm_normalize_model_payload(list(
    dnnMultispeciesArchitecture = "DNN_Small",
    dnnMultispeciesNSeeds = "3"
  ))
  expect_equal(fallback$dnn_architecture, "DNN_Small")
  expect_equal(fallback$dnn_multispecies_architecture, "DNN_Small")
  expect_equal(fallback$dnn_multispecies_n_seeds, 3L)
})

test_that("model payload normalizer handles xgboost aliases", {
  payload <- sdm_normalize_model_payload(list(
    xgb_max_depth = "8",
    xgbMaxDepth = 4,
    xgb_eta = "0.15",
    xgbEta = 0.3,
    xgb_nrounds = "250",
    xgbNrounds = 100,
    xgbNRounds = 50
  ))

  expect_equal(payload$xgb_max_depth, 8L)
  expect_equal(payload$xgb_eta, 0.15)
  expect_equal(payload$xgb_nrounds, 250L)

  camel <- sdm_normalize_model_payload(list(xgbNrounds = "120", xgbNRounds = "80"))
  expect_equal(camel$xgb_nrounds, 120L)
})

test_that("model payload normalizer handles multi-ensemble and biomod2 aliases", {
  payload <- sdm_normalize_model_payload(list(
    multiEnsembleModels = c("glm", "rangebag"),
    multiEnsembleWeighting = "equal",
    multiEnsemblePower = "1.5",
    multiEnsembleMinAuc = "0.72",
    multiEnsembleMinTss = "0.42",
    multiEnsembleExport = FALSE,
    multiEnsembleUncertainty = TRUE,
    multiEnsembleBiomod2 = c("GLM", "RF")
  ))

  expect_identical(payload$multi_ensemble_models, c("glm", "rangebag"))
  expect_equal(payload$multi_ensemble_weighting, "equal")
  expect_equal(payload$multi_ensemble_power, 1.5)
  expect_equal(payload$multi_ensemble_min_auc, 0.72)
  expect_equal(payload$multi_ensemble_min_tss, 0.42)
  expect_false(payload$multi_ensemble_export)
  expect_true(payload$multi_ensemble_uncertainty)
  expect_identical(payload$biomod2_models, c("GLM", "RF"))
})

test_that("model payload normalizer handles masks and climate extras", {
  payload <- sdm_normalize_model_payload(list(
    maskType = "file",
    maskFile = "/tmp/mask.tif",
    maskBufferDeg = "0.25",
    uvMonths = c("jan", "feb"),
    droughtPeriods = c("annual_mean", "q1"),
    chelsaExtras = c("gdd5", "gsl"),
    analysisCrs = "EPSG:3577",
    generateTiles = FALSE
  ))

  expect_equal(payload$mask_type, "file")
  expect_equal(payload$mask_file, "/tmp/mask.tif")
  expect_equal(payload$mask_buffer_deg, 0.25)
  expect_identical(payload$selected_uv_months, c("jan", "feb"))
  expect_identical(payload$selected_drought_periods, c("annual_mean", "q1"))
  expect_identical(payload$selected_chelsa_extras, c("gdd5", "gsl"))
  expect_equal(payload$analysis_crs, "EPSG:3577")
  expect_false(payload$generate_tiles)
})

test_that("model payload normalizer handles NE boundary and training extent fields", {
  payload <- sdm_normalize_model_payload(list(
    maskBoundaryType = "admin0",
    maskResolution = "auto",
    maskCountry = "all",
    restrictBackground = TRUE,
    trainingExtent = c(140, 150, -30, -20)
  ))

  expect_equal(payload$mask_boundary_type, "admin0")
  expect_equal(payload$mask_resolution, "auto")
  expect_equal(payload$mask_country, "all")
  expect_true(payload$restrict_background)

  camel <- sdm_normalize_model_payload(list(
    mask_boundary_type = "land",
    mask_resolution = "50m",
    mask_country = "Australia",
    restrict_background = "true",
    training_extent = "112,154,-44,-10"
  ))

  expect_equal(camel$mask_boundary_type, "land")
  expect_equal(camel$mask_resolution, "50m")
  expect_equal(camel$mask_country, "Australia")
  expect_true(camel$restrict_background)

  logical_false <- sdm_normalize_model_payload(list(
    restrictBackground = "false"
  ))
  expect_false(logical_false$restrict_background)

  default_restrict <- sdm_normalize_model_payload(list(
    maskBoundaryType = "admin0"
  ))
  expect_null(default_restrict$restrict_background)
})
