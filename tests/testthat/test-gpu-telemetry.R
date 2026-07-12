if (!exists(".sdm_parse_rocm_smi_json", mode = "function")) {
  source(file.path(project_root, "plumber", "R", "helpers", "vsize.R"))
}

test_that("ROCm telemetry JSON is normalized without changing NVIDIA fields", {
  fixture <- paste0(
    '{"card0": {',
    '"Temperature (Sensor edge) (C)": "54.0",',
    '"GPU use (%)": "37",',
    '"VRAM Total Memory (B)": "17163091968",',
    '"VRAM Total Used Memory (B)": "2147483648",',
    '"Card Series": "AMD Radeon RX 6900 XT",',
    '"GFX Version": "gfx1030"}}'
  )

  info <- .sdm_parse_rocm_smi_json(fixture)
  expect_identical(info$name, "AMD Radeon RX 6900 XT")
  expect_identical(info$vendor, "AMD")
  expect_identical(info$backend, "rocm")
  expect_identical(info$architecture, "gfx1030")
  expect_equal(info$vram_total_mib, 16368)
  expect_equal(info$vram_used_mib, 2048)
  expect_equal(info$vram_free_mib, 14320)
  expect_equal(info$gpu_utilization_pct, 37)
  expect_equal(info$temperature_c, 54)
})

test_that("ROCm telemetry parser rejects payloads without cards", {
  expect_null(.sdm_parse_rocm_smi_json('{"system": {"status": "ok"}}'))
})
