test_that("fit_sdm_model keeps closure bindings captured at registration", {
  local({
    captured_id <- "closure-value"
    register_sdm_model(
      id = "closure_probe", label = "probe", method = "probe",
      fit_fun = function(...) list(seen = captured_id),
      predict_fun = function(...) NULL
    )
  })
  on.exit(rm(list = "closure_probe", envir = sdm_model_registry), add = TRUE)
  fit <- fit_sdm_model("closure_probe")
  expect_identical(fit$seen, "closure-value")
})
