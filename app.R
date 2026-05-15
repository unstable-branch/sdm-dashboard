# User-friendly web interface for the SDM project
# Run with: Rscript app.R

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
app_path <- if (length(file_arg) > 0) sub("^--file=", "", file_arg[1]) else NA_character_
if (is.na(app_path)) {
  app_ofiles <- vapply(sys.frames(), function(frame) {
    if (!is.null(frame$ofile)) frame$ofile else NA_character_
  }, character(1))
  app_ofiles <- app_ofiles[!is.na(app_ofiles) & basename(app_ofiles) == "app.R"]
  if (length(app_ofiles) > 0) app_path <- app_ofiles[length(app_ofiles)]
}
app_dir <- if (!is.na(app_path)) dirname(normalizePath(app_path, winslash = "/", mustWork = TRUE)) else getwd()
source(file.path(app_dir, "R", "bootstrap.R"))
sdm_set_project_root(app_dir)

engine_candidates <- unique(c(
  file.path(app_dir, "R", "optimized_sdm.R"),
  file.path(getwd(), "R", "optimized_sdm.R"),
  "optimized_sdm.R"
))
engine_file <- engine_candidates[file.exists(engine_candidates)][1]
if (is.na(engine_file)) {
  stop(
    "Could not find the modelling engine file optimized_sdm.R.\n",
    "Expected either R/optimized_sdm.R or optimized_sdm.R in the project folder.\n",
    "Your zip/extraction may be incomplete."
  )
}
source(engine_file)

source(file.path(app_dir, "R", "ui_header.R"))
source(file.path(app_dir, "R", "ui_sidebar_controls.R"))
source(file.path(app_dir, "R", "ui_main_tabs.R"))
default_cores <- normalize_core_count(NULL, reserve_one = TRUE)
ensure_sdm_packages(c("shiny", "bslib", "terra", "leaflet", "sf", "DT"), n_cores = default_cores)

suppressPackageStartupMessages({
  library(shiny)
  library(bslib)
  library(leaflet)
  library(sf)
})

options(shiny.maxRequestSize = 300 * 1024^2)

sdm_initial_occurrence_file <- if (file.exists(sdm_default_occurrence_file)) sdm_default_occurrence_file else if (file.exists(sdm_demo_occurrence_file)) sdm_demo_occurrence_file else NA_character_
sdm_initial_species <- default_species_label(sdm_initial_occurrence_file)
sdm_theme_css_file <- file.path(app_dir, "www", "sdm-theme.css")
sdm_theme_css <- if (file.exists(sdm_theme_css_file)) paste(readLines(sdm_theme_css_file, warn = FALSE), collapse = "\n") else ""

ui <- fluidPage(
  theme = bslib::bs_theme(version = 5, bootswatch = "flatly", primary = "#0B6E69"),
  tags$head(
    tags$link(rel = "stylesheet", href = "sdm-theme.css"),
    tags$script(HTML("\n      console.log('SDM Dashboard JS loaded');\n      Shiny.addCustomMessageHandler('setRunState', function(x) {\n        var btn = document.getElementById('run_model');\n        if (!btn) { console.log('setRunState: run_model btn not found'); return; }\n        console.log('setRunState called, running=', x.running);\n        btn.disabled = !!x.running;\n        btn.classList.toggle('disabled', !!x.running);\n        btn.textContent = x.running ? 'Running SDM...' : 'Run SDM';\n      });\n      (function() {\n        function setTheme(dark) {\n          document.body.classList.toggle('sdm-dark', dark);\n          document.body.classList.toggle('sdm-light', !dark);\n          try { window.localStorage.setItem('sdm-dashboard-theme', dark ? 'dark' : 'light'); } catch (e) {}\n        }\n        function initialTheme() {\n          try {\n            var saved = window.localStorage.getItem('sdm-dashboard-theme');\n            if (saved === 'dark' || saved === 'light') return saved === 'dark';\n          } catch (e) {}\n          return true;\n        }\n        function wireToggle() {\n          var toggle = document.getElementById('dark_mode');\n          var dark = initialTheme();\n          setTheme(dark);\n          if (!toggle || toggle.dataset.themeBound === '1') return;\n          toggle.checked = dark;\n          toggle.dataset.themeBound = '1';\n          toggle.addEventListener('change', function() { setTheme(toggle.checked); });\n        }\n        document.addEventListener('DOMContentLoaded', wireToggle);\n        document.addEventListener('shiny:connected', function() { console.log('Shiny connected'); wireToggle(); });\n      })();\n    "))
  ),

  ui_header(),

  sidebarLayout(
    sidebarPanel(width = 3, class = "control-panel",
      ui_sidebar_controls()
    ),

    ui_main_tabs()
  )
)

server <- function(input, output, session) {
  rv <- reactiveValues(result = NULL, log = "Ready.\n", error = NULL, running = FALSE, gbif_temp_file = NULL, gbif_doi = NULL, cleaned_occurrence = NULL,
                      batch_running = FALSE, batch_results = NULL, batch_log = character(),
                      cmip6_scenarios = NULL)
  append_log <- function(message) rv$log <- paste0(rv$log, format(Sys.time(), "%H:%M:%S"), "  ", message, "\n")
  previous_occurrence_path <- reactiveVal(NULL)
  last_auto_species <- reactiveVal(sdm_initial_species)
  species_manually_set <- reactiveVal(FALSE)
  last_progress <- reactiveVal(0)
  readiness_item <- function(title, detail, state = "info") {
    symbol <- switch(state, ok = "OK", warn = "!", error = "!", "i")
    div(class = "readiness-item", div(class = "readiness-title", span(class = paste("pill", paste0("pill-", state)), symbol), title), div(class = "readiness-detail", detail))
  }

  observeEvent(input$fetch_gbif, {
    req(input$gbif_taxon)
    output$gbif_status <- renderUI(p("Fetching from GBIF..."))
    tryCatch({
      if (nzchar(input$gbif_token %||% "")) {
        result <- read_gbif_download(
          taxon = input$gbif_taxon,
          country = if (nzchar(input$gbif_country %||% "")) input$gbif_country else NULL,
          token = input$gbif_token
        )
        occ_df <- result$occurrences
        rv$gbif_doi <- result$doi
      } else {
        occ_df <- read_gbif_records(
          taxon = input$gbif_taxon,
          country = if (nzchar(input$gbif_country %||% "")) input$gbif_country else NULL,
          max_records = input$gbif_max_records,
          log_fun = append_log
        )
        rv$gbif_doi <- if (!is.null(occ_df$gbif_doi[1]) && !is.na(occ_df$gbif_doi[1])) occ_df$gbif_doi[1] else NULL
      }
      if (nrow(occ_df) == 0) {
        output$gbif_status <- renderUI(p(class = "status-error-text", "No GBIF records found for this species."))
        return()
      }
      temp_file <- tempfile(fileext = ".csv")
      write.csv(occ_df, temp_file, row.names = FALSE)
      rv$gbif_temp_file <- temp_file
      n <- nrow(occ_df)
      msg <- paste0("Loaded ", n, " records from GBIF")
      if (!is.null(rv$gbif_doi) && nzchar(rv$gbif_doi)) {
        msg <- paste0(msg, ". GBIF DOI: ", rv$gbif_doi)
      }
      output$gbif_status <- renderUI(p(msg))
      append_log(msg)
    }, error = function(e) {
      output$gbif_status <- renderUI(p(class = "status-error-text", paste0("Error: ", conditionMessage(e))))
      append_log(paste0("GBIF fetch error: ", conditionMessage(e)))
    })
  })

  observeEvent(input$data_source, {
    if (!identical(input$data_source, "gbif")) {
      rv$gbif_temp_file <- NULL
      rv$gbif_doi <- NULL
    }
  }, ignoreInit = TRUE)

  observeEvent(input$cancel_model, {
    if (!isTRUE(rv$running)) return()
    message("SDM: Run cancelled by user")
    options(sdm_cancelled = TRUE)
    rv$running <- FALSE
    rv$error <- "Run cancelled."
    append_log("Run cancelled by user.")
  })

  observeEvent(input$batch_cancel, {
    if (!isTRUE(rv$batch_running)) return()
    message("SDM: Batch cancelled by user")
    options(sdm_cancelled = TRUE)
    rv$batch_running <- FALSE
    rv$batch_log <- c(rv$batch_log, paste0(format(Sys.time(), "%H:%M:%S"), "  Batch cancelled by user.\n"))
  })

  output$batch_progress_ui <- renderUI({
    if (!isTRUE(input$batch_mode)) return(NULL)
    lines <- rv$batch_log
    if (length(lines) == 0) {
      div(class = "batch-log batch-log-empty", "No batch run yet.")
    } else {
      div(class = "batch-log batch-log-active",
          paste(lines, collapse = ""))
    }
  })

  observeEvent(input$batch_download_template, {
    tf <- tempfile(fileext = ".csv")
    write.csv(data.frame(
      species = c("Acacia mearnsii", "Opuntia stricta"),
      occurrences_csv = c("data/acacia.csv", "data/opuntia.csv"),
      model_id = c("glm", "glm"),
      biovars = c("1,4,6,12,15,18", "1,4,6,12,15,18"),
      use_elevation = c("FALSE", "FALSE"),
      worldclim_dir = c("Worldclim", "Worldclim"),
      cv_folds = c("3", "3"),
      stringsAsFactors = FALSE
    ), tf, row.names = FALSE)
    session$sendFileResponse(tf, basename = "batch_config_template.csv")
  })

  observeEvent(input$batch_run, {
    req(input$batch_config_file)
    if (isTRUE(rv$batch_running)) return()

    rv$batch_running <- TRUE
    rv$batch_log <- character()
    rv$batch_results <- NULL

    append_log_batch <- function(msg) {
      rv$batch_log <- c(rv$batch_log, paste0(format(Sys.time(), "%H:%M:%S"), "  ", msg, "\n"))
    }

    tryCatch({
      configs <- parse_batch_config(input$batch_config_file$datapath)
      n <- length(configs)
      append_log_batch(paste0("Batch started: ", n, " species  (cores=", input$batch_n_cores, ")"))

      rv$batch_results <- batch_run_parallel(
        species_configs = configs,
        n_cores = input$batch_n_cores,
        output_dir = file.path(sdm_default_output_dir, "batch"),
        progress_fun = function(msg) {
          append_log_batch(msg)
        },
        seed = 42L
      )

      n_ok <- sum(!sapply(rv$batch_results, is.null))
      n_err <- n - n_ok
      append_log_batch(paste0("Batch complete. Successful: ", n_ok, " / ", n))
      if (n_err > 0) append_log_batch(paste0("Errors: ", n_err, " (see *_<species>_ERROR.log in outputs/batch/)"))
    },
    error = function(e) {
      append_log_batch(paste0("ERROR: ", conditionMessage(e)))
    },
    finally = {
      rv$batch_running <- FALSE
    })
  })

  is_dwca_upload <- function() {
    req(input$occ_file)
    ext <- tools::file_ext(input$occ_file$name)
    identical(ext, "zip")
  }
  output$is_dwca <- reactive(is_dwca_upload())
  outputOptions(output, "is_dwca", suspendWhenHidden = FALSE)

  output$occ_format_detected <- renderUI({
    req(input$occ_file)
    ext <- tools::file_ext(input$occ_file$name)
    if (identical(ext, "zip")) {
      div(class = "small-muted status-positive",
        "Darwin Core Archive detected — GBIF dataset DOI will be captured automatically")
    } else {
      div(class = "small-muted", "CSV/TSV format detected")
    }
  })

  future_download_status <- reactive({
    future_dir <- normalizePath(trimws(input$future_worldclim_dir %||% sdm_default_future_worldclim_dir), winslash = "/", mustWork = FALSE)
    tif_count <- length(list.files(future_dir, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE))
    if (tif_count > 0) {
      div(class = "small-muted status-positive",
        paste0(tif_count, " future BIO layer(s) found — ready to project"))
    } else {
      tagList(
        div(class = "small-muted", "No future climate data yet?"),
        p(actionLink("open_future_download", "Download future climate layers (CMIP6)", class = "small-link")),
        div(class = "small-muted", "Runs scripts/setup_future_climate.R from a terminal to download UKESM1-0-LL SSP2-4.5 2041-2060 layers.")
      )
    }
  })
  output$future_download_status <- renderUI({ future_download_status() })
  outputOptions(output, "future_download_status", suspendWhenHidden = FALSE)

  output$future_scenario_selector <- renderUI({
    scenarios <- rv$cmip6_scenarios
    if (is.null(scenarios) || nrow(scenarios$scenarios) == 0) {
      return(tagList(
        p(class = "small-muted", "No scenarios downloaded yet. Use Get Data tab to download."),
        textInput("future_worldclim_dir", "Or enter folder path manually:",
                  value = sdm_default_future_worldclim_dir)
      ))
    }
    choices <- setNames(
      file.path("Worldclim_future", scenarios$scenarios$dir),
      paste(scenarios$scenarios$GCM, scenarios$scenarios$SSP, scenarios$scenarios$Period, sep = " / ")
    )
    tagList(
      selectInput("future_worldclim_dir", "CMIP6 scenario",
                  choices = c("Select a scenario" = "", choices),
                  selected = ""),
      p(class = "small-muted small-muted-xs",
        paste(nrow(scenarios$scenarios), "scenario(s) available. Selected folder:", input$future_worldclim_dir %||% "none"))
    )
  })
  outputOptions(output, "future_scenario_selector", suspendWhenHidden = FALSE)

  occurrence_source <- function() {
    selected <- if (is.null(input$data_source)) "project" else input$data_source
    uploaded <- !is.null(input$occ_file)
    project_exists <- file.exists(sdm_default_occurrence_file)
    demo_exists <- file.exists(sdm_demo_occurrence_file)
    gbif_path <- if (!is.null(rv$gbif_temp_file)) rv$gbif_temp_file else NULL
    if (identical(selected, "upload") && uploaded) {
      return(list(path = input$occ_file$datapath, detail = paste("Using uploaded observation records:", input$occ_file$name), state = "ok", issue = NULL))
    }
    if (identical(selected, "gbif") && !is.null(gbif_path) && file.exists(gbif_path)) {
      return(list(path = gbif_path, detail = paste("Using GBIF records for:", input$gbif_taxon), state = "ok", issue = NULL))
    }
    if (identical(selected, "project") && project_exists) {
      return(list(path = sdm_default_occurrence_file, detail = paste("Using project observation records:", sdm_default_occurrence_file), state = "ok", issue = NULL))
    }
    if (identical(selected, "demo") && demo_exists) {
      return(list(path = sdm_demo_occurrence_file, detail = paste("Using bundled synthetic demo observation records:", sdm_demo_occurrence_file), state = "ok", issue = NULL))
    }
    if (project_exists) {
      return(list(path = sdm_default_occurrence_file, detail = paste("Selected observation source unavailable; falling back to project file:", sdm_default_occurrence_file), state = "warn", issue = NULL))
    }
    if (demo_exists) {
      return(list(path = sdm_demo_occurrence_file, detail = paste("Selected observation source unavailable; falling back to bundled synthetic demo records:", sdm_demo_occurrence_file), state = "warn", issue = NULL))
    }
    list(path = NULL, detail = "No observation record file is available yet.", state = "error", issue = paste("Upload a CSV/TSV, add", sdm_default_occurrence_file, "to the project folder, or restore the demo dataset."))
  }

  observeEvent(input$species, {
    value <- trimws(input$species %||% "")
    if (!identical(value, last_auto_species()) && nzchar(value)) species_manually_set(TRUE)
    if (!nzchar(value)) species_manually_set(FALSE)
  }, ignoreInit = TRUE)

  observe({
    occurrence <- occurrence_source()
    inferred <- infer_species_label(occurrence$path)
    next_label <- if (!is.na(inferred) && nzchar(inferred)) inferred else sdm_default_species
    if (!isTRUE(species_manually_set()) || !nzchar(trimws(input$species %||% ""))) {
      last_auto_species(next_label)
      updateTextInput(session, "species", value = next_label)
    }
  })

  observeEvent(input$open_future_download, {
    showModal(modalDialog(
      title = "Download Future Climate Layers",
      size = "m",
      easyClose = TRUE,
      footer = modalButton("Close"),
      p("This will download CMIP6 future climate layers to the"),
      code("Worldclim_future/"), HTML("&nbsp;folder using the default:"),
      tags$ul(
        tags$li(HTML("<strong>GCM:</strong> UKESM1-0-LL")),
        tags$li(HTML("<strong>SSP:</strong> SSP2-4.5 (intermediate emissions)")),
        tags$li(HTML("<strong>Period:</strong> 2041-2060 (mid-century)"))
      ),
      p("To customise the download, run from a terminal:"),
      code('Rscript scripts/setup_future_climate.R --gcm MRI-ESM2-0 --ssp SSP5-8.5 --period 2061-2080'),
      hr(),
      p(class = "small-muted", "The download requires internet access and may take several minutes for the first dataset. Run the app from a terminal to see progress.")
    ))
  })

  observeEvent(input$open_advanced_modal, {
    showModal(bslib::modal(
      title = "Advanced Settings",
      size = "l",
      easyClose = FALSE,
      footer = tagList(
        actionButton("apply_advanced", "Apply", class = "btn-primary"),
        modalButton("Cancel")
      ),
      tags$div(class = "advanced-modal-body",
        h4("Cross-validation"),
        selectInput("cv_strategy_modal", "CV strategy",
          choices = c("Random" = "random", "Spatial blocks" = "spatial_blocks"),
          selected = input$cv_strategy %||% sdm_default_cv_strategy),
        conditionalPanel("input.cv_strategy_modal == 'spatial_blocks'",
          numericInput("cv_block_size_km_modal", "Spatial block size (km)",
            value = input$cv_block_size_km %||% if (is.na(sdm_default_cv_block_size_km)) 50 else sdm_default_cv_block_size_km,
            min = 1, max = 500, step = 1),
          div(class = "small-muted", "Auto-estimated if left at default.")
        ),
        hr(),
        h4("Bias correction"),
        selectInput("bias_method_modal", "Background sampling bias correction",
          choices = c("Uniform random" = "uniform", "Target-group" = "target_group", "Thickened" = "thickened"),
          selected = input$bias_method %||% "uniform"),
        conditionalPanel("input.bias_method_modal == 'target_group'",
          fileInput("target_group_file_modal", "Upload related species occurrences (CSV)",
            accept = c(".csv")),
          div(class = "small-muted", "One record per row with longitude and latitude columns.")
        ),
        conditionalPanel("input.bias_method_modal == 'thickened'",
          numericInput("thickening_distance_km_modal", "Kernel distance (km)",
            value = input$thickening_distance_km %||% 10, min = 1, max = 100)
        ),
        hr(),
        h4("CoordinateCleaner (Advanced Cleaning)"),
        selectInput("cc_tests_modal", "CC tests to run",
          choices = c("All tests" = "all", "Sea only" = "sea", "Capitals only" = "capitals",
                      "Institutions only" = "institutions", "Centroids only" = "centroids",
                      "Urban only" = "urban", "Zero only" = "zero"),
          selected = input$cc_tests %||% "all"),
        hr(),
        h4("Data merging"),
        checkboxInput("merge_small_sources_modal", "Merge small occurrence sources", value = input$merge_small_sources %||% TRUE),
        checkboxInput("vif_reduction_modal", "Drop collinear covariates (VIF > 10)", value = input$vif_reduction %||% FALSE)
      )
    ))
  })

  observeEvent(input$apply_advanced, {
    removeModal()
    updateSelectInput(session, "cv_strategy", selected = input$cv_strategy_modal)
    if (identical(input$cv_strategy_modal, "spatial_blocks") && !is.null(input$cv_block_size_km_modal)) {
      updateNumericInput(session, "cv_block_size_km", value = input$cv_block_size_km_modal)
    }
    updateSelectInput(session, "bias_method", selected = input$bias_method_modal)
    if (!is.null(input$thickening_distance_km_modal)) {
      updateNumericInput(session, "thickening_distance_km", value = input$thickening_distance_km_modal)
    }
    if (!is.null(input$target_group_file_modal) && isTRUE(input$bias_method_modal == "target_group")) {
      safe_name <- make.names(basename(input$target_group_file_modal$name), unique = TRUE)
      shiny::file.copy(input$target_group_file_modal$datapath,
                      file.path(tempdir(), safe_name), overwrite = TRUE)
    }
    updateSelectInput(session, "cc_tests", selected = input$cc_tests_modal)
    updateCheckboxInput(session, "merge_small_sources", value = isTRUE(input$merge_small_sources_modal))
    updateCheckboxInput(session, "vif_reduction", value = isTRUE(input$vif_reduction_modal))
  })

  observe({
    occurrence <- occurrence_source()
    use_cc <- isTRUE(input$use_coordinatecleaner)
    cc_tests <- input$cc_tests %||% "all"
    current_path <- occurrence$path

    if (!identical(current_path, previous_occurrence_path())) {
      previous_occurrence_path(current_path)
      rv$cleaned_occurrence <- NULL
      output$cc_stats_log <- renderText("Loading occurrence data...")
      output$source_table <- renderTable({
        data.frame(Message = "Loading...")
      }, striped = FALSE, hover = FALSE)
    }

    if (is.null(current_path)) {
      return()
    }
    cleaned <- clean_occurrence_preview(occurrence$path, min_source_records = input$min_source_records, use_cc = use_cc, cc_tests = cc_tests)
    if (!is.null(cleaned$error)) {
      rv$cleaned_occurrence <- NULL
      return()
    }
    if (!"cc_flag" %in% names(cleaned$occ)) {
      cleaned$occ$cc_flag <- FALSE
    }
    rv$cleaned_occurrence <- list(
      df = cleaned$occ,
      source_counts = cleaned$source_counts,
      n_absent_excluded = cleaned$n_absent_excluded,
      original_rows = cleaned$original_rows
    )
  })

  readiness <- reactive({
    biovars <- as.integer(input$biovars)
    biovars <- biovars[!is.na(biovars)]
    cleaned <- rv$cleaned_occurrence
    extent <- extent_from_inputs(input, cleaned)
    issues <- character()
    warnings <- character()

    occurrence <- occurrence_source()
    if (!is.null(occurrence$issue)) issues <- c(issues, occurrence$issue)
    if (identical(occurrence$state, "warn")) warnings <- c(warnings, occurrence$detail)
    if (!is.null(cleaned$error)) issues <- c(issues, paste("Observation records cannot be read:", cleaned$error))

    climate_files <- find_worldclim_files(input$worldclim_dir, biovars, source = input$climate_source %||% "worldclim")
    missing_climate <- names(climate_files)[is.na(climate_files)]
    climate_state <- "ok"
    climate_detail <- paste(length(climate_files) - length(missing_climate), "of", length(climate_files), "selected BIO layers found in", input$worldclim_dir)
    if (length(biovars) < 2) {
      issues <- c(issues, "Select at least two BIOCLIM variables.")
      climate_state <- "error"
      climate_detail <- "Select at least two climate variables."
    } else if (length(missing_climate) > 0 && isTRUE(input$download_worldclim)) {
      climate_state <- "warn"
      climate_detail <- paste0(climate_detail, "; missing BIO", paste(missing_climate, collapse = ", BIO"), " will be downloaded if available.")
      warnings <- c(warnings, "WorldClim download is enabled for missing BIO layers.")
    } else if (length(missing_climate) > 0) {
      climate_state <- "error"
      missing_biovars <- paste(missing_climate, collapse = ", BIO")
      climate_detail <- paste0(climate_detail, "; missing BIO", missing_biovars, ".")
      clim_src <- if (is.null(input$climate_source)) "worldclim" else input$climate_source
      if (identical(clim_src, "chelsa")) {
        expected_patterns <- vapply(as.integer(missing_climate), function(bv) {
          if (bv < 10) sprintf("CHELSA_bio0%d_*.tif", bv) else sprintf("CHELSA_bio%d_*.tif", bv)
        }, character(1))
        issues <- c(issues, paste0("Add missing CHELSA v2.1 BIO layers to ", input$worldclim_dir, " (e.g., ", paste(expected_patterns, collapse = ", "), ")."))
      } else {
        expected_patterns <- vapply(as.integer(missing_climate), function(bv) {
          sprintf("bio_%d.tif  or  wc2.1_%sm_bio_%d.tif", bv, input$worldclim_res, bv)
        }, character(1))
        issues <- c(issues, paste0("Add missing WorldClim BIO layers to ", input$worldclim_dir, " (e.g., ", paste(expected_patterns, collapse = ", "), "), or use the Get Data tab to download."))
      }
    }

    elevation_state <- "info"
    elevation_detail <- "Elevation covariate is off."
    if (isTRUE(input$use_elevation)) {
      api_key <- if (is.null(input$opentopo_api_key)) "" else input$opentopo_api_key
      has_key <- nzchar(trimws(api_key)) || opentopo_key_is_configured()
      elevation_state <- if (has_key) "ok" else "error"
      elevation_detail <- if (has_key) paste("Elevation on:", input$elevation_demtype, "with an API key available.") else "Elevation is on, but no OpenTopography API key is available."
      if (!has_key) issues <- c(issues, "Provide an OpenTopography API key or set OPENTOPOGRAPHY_API_KEY.")
    }

    soil_state <- "info"
    soil_detail <- "SoilGrids covariates are off."
    if (isTRUE(input$use_soil)) {
      if (length(input$soil_vars) == 0) {
        soil_state <- "error"
        soil_detail <- "Soil is on, but no SoilGrids variables are selected."
        issues <- c(issues, "Select at least one SoilGrids variable, or turn soil covariates off.")
      } else {
        soil_state <- "ok"
        n_depths <- length(input$soil_depths %||% character(0))
        n_vars <- length(input$soil_vars)
        soil_detail <- paste(n_vars, "variable(s) ×", n_depths, "depth(s) =", n_vars * n_depths, "soil layer(s) from SoilGrids")
      }
    }

    extent_state <- "ok"
    extent_detail <- paste0("xmin ", extent[1], ", xmax ", extent[2], ", ymin ", extent[3], ", ymax ", extent[4])
    if (any(!is.finite(extent)) || any(is.na(extent)) || extent[1] >= extent[2] || extent[3] >= extent[4]) {
      extent_state <- "error"
      extent_detail <- "Projection extent is invalid. Ensure xmin < xmax, ymin < ymax, and all values are finite numbers within longitude [-180,180] and latitude [-90,90]."
      issues <- c(issues, "Fix the projection extent values.")
    }
    overlap_state <- "info"
    overlap_detail <- "Observation/projection overlap will be checked after observation records are available."
    overlap <- if (!is.null(cleaned) && is.null(cleaned$error)) occurrence_extent_overlap(cleaned$occ, extent) else NULL
    if (!is.null(overlap)) {
      overlap_detail <- paste0(overlap$count, " of ", overlap$total, " cleaned observation records (", fmt_num(overlap$percent, 1), "%) fall inside the selected projection extent.")
      overlap_state <- if (overlap$count == 0 || overlap$percent < 10) "info" else "ok"
    }

    future_state <- "info"
    future_detail <- "Future climate projection is off."
if (isTRUE(input$future_projection)) {
      future_dir <- trimws(input$future_worldclim_dir %||% "")
      if (!nzchar(future_dir)) {
        future_state <- "info"
        future_detail <- "Future projection is on, but no folder path is set."
      } else {
        future_files <- future_projection_files(future_dir, biovars)
        missing_future <- names(future_files)[is.na(future_files)]
        if (length(missing_future) > 0) {
          future_state <- "info"
          future_detail <- paste0("Missing BIO", paste(missing_future, collapse = ", BIO"), " in ", future_dir, ". Future projection will use current climate only.")
        } else {
          future_state <- "ok"
          future_detail <- paste(length(future_files), "matching future BIO layers found in", future_dir)
        }
      }
    }

    elevation_count <- if (isTRUE(input$use_elevation) && identical(elevation_state, "ok")) 1L else 0L
    soil_count <- if (isTRUE(input$use_soil) && identical(soil_state, "ok")) length(input$soil_vars) * length(input$soil_depths %||% 1L) else 0L
    selected_count <- length(biovars) + elevation_count + soil_count
    list(
      ready = length(issues) == 0,
      issues = issues,
      warnings = warnings,
      selected_count = selected_count,
      items = list(
        readiness_item("Observation records", occurrence$detail, occurrence$state),
        readiness_item("WorldClim layers", climate_detail, climate_state),
        readiness_item("Elevation", elevation_detail, elevation_state),
        readiness_item("SoilGrids", soil_detail, soil_state),
        readiness_item("Selected covariates", paste(selected_count, "total covariates selected; BIO", paste(biovars, collapse = ", BIO")), if (selected_count >= 2) "ok" else "error"),
        readiness_item("Projection extent", extent_detail, extent_state),
        readiness_item("Observation/projection overlap", overlap_detail, overlap_state),
        readiness_item("Future climate projection", future_detail, future_state)
      )
    )
  })

  observe({
    tryCatch({
      session$sendCustomMessage("setRunState", list(running = isTRUE(rv$running)))
    }, error = function(e) {
      message("Warning: setRunState message failed: ", conditionMessage(e))
    })
  })
  output$esm_recommendation <- renderUI({
    req(rv$cleaned_occurrence)
    n_pres <- sum(rv$cleaned_occurrence$presence == 1, na.rm = TRUE)
    esm_available <- "esm_glm" %in% sdm_model_ids()

    if (n_pres < 10 && esm_available) {
      div(class = "alert alert-danger",
          icon("exclamation-triangle"),
          strong(sprintf(" Very few records: %d presence", n_pres)),
          " — ESM is recommended but results should be treated with caution.")
    } else if (n_pres < 30 && esm_available) {
      div(class = "alert alert-info",
          icon("info-circle"),
          strong(" Rare species detected"),
          sprintf(" — %d presence records. ESM recommended.", n_pres),
          actionButton("switch_to_esm", "Switch to ESM", class = "btn-info btn-sm"))
    } else if (n_pres < 30 && !esm_available) {
      div(class = "alert alert-warning",
          icon("package"),
          strong(" Low record count"),
          sprintf(" — only %d presence records. ", n_pres),
          "Install ecospat to enable ESM (recommended): ",
          tags$code("install.packages('ecospat')"))
    }
  })

  observeEvent(input$switch_to_esm, {
    updateSelectInput(session, "model_id", selected = "esm_glm")
  })

  output$esm_complexity_warning <- renderUI({
    req(input$model_id %in% c("esm_glm", "esm_maxnet"))
    n_vars <- length(input$biovars %||% sdm_default_biovars)
    n_pres <- if (!is.null(rv$cleaned_occurrence) && is.data.frame(rv$cleaned_occurrence$df)) {
      sum(rv$cleaned_occurrence$df$presence == 1, na.rm = TRUE)
    } else 0L
    n_pairs <- n_vars * (n_vars - 1) / 2
    tags$div(
      div(class = "alert alert-info small-padded",
          icon("flask"),
          strong("ESM is experimental."),
          " Expect longer run times and occasional convergence issues."),
      if (n_vars > 10) {
        div(class = "alert alert-warning small-padded",
            icon("triangle-exclamation"),
            sprintf("ESM will fit %d bivariate models (%d variables). ", n_pairs, n_vars),
            "Consider reducing to 6-8 variables to keep runtime manageable.")
      },
      if (n_pres > 0 && n_pres < 20) {
        div(class = "alert alert-warning small-padded",
            icon("circle-exclamation"),
            sprintf("Only %d occurrence records — ESM validation is unreliable below ~20 records. ", n_pres),
            "Consider GLM or MaxNet for small samples.")
      },
      if (n_vars > 0) {
        div(class = "small-muted",
            sprintf("ESM will fit %d bivariate models.", n_pairs))
      }
    )
  })

  output$maxnet_install_hint <- renderUI({
    if (!requireNamespace("maxnet", quietly = TRUE)) {
      div(class = "small-muted",
          "MaxEnt unavailable. Install with: ",
          tags$code("install.packages('maxnet')"),
          " then restart the app.")
    }
  })

  output$biomod2_install_hint <- renderUI({
    selected_is_biomod2 <- identical(input$model_id, "biomod2")
    if (!selected_is_biomod2) return(NULL)
    if (!isTRUE(getOption("sdm.enable_biomod2")) || !requireNamespace("biomod2", quietly = TRUE)) {
      div(class = "alert alert-warning small-padded",
          icon("triangle-exclamation"),
          strong("biomod2 not enabled/installed. "),
          "Enable with: ",
          tags$code("options(sdm.enable_biomod2 = TRUE)"),
          " then restart the app.")
    }
  })

  output$multi_ensemble_validation <- renderUI({
    req(input$model_id == "multi_ensemble")
    total_models <- length(input$multi_ensemble_standalone %||% character(0)) +
                    length(input$multi_ensemble_biomod2 %||% character(0))
    biomod2_enabled <- isTRUE(getOption("sdm.enable_biomod2")) && requireNamespace("biomod2", quietly = TRUE)
    biomod2_selected <- length(input$multi_ensemble_biomod2 %||% character(0)) > 0
    tags$div(
      if (!biomod2_enabled && biomod2_selected) {
        div(class = "alert alert-warning small-padded",
            icon("triangle-exclamation"),
            strong("biomod2 not enabled. "),
            "Set ",
            tags$code("options(sdm.enable_biomod2 = TRUE)"),
            " before using biomod2 algorithms in ensemble.")
      },
      if (total_models < 2) {
        div(class = "ensemble-error",
          "Select at least 2 models to run the ensemble.")
      } else {
        div(class = "ensemble-ready",
          paste("Ensemble of", total_models, "model(s) ready."))
      }
    )
  })

  output$status_banner <- renderUI({
    attrs <- list(role = "status", `aria-live` = "polite")
    if (isTRUE(rv$running)) do.call(div, c(attrs, list(class = "status-warn", strong("Running model... "), "Large rasters/downloads can take several minutes.")))
    else if (!is.null(rv$error)) do.call(div, c(attrs, list(class = "status-error", strong("Run failed: "), rv$error)))
    else if (!is.null(rv$result)) do.call(div, c(attrs, list(class = "status-ok", strong("Run complete. "), "Review maps, diagnostics, and downloads below.")))
    else if (isTRUE(readiness()$ready)) do.call(div, c(attrs, list(class = "status-ok", strong("Ready to run. "), "Inputs are available. Review settings, then click Run SDM.")))
    else do.call(div, c(attrs, list(class = "status-warn", strong("Action needed. "), "Resolve required readiness items before running.")))
  })

  output$preflight_panel <- renderUI({
    r <- readiness()
    if (!is.null(rv$result) && is.null(rv$error) && !isTRUE(rv$running)) {
      return(div(class = "content-card preflight-compact", strong("Readiness: "), "Latest run completed. Re-open input sections on the left to adjust settings, then run again."))
    }
    banner <- if (isTRUE(r$ready)) {
      if (length(r$warnings) > 0) div(class = "status-warn", role = "status", `aria-live` = "polite", strong("Ready with warnings: "), paste(r$warnings, collapse = " ")) else div(class = "status-info", role = "status", `aria-live` = "polite", strong("Preflight complete. "), "Required inputs look ready.")
    } else {
      div(class = "status-error", role = "status", `aria-live` = "polite", strong("Required before run: "), paste(unique(r$issues), collapse = " "))
    }
    div(class = "content-card", h4("Run Readiness"), banner, div(class = "readiness-grid", r$items))
  })

  observeEvent(input$run_model, {
    message("SDM: Run SDM button clicked")
    if (isTRUE(rv$running)) {
      message("SDM: Already running, ignoring click")
      return(invisible(NULL))
    }
    rv$error <- NULL; options(sdm_cancelled = FALSE); rv$running <- TRUE; rv$log <- ""
    message("SDM: Starting model run")
    on.exit({ rv$running <- FALSE; message("SDM: Model run finished") }, add = TRUE)
    occurrence <- occurrence_source()
    occurrence_file <- occurrence$path
    if (is.null(occurrence_file)) {
      rv$error <- paste("No observation record file found. Upload a CSV/TSV, add", sdm_default_occurrence_file, "to the project folder, or restore the demo dataset.")
      append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
    }
    if (length(input$biovars) < 2) {
      rv$error <- "Select at least two BIOCLIM variables."
      append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
    }
    if (isTRUE(input$use_soil) && length(input$soil_vars) == 0) {
      rv$error <- "Select at least one SoilGrids variable, or turn soil covariates off."
      append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
    }
    if (isTRUE(input$use_uv) && length(input$uv_vars) == 0 && length(input$uv_months) == 0) {
      rv$error <- "Select at least one UV-B variable or month, or turn UV covariates off."
      append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
    }
    if (isTRUE(input$use_vegetation)) {
      veg_products <- input$veg_products
      if (length(veg_products) == 0) {
        rv$error <- "Select at least one vegetation product, or turn vegetation covariates off."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      has_lai_gpp <- any(c("lai", "gpp") %in% veg_products)
      if (has_lai_gpp && !requireNamespace("rgee", quietly = TRUE)) {
        rv$error <- "LAI/GPP selected but rgee is not installed. Run: install.packages('rgee') and then rgee::ee_initialize()"
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      veg_year_val <- as.integer(input$veg_year)
      current_year <- as.integer(format(Sys.Date(), "%Y"))
      if (is.na(veg_year_val) || veg_year_val < 2000 || veg_year_val > current_year - 1) {
        rv$error <- paste0("Vegetation year must be between 2000 and ", current_year - 1, ".")
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
    }
    if (isTRUE(input$use_hfp)) {
      hfp_year_val <- as.integer(input$hfp_year)
      if (is.na(hfp_year_val) || hfp_year_val < 2001 || hfp_year_val > 2020) {
        rv$error <- "Human Footprint year must be between 2001 and 2020."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
    }
    if (isTRUE(input$use_lulc)) {
      lulc_year_val <- as.integer(input$lulc_year)
      if (is.na(lulc_year_val) || lulc_year_val < 2001 || lulc_year_val > 2023) {
        rv$error <- "LULC year must be between 2001 and 2023."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
    }
    if (isTRUE(input$use_drought) && length(input$drought_periods) == 0) {
      rv$error <- "Select at least one drought period, or turn drought covariates off."
      append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
    }
    projection_extent <- extent_from_inputs(input, rv$cleaned_occurrence)
    species_label <- trimws(input$species %||% "")
    if (!nzchar(species_label)) species_label <- sdm_default_species

    cleaned_occ <- rv$cleaned_occurrence
    if (!is.null(cleaned_occ) && is.null(cleaned_occ$error)) {
      run_overlap <- occurrence_extent_overlap(cleaned_occ$occ, projection_extent)
      if (!is.null(run_overlap) && (run_overlap$count == 0 || run_overlap$percent < 10)) {
        msg <- paste0("NOTE: ", run_overlap$count, " of ", run_overlap$total, " cleaned occurrence records (", fmt_num(run_overlap$percent, 1), "%) fall inside the projection extent. Model will project into ", fmt_num(100 - run_overlap$percent, 1), "% of the extent area with no known presence records.")
        append_log(msg)
      }
    }

    withProgress(message = "Running SDM", value = 0, {
      result <- tryCatch(
        withCallingHandlers(
          run_fast_sdm(
            species = species_label, occurrence_file = occurrence_file, worldclim_dir = input$worldclim_dir,
            selected_biovars = as.integer(input$biovars), projection_extent = projection_extent,
            background_n = input$background_n, min_source_records = input$min_source_records,
            merge_small_sources = isTRUE(input$merge_small_sources) %||% TRUE, thin_by_cell = isTRUE(input$thin_by_cell), model_id = input$model_id,
            include_quadratic = isTRUE(input$quadratic),
            threshold = input$threshold, aggregation_factor = input$aggregation_factor, cv_folds = as.integer(input$cv_folds),
            cv_strategy = input$cv_strategy %||% sdm_default_cv_strategy,
            cv_block_size_km = if (identical(input$cv_strategy, "spatial_blocks")) input$cv_block_size_km else NA_real_,
            n_cores = input$n_cores, allow_download = TRUE, worldclim_res = as.numeric(input$worldclim_res),
            use_elevation = isTRUE(input$use_elevation), elevation_demtype = input$elevation_demtype,
            opentopo_api_key = input$opentopo_api_key,
            use_soil = isTRUE(input$use_soil), selected_soil_vars = input$soil_vars, selected_soil_depths = input$soil_depths,
            use_uv = isTRUE(input$use_uv), selected_uv_vars = input$uv_vars, selected_uv_months = input$uv_months,
            use_vegetation = isTRUE(input$use_vegetation),
            veg_year = as.integer(input$veg_year),
            veg_products = input$veg_products,
            use_lulc = isTRUE(input$use_lulc), lulc_year = as.integer(input$lulc_year),
            use_hfp = isTRUE(input$use_hfp), hfp_year = as.integer(input$hfp_year),
            use_bioclim_season = isTRUE(input$use_bioclim_season),
            use_drought = isTRUE(input$use_drought), selected_drought_periods = input$drought_periods,
            selected_chelsa_extras = if (identical(input$climate_source, "chelsa")) input$chelsa_extras else NULL,
            covariate_cache_dir = sdm_default_covariate_cache_dir,
            vif_reduction = isTRUE(input$vif_reduction) %||% FALSE,
            future_projection = isTRUE(input$future_projection),
            future_worldclim_dir = input$future_worldclim_dir,
            future_label = input$future_label,
            maxnet_features = input$maxnet_features %||% sdm_default_maxnet_features,
            maxnet_regmult = input$maxnet_regmult %||% sdm_default_maxnet_regmult,
            bias_method = input$bias_method %||% "uniform",
            target_group_occ = if (isTRUE(input$bias_method == "target_group") && !is.null(input$target_group_file)) {
              tryCatch(read.csv(input$target_group_file$datapath, header = TRUE), error = function(e) NULL)
            } else NULL,
            thickening_distance_km = if (isTRUE(input$bias_method == "thickened")) input$thickening_distance_km else NULL,
            cleaned_occurrence = rv$cleaned_occurrence,
            use_cc = isTRUE(input$use_coordinatecleaner),
            cc_tests = input$cc_tests %||% "all",
            output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = occurrence$detail,
            gbif_doi = rv$gbif_doi, source = input$climate_source, log_fun = append_log,
            progress_fun = function(p) {
              if (is.list(p) && !is.null(p$detail)) {
                incProgress(p$value - last_progress(), detail = p$detail)
                last_progress(p$value)
              } else {
                incProgress(as.numeric(p))
              }
            },
            multi_ensemble_models = if (identical(input$model_id, "multi_ensemble")) {
              standalone <- input$multi_ensemble_standalone %||% character(0)
              if (length(input$multi_ensemble_biomod2 %||% character(0)) > 0) c(standalone, "biomod2") else standalone
            } else NULL,
            multi_ensemble_weighting = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_weighting %||% "auc" else "auc",
            multi_ensemble_power = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_power %||% sdm_default_ensemble_power else sdm_default_ensemble_power,
            multi_ensemble_min_auc = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_min_auc %||% sdm_default_ensemble_min_auc else sdm_default_ensemble_min_auc,
            multi_ensemble_min_tss = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_min_tss %||% sdm_default_ensemble_min_tss else sdm_default_ensemble_min_tss,
            multi_ensemble_export = isTRUE(input$multi_ensemble_export),
            biomod2_models = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_biomod2 %||% NULL else NULL,
            esm_n_runs = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_n_runs %||% sdm_esm_default_n_runs else sdm_esm_default_n_runs,
            esm_split = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_split %||% sdm_esm_default_split else sdm_esm_default_split,
            esm_min_auc = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_min_auc %||% sdm_esm_default_min_auc else sdm_esm_default_min_auc,
            esm_power = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_power %||% sdm_esm_default_power else sdm_esm_default_power,
            overlap_warn = !is.null(run_overlap) && (run_overlap$count == 0 || run_overlap$percent < 10)
          ),
          warning = function(w) { append_log(paste("Warning:", conditionMessage(w))); invokeRestart("muffleWarning") }
        ),
        error = function(e) { rv$error <- conditionMessage(e); append_log(paste("ERROR:", conditionMessage(e))); NULL }
      )
      if (!is.null(result)) rv$result <- result
    })
  })

  output$metric_cards <- renderUI({
    r <- rv$result
    if (is.null(r)) return(div(class = "metric-grid", metric_card("Observation records", "-", "waiting for run"), metric_card("Covariates", "-", "waiting for run"), metric_card("AUC", "-", "cross-validation"), metric_card("High-suitability area", "-", "km2 above threshold")))
    div(class = "metric-grid", metric_card("Observation records used", fmt_num(r$metrics$presence_records), "after cleaning/thinning"), metric_card("Model", r$config$model_label %||% "GLM", "backend"), metric_card("CV AUC", fmt_num(r$metrics$auc_mean, 3), paste0(r$metrics$cv_folds, " folds; ", r$metrics$n_cores, " cores")), metric_card("High-suitability area", fmt_num(r$summary$high_risk_area_km2), "km2 above threshold"))
  })

  output$suitability_plot <- renderPlot({ if (is.null(rv$result)) return(placeholder_plot("No suitability map yet.")); r <- rv$result; plot_suitability_map(r$suitability, r$occurrence, r$config$projection_extent, r$config$species, r$config$threshold, TRUE) })

  output$suitability_map_ui <- renderUI({
    if (is.null(rv$result) || is.null(rv$result$paths$tif) || !file.exists(rv$result$paths$tif)) {
      return(div(class = "content-card map-card",
        div(class = "map-title-row", h4("Current suitability"), span("Interactive map view")),
        plotOutput("suitability_placeholder", height = "56vh")
      ))
    }
    leafletOutput("suitability_map", height = "56vh")
  })

  output$suitability_map <- renderLeaflet({
    req(rv$result)
    r <- rv$result
    req(file.exists(r$paths$tif), "Output TIFF not found")

    map <- render_suitability_leaflet(
      suitability_raster = terra::rast(r$paths$tif),
      presence_df = r$occurrence_used %||% r$occurrence,
      background_df = r$background_used %||% NULL,
      mess_raster = if (!is.null(r$mess)) terra::rast(r$mess) else NULL,
      threshold = r$config$threshold %||% 0.5,
      show_mess = isTRUE(input$show_mess)
    )

    if (!isTRUE(input$show_presence)) {
      map <- leaflet::hideGroup(map, "presence")
    }
    if (!isTRUE(input$show_background)) {
      map <- leaflet::hideGroup(map, "background")
    }

    map
  })

  output$suitability_placeholder <- renderPlot({
    placeholder_plot("No suitability map yet. Configure options on the left, then click Run SDM.")
  })

  observeEvent(input$show_mess, {
    req(rv$result)
    r <- rv$result
    map <- leaflet::leafletProxy("suitability_map")
    if (isTRUE(input$show_mess)) {
      mess_src <- tryCatch(terra::sources(r$mess), error = function(e) NULL)
      if (!is.null(r$mess) && !is.null(mess_src) && length(mess_src) > 0 && any(nzchar(mess_src))) {
        mess_raster <- terra::rast(r$mess)
        r_mess <- tryCatch(terra::project(mess_raster, "EPSG:4326"),
                           error = function(e) { showNotification(paste("MESS projection failed:", e$message), type = "warning"); NULL })
        if (is.null(r_mess)) {
          updateCheckboxInput(session, "show_mess", value = FALSE)
          return()
        }
        mess_binary <- r_mess
        terra::values(mess_binary) <- ifelse(terra::values(r_mess) < 0, 1, 0)
        map <- map %>%
          leaflet::addRasterImage(mess_binary, opacity = 0.5, layerId = "mess",
                                  project = FALSE, colors = "red") %>%
          leaflet::addLegend(position = "bottomright", colors = "red",
                              labels = "Extrapolation (MESS<0)", title = "MESS")
      } else {
        showNotification("No MESS layer available for this model run.", type = "message")
        updateCheckboxInput(session, "show_mess", value = FALSE)
      }
    } else {
      if (!is.null(map$dependencies)) {
        map <- map %>% leaflet::removeImages(layerId = "mess")
      }
    }
  })

  observeEvent(input$show_presence, {
    req(rv$result)
    map <- leaflet::leafletProxy("suitability_map")
    if (isTRUE(input$show_presence)) {
      map <- leaflet::showGroup(map, "presence")
    } else {
      map <- leaflet::hideGroup(map, "presence")
    }
  })

  observeEvent(input$show_background, {
    req(rv$result)
    map <- leaflet::leafletProxy("suitability_map")
    if (isTRUE(input$show_background)) {
      map <- leaflet::showGroup(map, "background")
    } else {
      map <- leaflet::hideGroup(map, "background")
    }
  })

  observeEvent(list(input$suitability_display, input$threshold), {
    req(rv$result)
    r <- rv$result
    map <- leaflet::leafletProxy("suitability_map") %>% leaflet::removeImages(layerId = "suitability")

    if (isTRUE(input$suitability_display == "binary")) {
      r_wgs84 <- terra::project(terra::rast(r$paths$tif), "EPSG:4326")
      r_bin <- r_wgs84
      terra::values(r_bin) <- ifelse(terra::values(r_wgs84) >= input$threshold, 1, 0)
      colors <- c("#FFFFFF00", "#E34B35")
      map <- map %>% leaflet::addRasterImage(r_bin, opacity = 0.6,
                                              layerId = "suitability",
                                              project = FALSE, colors = colors)
    } else {
      r_wgs84 <- terra::project(terra::rast(r$paths$tif), "EPSG:4326")
      cols <- grDevices::colorRampPalette(c("#0A1624", "#123247", "#15545D",
                                           "#1F8A70", "#59C174", "#C6D65B",
                                           "#F3C45A", "#F28A3C", "#E34B35", "#A51E3B"))(180)
      map <- map %>% leaflet::addRasterImage(r_wgs84, opacity = 0.7,
                                              layerId = "suitability", colors = cols, project = TRUE)
    }
  })
  output$future_plot <- renderPlot({ if (is.null(rv$result) || is.null(rv$result$future)) return(placeholder_plot("Run with future projection enabled to view a future suitability map.")); r <- rv$result; plot_suitability_map(r$future$suitability, r$occurrence, r$config$projection_extent, paste(r$config$species, r$config$future_label), r$config$threshold, TRUE) })
  output$delta_plot <- renderPlot({ if (is.null(rv$result) || is.null(rv$result$future)) return(placeholder_plot("Run with future projection enabled to view current-to-future change.")); plot_delta_map(rv$result$future$delta, rv$result$config$future_label) })
  output$summary_panel <- renderUI({
    r <- rv$result
    if (is.null(r)) return(div(class = "small-muted", "No model has been run yet."))
    row <- function(label, value) div(class = "summary-row", div(class = "summary-label", label), div(class = "summary-value", value))
    div(class = "summary-list",
      row("Model backend", r$config$model_label %||% "GLM"),
      row("Mean suitability", fmt_num(r$summary$mean, 3)),
      row("Median suitability", fmt_num(r$summary$median, 3)),
      row("Maximum suitability", fmt_num(r$summary$max, 3)),
      row("Cells above threshold", paste0(fmt_num(r$summary$cells_above_threshold), " (", fmt_num(r$summary$percent_above_threshold, 1), "%)")),
      row("High-suitability area", paste(fmt_num(r$summary$high_risk_area_km2), "km2")),
      row("Observation source", r$config$occurrence_source),
      row("Observation file", r$config$occurrence_file),
      row("Covariates", paste(r$environment$names, collapse = ", ")),
      row("CPU cores used", r$metrics$n_cores),
      row("Elapsed time", paste(fmt_num(r$metrics$elapsed_seconds, 1), "sec")),
      row("Output TIFF", r$paths$tif),
      if (!is.null(r$future)) row("Future scenario", r$config$future_label %||% "Future climate"),
      if (!is.null(r$future)) row("Future mean suitability", fmt_num(r$future$summary$mean, 3)),
      if (!is.null(r$future)) row("Future output TIFF", r$paths$future_tif %||% "not available"),
      if (!is.null(r$future)) row("Delta output TIFF", r$paths$delta_tif %||% "not available")
    )
  })
  output$source_table <- renderTable({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df) || is.null(co$source_counts)) {
      return(data.frame(Message = "Load occurrence data to view source counts."))
    }
    sc <- co$source_counts
    head(data.frame(Source = names(sc), Records = as.integer(sc), row.names = NULL), 25)
  }, striped = TRUE, hover = TRUE, spacing = "s")

  output$absent_excluded_log <- renderText({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df)) return("")
    n_absent <- co$n_absent_excluded %||% 0L
    n_raw <- co$original_rows %||% NA_integer_
    if (n_absent == 0L) return("")
    sprintf("ABSENT records excluded from analysis: %s of %s total",
            format(n_absent, big.mark = ","), format(n_raw, big.mark = ","))
  })

  marker_colors <- function(cc_flag) {
    ifelse(is.na(cc_flag) | cc_flag == FALSE, "blue", "red")
  }

  output$occurrence_cleaning_map <- renderLeaflet({
    req(rv$cleaned_occurrence)
    leaflet::leaflet() %>% leaflet::addTiles()
  })

  observeEvent(rv$cleaned_occurrence$df, {
    req(input$occurrence_cleaning_map)
    occ <- rv$cleaned_occurrence$df
    if (!is.data.frame(occ) || nrow(occ) < 1) {
      leaflet::leafletProxy("occurrence_cleaning_map") %>% leaflet::clearMarkers()
      return()
    }

    colors <- marker_colors(occ$cc_flag)
    species_col <- if ("species" %in% names(occ)) occ$species else "N/A"
    source_col <- occ$source
    row_nums <- seq_len(nrow(occ))
    popups <- paste0("Row ", row_nums, "<br>",
                      "Species: ", species_col, "<br>",
                      "Source: ", source_col)

    leaflet::leafletProxy("occurrence_cleaning_map") %>%
      leaflet::clearMarkers() %>%
      leaflet::addCircleMarkers(
        lng = occ$longitude, lat = occ$latitude,
        color = colors,
        fillOpacity = 0.7,
        radius = 5,
        layerId = row_nums,
        popup = popups
      )
  }, ignoreInit = TRUE)

  observeEvent(input$occurrence_cleaning_map_marker_click, {
    req(rv$cleaned_occurrence)

    click <- input$occurrence_cleaning_map_marker_click
    row_idx <- as.integer(click$id)

    if (is.na(row_idx) || row_idx < 1 || row_idx > nrow(rv$cleaned_occurrence$df)) {
      return()
    }
    current_flag <- rv$cleaned_occurrence$df$cc_flag[row_idx]
    rv$cleaned_occurrence$df$cc_flag[row_idx] <- !current_flag
    rv$cleaned_occurrence$df <- rv$cleaned_occurrence$df
  })

  observeEvent(input$remove_flagged_map, {
    req(rv$cleaned_occurrence)

    keep <- is.na(rv$cleaned_occurrence$df$cc_flag) | rv$cleaned_occurrence$df$cc_flag == FALSE
    new_df <- rv$cleaned_occurrence$df[keep, , drop = FALSE]

    rv$cleaned_occurrence <- list(
      df = new_df,
      source_counts = rv$cleaned_occurrence$source_counts,
      n_absent_excluded = rv$cleaned_occurrence$n_absent_excluded,
      original_rows = rv$cleaned_occurrence$original_rows
    )
  })

  observeEvent(input$clear_flags, {
    req(rv$cleaned_occurrence)

    rv$cleaned_occurrence$df$cc_flag <- FALSE
    rv$cleaned_occurrence$df <- rv$cleaned_occurrence$df
  })

  output$cc_stats_log <- renderText({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df) || is.null(co$df$cc_flag)) {
      return("Advanced cleaning not enabled or CoordinateCleaner not available.")
    }
    n_total <- nrow(co$df)
    n_flagged <- sum(co$df$cc_flag, na.rm = TRUE)
    pct <- if (n_total > 0) paste0(" (", round(100 * n_flagged / n_total, 1), "%)") else ""

    lines <- c(
      "CoordinateCleaner Results:",
      paste0("  Total records: ", format(n_total, big.mark = ",")),
      paste0("  Flagged: ", format(n_flagged, big.mark = ","), pct),
      "  By test:"
    )

    test_names <- c(
      cc_test_sea = "Sea coordinates",
      cc_test_capitals = "Capital cities",
      cc_test_centroids = "Country centroids",
      cc_test_institutions = "Biodiversity institutions",
      cc_test_urban = "Urban areas",
      cc_test_zero = "Zero coordinates"
    )

    for (nm in names(test_names)) {
      if (nm %in% names(co)) {
        n <- sum(co[[nm]], na.rm = TRUE)
        lines <- c(lines, paste0("    ", test_names[nm], ": ", format(n, big.mark = ",")))
      }
    }

    paste(lines, collapse = "\n")
  })
  output$coef_table <- renderTable({
    r <- rv$result
    if (is.null(r)) return(data.frame(Message = "Run the model to view diagnostics."))
    co <- r$coefficients
    if (is.null(co) || length(co) == 0) return(data.frame(Message = paste(r$config$model_label %||% "This backend", "does not produce GLM-style coefficients.")))
    co <- as.data.frame(co)
    numeric_cols <- vapply(co, is.numeric, logical(1))
    co[numeric_cols] <- lapply(co[numeric_cols], function(x) signif(x, 4))
    co
  }, striped = TRUE, hover = TRUE, spacing = "s")
  output$dwca_issues_panel <- renderUI({
    r <- rv$result
    if (is.null(r) || is.null(r$dwca_issues) || nrow(r$dwca_issues) == 0) return(NULL)
    issues <- r$dwca_issues
    if (!is.data.frame(issues) || nrow(issues) == 0) return(NULL)
    tags$div(
      h4("GBIF quality flags"),
      tags$small(class = "small-muted", "Records with GBIF-assigned quality issues. Review and optionally exclude before modelling."),
      br(),
      DT::dataTableOutput("gbif_issues_table"),
      actionButton("exclude_flagged", "Exclude flagged records", class = "btn-warning btn-sm")
    )
  })

  output$gbif_issues_table <- DT::renderDataTable({
    r <- rv$result
    if (is.null(r) || is.null(r$dwca_issues) || nrow(r$dwca_issues) == 0) {
      return(DT::datatable(data.frame(Message = "No GBIF quality flags"), options = list(dom = "t")))
    }
    issues <- r$dwca_issues
    cols_needed <- c("x", "y", "species", "issue_flags")
    cols_present <- cols_needed[cols_needed %in% names(issues)]
    if (length(cols_present) == 0) {
      return(DT::datatable(data.frame(Message = "No GBIF quality flags"), options = list(dom = "t")))
    }
    display_df <- issues[, cols_present, drop = FALSE]
    names(display_df) <- ifelse(names(display_df) == "x", "longitude", ifelse(names(display_df) == "y", "latitude", names(display_df)))
    if ("issue_flags" %in% names(display_df)) {
      critical <- c("ZERO_COORDINATE", "COORDINATE_OUT_OF_RANGE", "COUNTRY_COORDINATE_MISMATCH", "COORDINATE_INVALID")
      flag_colors <- ifelse(display_df$issue_flags %in% critical, "#8c1d18", "#66768a")
      display_df$issue_flags <- sapply(seq_len(nrow(display_df)), function(i) {
        span(display_df$issue_flags[i], style = paste0("color:", flag_colors[i], ";font-weight:700;"))
      })
    }
    DT::datatable(display_df, options = list(dom = "t", pageLength = 10), rownames = FALSE, escape = FALSE)
  })

  observeEvent(input$exclude_flagged, {
    showModal(modalDialog(
      title = "Confirm exclusion",
      "This will remove all records with GBIF quality flags from the current result. Continue?",
      footer = tagList(
        actionButton("confirm_exclude_yes", "Yes, exclude flagged records"),
        modalButton("Cancel")
      ),
      easyClose = FALSE
    ))
  })
  observeEvent(input$confirm_exclude_yes, {
    removeModal()
    r <- rv$result
    if (!is.null(r) && !is.null(r$dwca_issues) && nrow(r$dwca_issues) > 0) {
      issues_flagged <- r$dwca_issues
      if ("x" %in% names(issues_flagged) && "y" %in% names(issues_flagged)) {
        flagged_coords <- paste(issues_flagged$x, issues_flagged$y, sep = "_")
        if (!is.null(rv$cleaned_occurrence)) {
          occ_coords <- paste(rv$cleaned_occurrence$df$longitude, rv$cleaned_occurrence$df$latitude, sep = "_")
          rv$cleaned_occurrence$df <- rv$cleaned_occurrence$df[!occ_coords %in% flagged_coords, , drop = FALSE]
          append_log(paste0("Excluded ", length(flagged_coords), " GBIF-flagged records from current result."))
        }
      }
    }
  })

  output$ensemble_weights_panel <- renderUI({
    r <- rv$result
    if (is.null(r) || is.null(r$cv$component_metrics)) return(NULL)
    if (!identical(r$config$model_id, "multi_ensemble")) return(NULL)
    metrics <- r$cv$component_metrics
    if (is.null(metrics) || nrow(metrics) == 0) return(NULL)
    excluded <- r$ensemble_config$models_excluded
    div(class = "content-card",
      h4("Ensemble weights"),
      if (length(excluded) > 0) {
        div(class = "small-muted mb-sm",
          "Models excluded (below threshold): ", paste(excluded, collapse = ", "))
      },
      tableOutput("ensemble_weights_table"),
      tags$small(class = "small-muted", "Weights are normalised to sum to 1. Higher power gives more emphasis to better-performing models.")
    )
  })
  output$ensemble_weights_table <- renderTable({
    r <- rv$result
    if (is.null(r) || is.null(r$cv$component_metrics)) return(data.frame())
    metrics <- r$cv$component_metrics
    if (nrow(metrics) == 0) return(data.frame())
    w <- metrics
    w$auc_mean <- sprintf("%.3f", w$auc_mean)
    w$tss_mean <- sprintf("%.3f", w$tss_mean)
    w$weight <- sprintf("%.3f", w$weight)
    colnames(w) <- c("Model", "Method", "AUC (CV)", "TSS (CV)", "Weight")
    w
  }, striped = TRUE, hover = TRUE, spacing = "s")

  output$esm_diagnostics_panel <- renderUI({
    r <- rv$result
    if (is.null(r) || is.null(r$esm_config)) return(NULL)
    esm <- r$esm_config
    n_vars <- esm$n_vars
    n_total <- esm$n_pairs_total
    n_used  <- esm$n_pairs_used
    n_drop  <- esm$n_pairs_dropped
    min_auc <- esm$min_auc
    algo    <- esm$algorithm

    tagList(
      div(class = "content-card",
        h4("ESM bivariate models"),
        div(sprintf("%d of %d bivariate models kept (AUC >= %.2f); %d dropped.",
                    n_used, n_total, min_auc, n_drop)),
        tags$small(class = "small-muted",
          sprintf("Algorithm: %s | Variables: %d | Runs: %d | Split: %d%%",
                  algo, n_vars, esm$n_runs, esm$data_split))
      ),
      div(class = "content-card",
        h4("ESM bivariate pair weights"),
        plotOutput("esm_pair_heatmap", height = "auto"),
        tags$small(class = "small-muted",
          "Symmetric matrix: cell [i,j] shows the weight of the (variable_i, variable_j) bivariate model. Higher weight = more informative for prediction.")
      ),
      div(class = "content-card",
        h4("ESM variable importance"),
        plotOutput("esm_var_importance", height = "auto"),
        tags$small(class = "small-muted",
          "Importance = mean weight of all pairs containing each variable, normalised to 0-1.")
      )
    )
  })

  output$esm_pair_heatmap <- renderPlot({
    r <- rv$result
    if (is.null(r) || is.null(r$esm_config)) return(NULL)
    p <- plot_esm_pair_heatmap(r)
    if (is.null(p)) {
      plot.new(); title("ggplot2 not available")
    } else {
      print(p)
    }
  }, height = function() {
    n <- length(rv$result$esm_config$covariates %||% seq_len(6))
    max(200, min(n * 60, 600))
  })

  output$esm_var_importance <- renderPlot({
    r <- rv$result
    if (is.null(r) || is.null(r$variable_importance)) return(NULL)
    imp <- r$variable_importance
    if (!is.data.frame(imp) || nrow(imp) == 0) return(NULL)
    imp <- imp[order(imp$importance, decreasing = TRUE), ]
    if (!requireNamespace("ggplot2", quietly = TRUE)) {
      plot.new(); title("ggplot2 not available"); return(NULL)
    }
    p <- ggplot2::ggplot(imp, ggplot2::aes(x = ggplot2::reorder(variable, importance), y = importance)) +
      ggplot2::geom_col(fill = "#2166ac", width = 0.7) +
      ggplot2::coord_flip() +
      ggplot2::scale_y_continuous(limits = c(0, 1), expand = c(0, 0.02)) +
      ggplot2:: labs(x = NULL, y = "Relative importance") +
      ggplot2::theme_minimal(base_size = 11) +
      ggplot2::theme(panel.grid.major.y = ggplot2::element_blank())
    print(p)
  }, height = function() {
    n <- nrow(rv$result$variable_importance %||% data.frame(variable = character(0)))
    max(150, min(n * 35, 500))
  })

  output$run_log <- renderText(rv$log)

  collect_sidecar_paths <- function(result) {
    sidecars <- unlist(result$paths[c("glm_tif", "rangebag_tif", "disagreement_tif", "future_tif", "delta_tif")], use.names = FALSE)
    multi_ens_keys <- grep("^multi_ens_comp_|^multi_ens_(mean|median|committee|sd)_tif$", names(result$paths), value = TRUE)
    if (length(multi_ens_keys) > 0) sidecars <- c(sidecars, unlist(result$paths[multi_ens_keys], use.names = FALSE))
    sidecars[!is.na(sidecars) & nzchar(sidecars) & file.exists(sidecars)]
  }

  output$sidecar_download_note <- renderUI({
    r <- rv$result
    if (is.null(r)) return(NULL)
    sidecars <- collect_sidecar_paths(r)
    if (length(sidecars) == 0) return(p(class = "small-muted", "No model sidecar rasters were produced for this run."))
    tags$ul(class = "small-muted", lapply(sidecars, function(path) tags$li(basename(path))))
  })
  output$future_tif_download_ui <- renderUI({
    r <- rv$result
    if (is.null(r) || is.null(r$paths$future_tif) || !file.exists(r$paths$future_tif)) return(NULL)
    downloadButton("download_future_tif", "Download future GeoTIFF")
  })
  output$delta_tif_download_ui <- renderUI({
    r <- rv$result
    if (is.null(r) || is.null(r$paths$delta_tif) || !file.exists(r$paths$delta_tif)) return(NULL)
    downloadButton("download_delta_tif", "Download delta GeoTIFF")
  })
  output$ensemble_downloads_ui <- renderUI({
    r <- rv$result
    if (is.null(r) || is.null(r$paths)) return(NULL)
    ens_keys <- grep("^multi_ens_(mean|median|committee|sd)_tif$", names(r$paths), value = TRUE)
    ens_files <- ens_keys[!is.na(r$paths[ens_keys]) & nzchar(r$paths[ens_keys]) & sapply(r$paths[ens_keys], file.exists)]
    if (length(ens_files) == 0) return(NULL)
    div(class = "content-card mt-sm",
      h4("Ensemble rasters"),
      p(class = "small-muted", "Individual ensemble strategy outputs."),
      div(class = "downloads-row",
        lapply(names(ens_files), function(key) {
          label <- switch(key,
            "multi_ens_mean_tif" = "Mean",
            "multi_ens_median_tif" = "Median",
            "multi_ens_committee_tif" = "Committee",
            "multi_ens_sd_tif" = "SD (uncertainty)",
            basename(r$paths[[key]])
          )
          downloadButton(paste0("download_", key), paste("Download", label))
        })
      )
    )
  })

  output$download_tif <- downloadHandler(filename = function() { req(rv$result); basename(rv$result$paths$tif) }, content = function(file) { req(rv$result, file.exists(rv$result$paths$tif)); file.copy(rv$result$paths$tif, file, overwrite = TRUE) })
  output$download_png <- downloadHandler(filename = function() { req(rv$result); basename(rv$result$paths$png) }, content = function(file) { req(rv$result, file.exists(rv$result$paths$png)); file.copy(rv$result$paths$png, file, overwrite = TRUE) })
  output$download_future_tif <- downloadHandler(filename = function() { req(rv$result, rv$result$paths$future_tif); basename(rv$result$paths$future_tif) }, content = function(file) { req(rv$result, rv$result$paths$future_tif, file.exists(rv$result$paths$future_tif)); file.copy(rv$result$paths$future_tif, file, overwrite = TRUE) })
  output$download_delta_tif <- downloadHandler(filename = function() { req(rv$result, rv$result$paths$delta_tif); basename(rv$result$paths$delta_tif) }, content = function(file) { req(rv$result, rv$result$paths$delta_tif, file.exists(rv$result$paths$delta_tif)); file.copy(rv$result$paths$delta_tif, file, overwrite = TRUE) })
  output$download_occ <- downloadHandler(filename = function() { req(rv$result); paste0(safe_slug(rv$result$config$species), "_cleaned_occurrences.csv") }, content = function(file) { req(rv$result); utils::write.csv(rv$result$occurrence, file, row.names = FALSE) })
  output$download_report <- downloadHandler(filename = function() { req(rv$result); paste0(safe_slug(rv$result$config$species), "_sdm_report.txt") }, content = function(file) { req(rv$result); write_summary_report(rv$result, file) })
  output$download_odmap_csv <- downloadHandler(filename = function() { req(rv$result); paste0(safe_slug(rv$result$config$species), "_odmap_report.csv") }, content = function(file) { req(rv$result); write_odmap_report(rv$result, file) })
  output$download_odmap_md <- downloadHandler(filename = function() { req(rv$result); paste0(safe_slug(rv$result$config$species), "_odmap_report.md") }, content = function(file) { req(rv$result); path_csv <- sub("\\.md$", ".csv", file); write_odmap_report(rv$result, path_csv, file) })
  output$download_sidecars <- downloadHandler(
    filename = function() { req(rv$result); paste0(safe_slug(rv$result$config$species), "_model_sidecars.zip") },
    content = function(file) {
      req(rv$result)
      sidecars <- collect_sidecar_paths(rv$result)
      validate(need(length(sidecars) > 0, "No sidecar rasters are available for this run."))
      oldwd <- getwd()
      on.exit(setwd(oldwd), add = TRUE)
      setwd(dirname(sidecars[1]))
      utils::zip(file, files = basename(sidecars))
    }
  )
  output$download_multi_ens_mean_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_mean_tif); basename(r$paths$multi_ens_mean_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_mean_tif, file.exists(r$paths$multi_ens_mean_tif)); file.copy(r$paths$multi_ens_mean_tif, file, overwrite = TRUE) })
  output$download_multi_ens_median_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_median_tif); basename(r$paths$multi_ens_median_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_median_tif, file.exists(r$paths$multi_ens_median_tif)); file.copy(r$paths$multi_ens_median_tif, file, overwrite = TRUE) })
  output$download_multi_ens_committee_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_committee_tif); basename(r$paths$multi_ens_committee_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_committee_tif, file.exists(r$paths$multi_ens_committee_tif)); file.copy(r$paths$multi_ens_committee_tif, file, overwrite = TRUE) })
  output$download_multi_ens_sd_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_sd_tif); basename(r$paths$multi_ens_sd_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_sd_tif, file.exists(r$paths$multi_ens_sd_tif)); file.copy(r$paths$multi_ens_sd_tif, file, overwrite = TRUE) })

  # -------------------------------------------------------------------------
  # Get Data tab: output renderers
  # -------------------------------------------------------------------------
  output$get_data_content <- renderUI({ get_data_tab() })

gd_append_log <- function(target, msg) {
    cur <- rv[[target]] %||% ""
    rv[[target]] <- paste0(cur, format(Sys.time(), "%H:%M:%S"), " ", msg, "\n")
  }

  # -------------------------------------------------------------------------
  # Get Data tab: status dot output renderers + suspendWhenHidden
  # -------------------------------------------------------------------------
  gd_status_dots <- function(v) {
    cls <- switch(v$status, ok = "status-ok", warn = "status-warn", error = "status-error", "status-unknown")
    span(class = paste("status-dot", cls), title = v$detail)
  }

  output$gd_worldclim_log <- renderText(rv$gd_worldclim_log %||% "")
  output$gd_cmip6_log <- renderText(rv$gd_cmip6_log %||% "")
  output$gd_terrain_log <- renderText(rv$gd_terrain_log %||% "")
  output$gd_env_log <- renderText(rv$gd_env_log %||% "")

  output$gd_worldclim_status <- renderUI({
    v <- verify_worldclim_cache("Worldclim", source = input$gd_climate_source %||% "worldclim")
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_worldclim_status", suspendWhenHidden = FALSE)

  output$gd_chelsa_status <- renderUI({
    v <- verify_chelsa_extras_cache("Worldclim")
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_chelsa_status", suspendWhenHidden = FALSE)

  output$gd_cmip6_scenarios <- renderUI({
    v <- rv$cmip6_scenarios
    if (is.null(v) || v$status != "ok" || nrow(v$scenarios) == 0) {
      return(p("No CMIP6 scenarios downloaded yet."))
    }
    rows <- lapply(seq_len(nrow(v$scenarios)), function(i) {
      r <- v$scenarios[i, ]
      div(
        class = "scenario-row",
        strong(r$GCM), " / ", r$SSP, " / ", r$Period,
        span(class = "scenario-meta", paste0(r$Files, " files, ", r$SizeMB, " MB"))
      )
    })
    tagList(
      div(class = "text-sm", rows)
    )
  })
  outputOptions(output, "gd_cmip6_scenarios", suspendWhenHidden = FALSE)

  observe({
    rv$cmip6_scenarios <- verify_future_cache()
  }, ignoreInit = TRUE)

  output$gd_elevation_status <- renderUI({
    v <- verify_elevation_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_elevation_status", suspendWhenHidden = FALSE)

  output$gd_soil_status <- renderUI({
    v <- verify_soil_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_soil_status", suspendWhenHidden = FALSE)

  output$gd_uv_status <- renderUI({
    v <- verify_uv_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_uv_status", suspendWhenHidden = FALSE)

  output$gd_vegetation_status <- renderUI({
    v <- verify_vegetation_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_vegetation_status", suspendWhenHidden = FALSE)

  output$gd_lulc_status <- renderUI({
    v <- verify_lulc_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_lulc_status", suspendWhenHidden = FALSE)

  output$gd_hfp_status <- renderUI({
    v <- verify_hfp_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_hfp_status", suspendWhenHidden = FALSE)

  output$gd_drought_status <- renderUI({
    v <- verify_drought_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_drought_status", suspendWhenHidden = FALSE)

  output$gd_bioclime_status <- renderUI({
    v <- verify_bioclim_season_cache()
    tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
  })
  outputOptions(output, "gd_bioclime_status", suspendWhenHidden = FALSE)

  output$gd_cache_summary <- renderUI({
    s <- get_data_summary()
    tags$ul(class = "small-muted pl-sm",
      tags$li(paste("WorldClim:", s$worldclim$detail)),
      tags$li(paste("CHELSA extras:", s$chelsa_extras$detail)),
      tags$li(paste("CMIP6 futures:", s$future$detail)),
      tags$li(paste("Elevation:", s$elevation$detail)),
      tags$li(paste("Soil:", s$soil$detail)),
      tags$li(paste("UV-B:", s$uv$detail)),
      tags$li(paste("Vegetation:", s$vegetation$detail)),
      tags$li(paste("LULC:", s$lulc$detail)),
      tags$li(paste("HFP:", s$hfp$detail)),
      tags$li(paste("Drought:", s$drought$detail)),
      tags$li(paste("Bioclim season:", s$bioclim_season$detail))
    )
  })
  outputOptions(output, "gd_cache_summary", suspendWhenHidden = FALSE)

  output$gd_cache_size <- renderUI({
    s <- get_data_summary()
    p(class = "small-muted", paste("Total covariate cache:", round(s$total_covariates_mb, 1), "MB"))
  })
  outputOptions(output, "gd_cache_size", suspendWhenHidden = FALSE)

  # -------------------------------------------------------------------------
  # Get Data tab: download button handlers
  # -------------------------------------------------------------------------

  observeEvent(input$gd_verify_worldclim, {
    gd_append_log("gd_worldclim_log", "Verifying WorldClim files...")
    v <- verify_worldclim_cache("Worldclim", source = input$gd_climate_source %||% "worldclim")
    gd_append_log("gd_worldclim_log", v$detail)
    if (v$size_mb > 0) gd_append_log("gd_worldclim_log", paste("Cache size:", round(v$size_mb, 1), "MB"))
  })

  observeEvent(input$gd_download_worldclim, {
    source <- input$gd_climate_source %||% "worldclim"
    res <- as.integer(input$gd_worldclim_res %||% 10)
    gd_append_log("gd_worldclim_log", paste0("Starting WorldClim download (source=", source, ", res=", res, ")..."))
    download_covariate_bg(
      log_target = "gd_worldclim_log", log_append = gd_append_log,
      label = "WorldClim",
      download_fun = function() {
        source(file.path(sdm_project_root(), "R", "covariates_climate.R"))
        load_climate_covariates(
          worldclim_dir = "Worldclim", selected_biovars = 1:19,
          training_extent = NULL, projection_extent = NULL, aggregation_factor = 1,
          allow_download = TRUE, worldclim_res = res, source = "worldclim",
          selected_chelsa_extras = NULL, log_fun = function(...) message(paste(...))
        )
        message("WorldClim download complete.")
      },
      verify_fun = function() verify_worldclim_cache("Worldclim", source = source),
      timeout_sec = 300,
      notification_msg = paste0("WorldClim downloaded to ", file.path(sdm_project_root(), "Worldclim"))
    )
  })

  observeEvent(input$gd_download_chelsa, {
    extras <- c(
      if (isTRUE(input$gd_chelsa_gdd5)) "gdd5",
      if (isTRUE(input$gd_chelsa_gdd10)) "gdd10",
      if (isTRUE(input$gd_chelsa_gsl)) "gsl",
      if (isTRUE(input$gd_chelsa_fcf)) "fcf",
      if (isTRUE(input$gd_chelsa_npp)) "npp",
      if (isTRUE(input$gd_chelsa_scd)) "scd"
    )
    if (length(extras) == 0) {
      gd_append_log("gd_env_log", "No CHELSA extras selected.")
      return()
    }
    gd_append_log("gd_env_log", paste("Downloading CHELSA extras:", paste(extras, collapse = ", ")))
    download_covariate_bg(
      log_target = "gd_worldclim_log", log_append = gd_append_log,
      label = "CHELSA extras",
      download_fun = function(extras) {
        source(file.path(sdm_project_root(), "R", "covariates_climate.R"))
        download_chelsa_extras("Worldclim", extras = extras, log_fun = function(...) message(paste(...)))
        message("CHELSA extras download complete.")
      },
      args = list(extras = extras),
      verify_fun = function() verify_chelsa_extras_cache("Worldclim"),
      timeout_sec = 300,
      notification_msg = paste0("CHELSA extras downloaded to ", file.path(sdm_project_root(), "Worldclim"))
    )
  })

  observeEvent(input$gd_verify_future, {
    gd_append_log("gd_cmip6_log", "Scanning CMIP6 scenarios...")
    v <- verify_future_cache()
    gd_append_log("gd_cmip6_log", v$detail)
    if (nrow(v$scenarios) > 0) {
      for (i in 1:nrow(v$scenarios)) {
        r <- v$scenarios[i, ]
        gd_append_log("gd_cmip6_log", paste(r$GCM, r$SSP, r$Period, "-", r$Files, "files,", r$SizeMB, "MB"))
      }
    }
  })

  observeEvent(input$gd_download_cmip6, {
    gcm <- input$gd_cmip6_gcm %||% "UKESM1-0-LL"
    ssp <- input$gd_cmip6_ssp %||% "SSP2-4.5"
    period <- input$gd_cmip6_period %||% "2041-2060"
    gd_append_log("gd_cmip6_log", paste("Starting CMIP6 download:", gcm, ssp, period, "..."))
    download_covariate_bg(
      log_target = "gd_cmip6_log", log_append = gd_append_log,
      label = "CMIP6",
      download_fun = function(gcm, ssp, period) {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_climate_future.R"))
        fetch_cmip6_worldclim(gcm = gcm, ssp = ssp, period = period, var = "bioc", res = 10,
                               out_dir = "Worldclim_future", quiet = FALSE)
        message("CMIP6 download complete.")
      },
      args = list(gcm = gcm, ssp = ssp, period = period),
      verify_fun = function() verify_future_cache(),
      timeout_sec = 600, kill_on_timeout = TRUE,
      notification_msg = "CMIP6 scenario download complete."
    )
  })

  observeEvent(input$gd_average_gcms, {
    gcm_list <- input$gd_cmip6_avg_gcms %||% character(0)
    ssp <- input$gd_cmip6_ssp %||% "SSP2-4.5"
    period <- input$gd_cmip6_period %||% "2041-2060"
    if (length(gcm_list) < 2) {
      gd_append_log("gd_cmip6_log", "Select at least 2 GCMs to average.")
      return()
    }
    gd_append_log("gd_cmip6_log", paste("Averaging GCMs:", paste(gcm_list, collapse = ", "), "SSP", ssp, period))
    download_covariate_bg(
      log_target = "gd_cmip6_log", log_append = gd_append_log,
      label = "GCM averaging",
      download_fun = function(gcm_list, ssp, period) {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_climate_future.R"))
        average_cmip6_gcms(gcm_list = gcm_list, ssp = ssp, period = period, var = "bioc",
                           res = 10, out_dir = "Worldclim_future", quiet = FALSE)
        message("GCM averaging complete.")
      },
      args = list(gcm_list = gcm_list, ssp = ssp, period = period),
      verify_fun = function() verify_future_cache(),
      timeout_sec = 600, kill_on_timeout = TRUE,
      notification_msg = "GCM averaging complete."
    )
  })

  observeEvent(input$gd_download_elevation, {
    demtype <- input$gd_demtype %||% "COP90"
    api_key <- input$gd_opentopo_key %||% Sys.getenv("OPENTOPOGRAPHY_API_KEY", "")
    if (!nzchar(api_key)) {
      gd_append_log("gd_terrain_log", "ERROR: OpenTopography API key required. Enter in the field above.")
      return()
    }
    download_covariate_bg(
      log_target = "gd_terrain_log", log_append = gd_append_log,
      label = paste("elevation DEM:", demtype),
      download_fun = function(demtype, api_key) {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_elevation.R"))
        cache_dir <- file.path(sdm_project_root(), "covariates", "opentopo")
        dir.create(cache_dir, recursive = TRUE)
        load_elevation_covariate(training_extent = NULL, projection_extent = NULL,
                                  cache_dir = cache_dir, demtype = demtype,
                                  api_key = api_key, allow_download = TRUE,
                                  log_fun = function(...) message(paste(...)))
        message("Elevation download complete.")
      },
      args = list(demtype = demtype, api_key = api_key),
      verify_fun = function() verify_elevation_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_soil, {
    selected_vars <- c(
      if (isTRUE(input$gd_soil_bdod)) "bdod",
      if (isTRUE(input$gd_soil_clay)) "clay",
      if (isTRUE(input$gd_soil_soc)) "soc",
      if (isTRUE(input$gd_soil_phh2o)) "phh2o",
      if (isTRUE(input$gd_soil_sand)) "sand"
    )
    selected_depths <- input$gd_soil_depths %||% character(0)
    if (length(selected_vars) == 0 || length(selected_depths) == 0) {
      gd_append_log("gd_terrain_log", "Select at least one variable and one depth.")
      return()
    }
    download_covariate_bg(
      log_target = "gd_terrain_log", log_append = gd_append_log,
      label = paste("soil:", paste(selected_vars, collapse = ",")),
      download_fun = function(selected_vars, selected_depths) {
        library(terra)
        cache_dir <- file.path(sdm_project_root(), "covariates", "soilgrids")
        dir.create(cache_dir, recursive = TRUE)
        for (v in selected_vars) {
          for (d in selected_depths) {
            tryCatch({
              message("Downloading soil ", v, " depth ", d, "cm...")
              r <- geodata::soil_world(var = v, depth = as.integer(d), stat = "mean", path = cache_dir)
              f <- list.files(cache_dir, pattern = paste0("sg_", v, "_d", d), full.names = TRUE)[1]
              if (!is.na(f) && file.exists(f)) message("OK: ", f)
            }, error = function(e) message("ERROR soil ", v, " d", d, ": ", e$message))
          }
        }
        message("Soil download complete.")
      },
      args = list(selected_vars = selected_vars, selected_depths = selected_depths),
      verify_fun = function() verify_soil_cache(),
      timeout_sec = 1200, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_uv, {
    download_covariate_bg(
      log_target = "gd_env_log", log_append = gd_append_log,
      label = "UV-B radiation",
      download_fun = function() {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_uv.R"))
        load_uv_covariate(selected_uv_vars = c("UVB1","UVB2","UVB3","UVB4","UVB5","UVB6"),
                          selected_uv_months = as.character(1:12),
                          covariate_cache_dir = file.path(sdm_project_root(), "covariates", "gluv"),
                          allow_download = TRUE, log_fun = function(...) message(paste(...)))
        message("UV-B download complete.")
      },
      verify_fun = function() verify_uv_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_vegetation, {
    download_covariate_bg(
      log_target = "gd_env_log", log_append = gd_append_log,
      label = "GIMMS NDVI climatology",
      download_fun = function() {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_vegetation.R"))
        load_gimms_ndvi_period(period = "clim", ndvi_year = 2020,
                                extent_vec = c(-180,180,-90,90),
                                aggregate_factor = 1,
                                cache_dir = file.path(sdm_project_root(), "covariates", "vegetation"),
                                allow_download = TRUE, log_fun = function(...) message(paste(...)))
        message("GIMMS NDVI download complete.")
      },
      verify_fun = function() verify_vegetation_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_gee_check, {
    geestatus <- if (requireNamespace("rgee", quietly = TRUE)) {
      tryCatch({
        rgee::ee_check()
        "GEE: authenticated"
      }, error = function(e) paste("GEE:", conditionMessage(e)))
    } else "GEE: rgee not installed"
    gd_append_log("gd_env_log", geestatus)
  })

  observeEvent(input$gd_download_lulc, {
    year <- as.integer(input$gd_lulc_year %||% 2020)
    download_covariate_bg(
      log_target = "gd_env_log", log_append = gd_append_log,
      label = paste("LULC year:", year),
      download_fun = function(year) {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_lulc.R"))
        load_lulc_covariate(lulc_year = year, extent_vec = c(-180,180,-90,90),
                            aggregate_factor = 1,
                            covariate_cache_dir = file.path(sdm_project_root(), "covariates", "lulc"),
                            allow_download = TRUE, log_fun = function(...) message(paste(...)))
        message("LULC download complete.")
      },
      args = list(year = year),
      verify_fun = function() verify_lulc_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_hfp, {
    year <- as.integer(input$gd_hfp_year %||% 2020)
    download_covariate_bg(
      log_target = "gd_env_log", log_append = gd_append_log,
      label = paste("Human Footprint year:", year),
      download_fun = function(year) {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_human_footprint.R"))
        load_human_footprint_covariate(hfp_year = year, extent_vec = c(-180,180,-90,90),
                                        aggregate_factor = 1,
                                        covariate_cache_dir = file.path(sdm_project_root(), "covariates", "human_footprint"),
                                        allow_download = TRUE, log_fun = function(...) message(paste(...)))
        message("HFP download complete.")
      },
      args = list(year = year),
      verify_fun = function() verify_hfp_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_drought, {
    periods <- input$gd_drought_periods %||% character(0)
    if (length(periods) == 0) {
      gd_append_log("gd_env_log", "Select at least one drought period.")
      return()
    }
    download_covariate_bg(
      log_target = "gd_env_log", log_append = gd_append_log,
      label = paste("drought periods:", paste(periods, collapse = ", ")),
      download_fun = function(periods) {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_drought.R"))
        load_drought_covariate(selected_periods = periods,
                                extent_vec = c(-180,180,-90,90),
                                aggregate_factor = 1,
                                covariate_cache_dir = file.path(sdm_project_root(), "covariates", "drought"),
                                allow_download = TRUE, log_fun = function(...) message(paste(...)))
        message("Drought download complete.")
      },
      args = list(periods = periods),
      verify_fun = function() verify_drought_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_bioclime, {
    download_covariate_bg(
      log_target = "gd_env_log", log_append = gd_append_log,
      label = "bioclimatic seasonality",
      download_fun = function() {
        library(terra)
        source(file.path(sdm_project_root(), "R", "covariates_bioclim_seasonality.R"))
        load_bioclim_seasonality(extent_vec = c(-180,180,-90,90),
                                  worldclim_dir = file.path(sdm_project_root(), "Worldclim"),
                                  aggregate_factor = 1,
                                  covariate_cache_dir = file.path(sdm_project_root(), "covariates", "bioclim_season"),
                                  allow_download = TRUE, log_fun = function(...) message(paste(...)))
        message("Bioclim season download complete.")
      },
      verify_fun = function() verify_bioclim_season_cache(),
      timeout_sec = 300, kill_on_timeout = TRUE
    )
  })

  observeEvent(input$gd_download_all, {
    s <- get_data_summary()
    missing_items <- character()
    if (s$worldclim$status != "ok") missing_items <- c(missing_items, "WorldClim")
    if (s$chelsa_extras$status != "ok") missing_items <- c(missing_items, "CHELSA extras")
    if (s$elevation$status != "ok") missing_items <- c(missing_items, "Elevation")
    if (s$soil$status != "ok") missing_items <- c(missing_items, "Soil")
    if (s$uv$status != "ok") missing_items <- c(missing_items, "UV-B")
    if (s$vegetation$status != "ok") missing_items <- c(missing_items, "Vegetation")
    if (s$lulc$status != "ok") missing_items <- c(missing_items, "LULC")
    if (s$hfp$status != "ok") missing_items <- c(missing_items, "HFP")
    if (s$drought$status != "ok") missing_items <- c(missing_items, "Drought")
    if (s$bioclim_season$status != "ok") missing_items <- c(missing_items, "Bioclim seasonality")
    if (length(missing_items) == 0) {
      gd_append_log("gd_env_log", "All covariate layers already present.")
      return()
    }
    gd_append_log("gd_env_log", paste("Missing layers:", paste(missing_items, collapse = ", ")))
    gd_append_log("gd_env_log", "Use individual download buttons for targeted downloads. Full batch download requires API keys (OpenTopography).")
  })

  observeEvent(input$gd_verify_all, {
    gd_append_log("gd_worldclim_log", "--- Full verification ---")
    s <- get_data_summary()
    gd_append_log("gd_worldclim_log", paste("WorldClim:", s$worldclim$detail))
    gd_append_log("gd_env_log", paste("CHELSA extras:", s$chelsa_extras$detail))
    gd_append_log("gd_cmip6_log", paste("CMIP6 futures:", s$future$detail))
    gd_append_log("gd_terrain_log", paste("Elevation:", s$elevation$detail))
    gd_append_log("gd_terrain_log", paste("Soil:", s$soil$detail))
    gd_append_log("gd_env_log", paste("UV-B:", s$uv$detail))
    gd_append_log("gd_env_log", paste("Vegetation:", s$vegetation$detail))
    gd_append_log("gd_env_log", paste("LULC:", s$lulc$detail))
    gd_append_log("gd_env_log", paste("HFP:", s$hfp$detail))
    gd_append_log("gd_env_log", paste("Drought:", s$drought$detail))
    gd_append_log("gd_env_log", paste("Bioclim season:", s$bioclim_season$detail))
    gd_append_log("gd_env_log", paste("Total cache:", round(s$total_covariates_mb, 1), "MB"))
  })

  observeEvent(input$gd_clear_cache, {
    showModal(modalDialog(
      title = "Clear covariate cache?",
      "This will permanently delete all cached covariate rasters in the covariates/ directory.",
      "Re-download will be required on next model run.",
      footer = tagList(
        actionButton("confirm_clear_cache_yes", "Yes, clear cache", class = "btn-danger"),
        modalButton("Cancel")
      ), easyClose = FALSE
    ))
  })

  observeEvent(input$confirm_clear_cache_yes, {
    removeModal()
    tryCatch({
      unlink("covariates", recursive = TRUE)
      gd_append_log("gd_env_log", "Covariate cache cleared.")
    }, error = function(e) {
      gd_append_log("gd_env_log", paste("ERROR clearing cache:", conditionMessage(e)))
    })
  })
}

if (!interactive()) {
  port <- as.integer(Sys.getenv("PORT", "3838"))

  wsl_ip <- NULL
  if (file.exists("/proc/version") && grepl("microsoft|WSL", readLines("/proc/version", warn = FALSE)[1], ignore.case = TRUE)) {
    wsl_ip <- tryCatch({
      con <- pipe("hostname -I 2>/dev/null", open = "r")
      ip_out <- readLines(con, warn = FALSE)
      close(con)
      if (length(ip_out) > 0) {
        parts <- strsplit(trimws(ip_out[1]), " ")[[1]]
        parts[nzchar(parts)][1]
      } else NULL
    }, error = function(e) NULL)
  }

  message("")
  message("========================================")
  message("SDM Dashboard is running!")
  message("========================================")
  message("")
  message(paste0("Local WSL access: http://localhost:", port))
  if (!is.null(wsl_ip) && nzchar(wsl_ip)) {
    message(paste0("Windows browser access: http://", wsl_ip, ":", port))
  } else {
    message("Windows browser: Use WSL IP address on port ", port)
  }
  message("========================================")
  message("")

  shiny::runApp(shiny::shinyApp(ui, server), host = "0.0.0.0", port = port)
}
