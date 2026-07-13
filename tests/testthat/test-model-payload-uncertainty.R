test_that("model payload normalizer handles dnn_mc_samples aliases", {
  payload <- sdm_normalize_model_payload(list(
    dnn_mc_samples = "30",
    dnnMcSamples = 10,
    dnn_uncertainty_method = "aleatoric_epistemic",
    dnnUncertaintyMethod = "mc_dropout"
  ))

  expect_equal(payload$dnn_uncertainty_method, "aleatoric_epistemic")
})

test_that("model payload normalizer accepts camelCase uncertainty aliases alone", {
  payload <- sdm_normalize_model_payload(list(
    dnnMcSamples = "50",
    dnnUncertaintyMethod = "mc_dropout"
  ))

  expect_equal(payload$dnn_mc_samples, 50L)
  expect_equal(payload$dnn_uncertainty_method, "mc_dropout")
})

test_that("model payload normalizer coalesces mc_samples defaults", {
  payload <- sdm_normalize_model_payload(list())
  expect_null(payload$dnn_mc_samples)

  payload_zero <- sdm_normalize_model_payload(list(dnn_mc_samples = 0))
  expect_equal(payload_zero$dnn_mc_samples, 0L)
})
