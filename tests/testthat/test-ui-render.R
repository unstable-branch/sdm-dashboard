test_that("all R sources parse without error", {
  r_files <- list.files(file.path(project_root, "R"), pattern = "[.][Rr]$", full.names = TRUE)
  for (f in r_files) {
    expect_no_error(parse(f))
  }
  expect_no_error(parse(file.path(project_root, "app.R")))
  expect_no_error(parse(file.path(project_root, "pipeline.R")))
  expect_no_error(parse(file.path(project_root, "launch_app.R")))
})

test_that("ui_sidebar_controls returns a valid Shiny tag", {
  skip_if_not_installed("shiny")
  library(shiny, quietly = TRUE)
  if (!exists("default_cores", envir = .GlobalEnv)) assign("default_cores", parallel::detectCores() - 1, envir = .GlobalEnv)
  if (!exists("sdm_initial_species", envir = .GlobalEnv)) assign("sdm_initial_species", sdm_default_species, envir = .GlobalEnv)
  ui <- ui_sidebar_controls()
  expect_s3_class(ui, "shiny.tag")
  expect_equal(ui$name, "div")
})

test_that("ui_main_tabs returns a valid Shiny tag", {
  skip_if_not_installed("shiny")
  skip_if_not_installed("leaflet")
  library(shiny, quietly = TRUE)
  library(leaflet, quietly = TRUE)
  ui <- ui_main_tabs()
  expect_s3_class(ui, "shiny.tag")
  expect_equal(ui$name, "div")
})

test_that("sidebar contains required input IDs", {
  skip_if_not_installed("shiny")
  library(shiny, quietly = TRUE)
  if (!exists("default_cores", envir = .GlobalEnv)) assign("default_cores", parallel::detectCores() - 1, envir = .GlobalEnv)
  if (!exists("sdm_initial_species", envir = .GlobalEnv)) assign("sdm_initial_species", sdm_default_species, envir = .GlobalEnv)
  rendered <- htmltools::renderTags(shiny::tagList(ui_sidebar_controls()))$html
  required_ids <- c(
    "species", "data_source", "worldclim_dir", "worldclim_res",
    "climate_source", "biovars", "model_id", "cv_folds", "cv_strategy",
    "extent_preset", "future_projection", "threshold", "run_model", "cancel_model"
  )
  for (id in required_ids) {
    expect_true(grepl(sprintf('id="%s"', id), rendered, fixed = TRUE))
  }
})

test_that("main tabs contain required input IDs", {
  skip_if_not_installed("shiny")
  skip_if_not_installed("leaflet")
  library(shiny, quietly = TRUE)
  library(leaflet, quietly = TRUE)
  rendered <- htmltools::renderTags(shiny::tagList(ui_main_tabs()))$html
  required_ids <- c(
    "show_presence", "show_background", "show_mess",
    "suitability_display", "tabs"
  )
  for (id in required_ids) {
    expect_true(grepl(sprintf('id="%s"', id), rendered, fixed = TRUE))
  }
})

test_that("sidebar has collapsible advanced section", {
  skip_if_not_installed("shiny")
  library(shiny, quietly = TRUE)
  if (!exists("default_cores", envir = .GlobalEnv)) assign("default_cores", parallel::detectCores() - 1, envir = .GlobalEnv)
  if (!exists("sdm_initial_species", envir = .GlobalEnv)) assign("sdm_initial_species", sdm_default_species, envir = .GlobalEnv)
  rendered <- htmltools::renderTags(shiny::tagList(ui_sidebar_controls()))$html
  expect_true(grepl("<details", rendered, fixed = TRUE))
  expect_true(grepl("Advanced settings", rendered, fixed = TRUE))
})

test_that("threshold slider is in sidebar not dashboard", {
  skip_if_not_installed("shiny")
  skip_if_not_installed("leaflet")
  library(shiny, quietly = TRUE)
  library(leaflet, quietly = TRUE)
  if (!exists("default_cores", envir = .GlobalEnv)) assign("default_cores", parallel::detectCores() - 1, envir = .GlobalEnv)
  if (!exists("sdm_initial_species", envir = .GlobalEnv)) assign("sdm_initial_species", sdm_default_species, envir = .GlobalEnv)
  sidebar_html <- htmltools::renderTags(shiny::tagList(ui_sidebar_controls()))$html
  dashboard_html <- htmltools::renderTags(shiny::tagList(ui_main_tabs()))$html
  expect_true(grepl('id="threshold"', sidebar_html, fixed = TRUE))
  expect_false(grepl('id="threshold"', dashboard_html, fixed = TRUE))
})

test_that("ui_advanced_modal returns placeholder", {
  skip_if_not_installed("shiny")
  library(shiny, quietly = TRUE)
  ui <- ui_advanced_modal()
  expect_s3_class(ui, "shiny.tag")
})
