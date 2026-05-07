test_that("source release selection excludes generated and sensitive paths", {
  env <- new.env(parent = .GlobalEnv)
  source(sdm_test_path("scripts", "make_release_zip.R"), local = env)

  sample_paths <- c(
    "presence_data.csv", "outputs/model.tif", "screenshots/app.png",
    "sdm-dashboard-v0.1.0-beta-source.zip", ".env", ".Renviron",
    "covariates/opentopo/dem.tif", "logs/run.log", "Worldclim/wc2.1_10m_bio_1.tif",
    "Worldclim_future/wc2.1_10m_bio_1.tif", "AGENTS.md", "docs/index.md", "R/validation.R",
    "data/examples/synthetic_presence_data.csv"
  )

  excluded <- env$release_should_exclude(sample_paths, include_worldclim = FALSE)
  expect_true(all(excluded[1:12]))
  expect_false(excluded[13])
  expect_false(excluded[14])
  expect_false(env$release_should_exclude("Worldclim/wc2.1_10m_bio_1.tif", include_worldclim = TRUE))
})

test_that("source release file list does not include local generated files", {
  env <- new.env(parent = .GlobalEnv)
  source(sdm_test_path("scripts", "make_release_zip.R"), local = env)
  files <- env$release_included_paths(include_worldclim = FALSE)

  expect_true("scripts/smoke_test.R" %in% files)
  expect_true("tests/testthat.R" %in% files)
  expect_true("www/sdm-theme.css" %in% files)
  expect_false(any(grepl("^Worldclim(/|$)|^worldclim(/|$)|^WorldClim(/|$)|^Worldclim_future(/|$)|^worldclim_future(/|$)|^WorldClim_future(/|$)|^outputs(/|$)|^covariates(/|$)|^logs(/|$)", files)))
  expect_false(any(basename(files) %in% c("presence_data.csv", ".env", ".Renviron")))
  expect_false(any(grepl("(^|/)AGENTS[.]md$|^docs(/|$)|^Main[.]R$|^prepare_windows[.]bat$|\\.zip$|\\.log$", files, ignore.case = TRUE)))
})

test_that("Windows-ready release file list is end-user focused", {
  env <- new.env(parent = .GlobalEnv)
  source(sdm_test_path("scripts", "make_release_zip.R"), local = env)
  files <- env$ready_release_paths(include_worldclim = FALSE)

  expect_true("run_app_windows.bat" %in% files)
  expect_true(file.path("scripts", "windows_setup.R") %in% files)
  expect_true("www/sdm-theme.css" %in% files)
  expect_false(any(grepl("^\\.github(/|$)|^tests(/|$)|^Dockerfile$|^docker-compose[.]yml$|^scripts/(audit_release|make_release_zip|smoke_test|download_worldclim)[.]R$", files)))
})
