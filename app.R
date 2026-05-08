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
    tags$style(HTML("\n      body { background:#f4f7fb; color:#102a43; }\n      .container-fluid { max-width:1680px; }\n      .hero { background:radial-gradient(circle at top right,rgba(255,255,255,.18),transparent 28%),linear-gradient(135deg,#083f3c 0%,#0B6E69 48%,#174A7C 100%); color:white; border-radius:22px; padding:30px 34px; margin:18px 0 22px; box-shadow:0 16px 38px rgba(15,36,58,.18);}\n      .hero h1 { font-weight:800; margin:0 0 8px; letter-spacing:-.02em; } .hero p { margin:0; opacity:.93; font-size:1.08rem; max-width:780px; }\n      .control-panel,.content-card,.metric-card { background:white; border:1px solid #e7edf4; border-radius:18px; box-shadow:0 10px 26px rgba(15,36,58,.07); }\n      .control-panel { padding:18px; position:sticky; top:14px; max-height:calc(100vh - 28px); overflow:auto; }\n      .control-panel h4 { color:#0B4F4A; font-size:1rem; font-weight:800; margin-top:6px; }\n      .content-card { padding:20px; margin-bottom:16px; } .content-card h4 { font-weight:800; margin-top:0; color:#16324f; }\n      .metric-grid { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:14px; margin-bottom:16px; }\n      .metric-card { border-left:5px solid #0B6E69; padding:16px; } .metric-label { color:#5d6d7e; font-size:.78rem; text-transform:uppercase; letter-spacing:.07em; font-weight:700; }\n      .metric-value { color:#102a43; font-size:1.8rem; font-weight:800; line-height:1.2; } .metric-note { color:#6c7a89; font-size:.85rem; margin-top:4px; }\n      .status-ok,.status-warn,.status-error,.status-info { border-radius:14px; padding:13px 15px; margin-bottom:16px; }\n      .status-ok { background:#e8f7f4; border:1px solid #b7e4db; color:#0b594f; } .status-warn { background:#fff7e6; border:1px solid #ffd591; color:#7a4b00; } .status-error { background:#fff1f0; border:1px solid #ffa39e; color:#8c1d18; } .status-info { background:#eef6ff; border:1px solid #b9dafb; color:#174A7C; }\n      .readiness-grid { display:grid; grid-template-columns:repeat(2,minmax(220px,1fr)); gap:12px; }\n      .readiness-item { border:1px solid #e7edf4; border-radius:14px; padding:13px 14px; background:#fbfcfe; }\n      .readiness-title { display:flex; align-items:center; gap:8px; font-weight:800; margin-bottom:4px; } .readiness-detail { color:#5d6d7e; font-size:.92rem; }\n      .pill { display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:24px; border-radius:999px; font-size:.78rem; font-weight:900; }\n      .pill-ok { background:#d9f3ed; color:#08705f; } .pill-warn { background:#ffedc2; color:#8a5a00; } .pill-error { background:#ffd8d6; color:#9f1f1a; } .pill-info { background:#dceeff; color:#174A7C; }\n      .run-button-wrap .btn { font-weight:800; padding:.8rem 1rem; }\n      pre { background:#0b1020; color:#d6e4ff; border-radius:12px; padding:14px; max-height:460px; overflow:auto; } .small-muted { color:#6c7a89; font-size:.9rem; }\n      .tab-content { padding-top:4px; }\n      @media(max-width:1100px){.metric-grid,.readiness-grid{grid-template-columns:repeat(2,minmax(150px,1fr));}.control-panel{position:static;max-height:none;}} @media(max-width:700px){.metric-grid,.readiness-grid{grid-template-columns:1fr;}.hero{padding:24px 22px;}}\n    ")),
    tags$script(HTML("\n      console.log('SDM Dashboard JS loaded');\n      Shiny.addCustomMessageHandler('setRunState', function(x) {\n        var btn = document.getElementById('run_model');\n        if (!btn) { console.log('setRunState: run_model btn not found'); return; }\n        console.log('setRunState called, running=', x.running);\n        btn.disabled = !!x.running;\n        btn.classList.toggle('disabled', !!x.running);\n        btn.textContent = x.running ? 'Running SDM...' : 'Run SDM';\n      });\n      (function() {\n        function setTheme(dark) {\n          document.body.classList.toggle('sdm-dark', dark);\n          document.body.classList.toggle('sdm-light', !dark);\n          try { window.localStorage.setItem('sdm-dashboard-theme', dark ? 'dark' : 'light'); } catch (e) {}\n        }\n        function initialTheme() {\n          try {\n            var saved = window.localStorage.getItem('sdm-dashboard-theme');\n            if (saved === 'dark' || saved === 'light') return saved === 'dark';\n          } catch (e) {}\n          return true;\n        }\n        function wireToggle() {\n          var toggle = document.getElementById('dark_mode');\n          var dark = initialTheme();\n          setTheme(dark);\n          if (!toggle || toggle.dataset.themeBound === '1') return;\n          toggle.checked = dark;\n          toggle.dataset.themeBound = '1';\n          toggle.addEventListener('change', function() { setTheme(toggle.checked); });\n        }\n        document.addEventListener('DOMContentLoaded', wireToggle);\n        document.addEventListener('shiny:connected', function() { console.log('Shiny connected'); wireToggle(); });\n      })();\n    "))
  ),

  tags$style(HTML("\n    .hero { padding:12px 20px; margin:8px 0 10px; border-radius:16px; }\n    .hero h1 { font-size:1.55rem; margin-bottom:1px; } .hero p { font-size:.92rem; }\n    .control-panel { display:flex; flex-direction:column; height:calc(100vh - 94px); max-height:calc(100vh - 94px); padding:12px; overflow:hidden; }\n    .control-scroll { flex:1 1 auto; min-height:0; overflow:auto; padding-right:3px; }\n    .control-panel .form-group { margin-bottom:.62rem; }\n    .control-section { border:1px solid #e7edf4; border-radius:14px; padding:10px 12px; margin-bottom:10px; background:#fbfdff; }\n    .control-section h4 { margin:0 0 8px; }\n    details.control-section { padding:0; overflow:hidden; }\n    details.control-section > summary { cursor:pointer; padding:10px 12px; font-weight:800; color:#0B4F4A; list-style:none; }\n    details.control-section > summary::-webkit-details-marker { display:none; }\n    details.control-section > summary:after { content:'+'; float:right; color:#5d6d7e; }\n    details.control-section[open] > summary:after { content:'-'; }\n    .details-body { padding:0 12px 10px; }\n    .run-button-wrap { flex:0 0 auto; position:static; bottom:auto; background:white; border-top:1px solid #e7edf4; margin-top:8px; padding-top:10px; }\n    .main-panel { padding-top:0; }\n    .content-card { padding:14px; margin-bottom:12px; }\n    .metric-grid { grid-template-columns:repeat(4,minmax(120px,1fr)); gap:10px; margin-bottom:10px; }\n    .metric-card { padding:12px; }\n    .metric-value { font-size:1.45rem; }\n    .status-ok,.status-warn,.status-error,.status-info { margin-bottom:10px; padding:10px 12px; }\n    .preflight-compact .readiness-grid { display:none; }\n    .preflight-compact { padding:10px 12px; }\n    .summary-list { display:grid; gap:6px; }\n    .summary-row { display:grid; grid-template-columns:minmax(105px,38%) 1fr; gap:8px; padding:6px 0; border-bottom:1px solid #edf2f7; }\n    .summary-row:last-child { border-bottom:0; }\n    .summary-label { color:#5d6d7e; font-size:.74rem; text-transform:uppercase; letter-spacing:.06em; font-weight:800; }\n    .summary-value { color:#102a43; font-weight:650; overflow-wrap:anywhere; }\n    .downloads-row .btn { margin:0 8px 8px 0; }\n    @media (max-width: 991px) { .control-panel { position:static; height:auto; max-height:none; overflow:visible; } .control-scroll { overflow:visible; } .metric-grid { grid-template-columns:repeat(2,minmax(140px,1fr)); } }\n  ")),

  tags$style(HTML("\n    .status-ok,.status-warn,.status-error,.status-info { overflow-wrap:anywhere; }\n    .status-ok:focus,.status-warn:focus,.status-error:focus,.status-info:focus,\n    .btn:focus-visible,.form-control:focus,.form-select:focus,input[type='radio']:focus-visible,input[type='checkbox']:focus-visible,summary:focus-visible { outline:3px solid #4cc9b0; outline-offset:2px; box-shadow:0 0 0 .2rem rgba(76,201,176,.25); }\n    @media (max-width: 991px) {\n      .control-panel { position:static; height:auto; max-height:none; margin-bottom:12px; }\n      .control-scroll { overflow:visible; }\n      .run-button-wrap { position:sticky; bottom:0; z-index:10; padding-bottom:8px; }\n      .metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }\n      .main-panel .content-card { overflow-x:auto; }\n    }\n    @media (max-width: 575px) {\n      .hero { padding:14px; }\n      .metric-grid,.summary-row { grid-template-columns:1fr; }\n      .metric-value { font-size:1.3rem; }\n      .content-card { padding:12px; }
    .map-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:8px; padding:8px 0; border-top:1px solid #e7edf4; }
    .map-controls .form-group { margin-bottom:0; }
    .btn-primary:disabled, .btn-primary.disabled { background:#6c757d !important; cursor:not-allowed; opacity:0.6; }
  ")),

  tags$style(HTML(sdm_theme_css)),

  ui_header(),

  sidebarLayout(
    sidebarPanel(width = 3, class = "control-panel",
      ui_sidebar_controls()
    ),

    ui_main_tabs()
  )
)

server <- function(input, output, session) {
  rv <- reactiveValues(result = NULL, log = "Ready.\n", error = NULL, running = FALSE, gbif_temp_file = NULL, gbif_doi = NULL, cleaned_occurrence = NULL)
  append_log <- function(message) rv$log <- paste0(rv$log, format(Sys.time(), "%H:%M:%S"), "  ", message, "\n")
  last_auto_species <- reactiveVal(sdm_initial_species)
  species_manually_set <- reactiveVal(FALSE)
  readiness_item <- function(title, detail, state = "info") {
    symbol <- switch(state, ok = "OK", warn = "!", error = "!", "i")
    div(class = "readiness-item", div(class = "readiness-title", span(class = paste("pill", paste0("pill-", state)), symbol), title), div(class = "readiness-detail", detail))
  }

  observeEvent(input$fetch_gbif, {
    req(input$gbif_taxon)
    output$gbif_status <- renderUI(p("Fetching from GBIF..."))
    tryCatch({
      if (nzchar(input$gbif_token)) {
        result <- read_gbif_download(
          taxon = input$gbif_taxon,
          country = if (nzchar(input$gbif_country)) input$gbif_country else NULL,
          token = input$gbif_token
        )
        occ_df <- result$occurrences
        rv$gbif_doi <- result$doi
      } else {
        occ_df <- read_gbif_records(
          taxon = input$gbif_taxon,
          country = if (nzchar(input$gbif_country)) input$gbif_country else NULL,
          max_records = input$gbif_max_records,
          log_fun = append_log
        )
        rv$gbif_doi <- if (!is.null(occ_df$gbif_doi[1]) && !is.na(occ_df$gbif_doi[1])) occ_df$gbif_doi[1] else NULL
      }
      if (nrow(occ_df) == 0) {
        output$gbif_status <- renderUI(p(style = "color: red", "No GBIF records found for this species."))
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
      output$gbif_status <- renderUI(p(style = "color: red", paste0("Error: ", conditionMessage(e))))
      append_log(paste0("GBIF fetch error: ", conditionMessage(e)))
    })
  })

  observeEvent(input$data_source, {
    if (!identical(input$data_source, "gbif")) {
      rv$gbif_temp_file <- NULL
      rv$gbif_doi <- NULL
    }
  }, ignoreInit = TRUE)

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

  observe({
    occurrence <- occurrence_source()
    if (is.null(occurrence$path)) {
      rv$cleaned_occurrence <- NULL
      return()
    }
    use_cc <- isTRUE(input$use_coordinatecleaner)
    cleaned <- clean_occurrence_preview(occurrence$path, min_source_records = input$min_source_records, use_cc = use_cc)
    if (!is.null(cleaned$error)) {
      rv$cleaned_occurrence <- NULL
      return()
    }
    if (is.null(cleaned$cc_flag)) {
      cleaned$cc_flag <- FALSE
    }
    rv$cleaned_occurrence <- cleaned
  })

  cleaned_occurrence <- reactive(rv$cleaned_occurrence)

  output$occurrence_source_status <- renderUI({
    occurrence <- occurrence_source()
    div(class = paste("status", occurrence$state, sep = "-"), role = "status", `aria-live` = "polite", occurrence$detail)
  })

  readiness <- reactive({
    biovars <- as.integer(input$biovars)
    biovars <- biovars[!is.na(biovars)]
    cleaned <- cleaned_occurrence()
    extent <- extent_from_inputs(input, cleaned)
    issues <- character()
    warnings <- character()

    occurrence <- occurrence_source()
    if (!is.null(occurrence$issue)) issues <- c(issues, occurrence$issue)
    if (identical(occurrence$state, "warn")) warnings <- c(warnings, occurrence$detail)
    if (!is.null(cleaned$error)) issues <- c(issues, paste("Observation records cannot be read:", cleaned$error))

    climate_files <- find_worldclim_files(input$worldclim_dir, biovars)
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
        issues <- c(issues, paste0("Add missing WorldClim BIO layers to ", input$worldclim_dir, " (e.g., ", paste(expected_patterns, collapse = ", "), "), or check 'Download missing WorldClim/elevation layers'."))
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
    soil_detail <- "HWSD soil covariates are off."
    if (isTRUE(input$use_soil)) {
      if (length(input$soil_vars) == 0) {
        soil_state <- "error"
        soil_detail <- "Soil is on, but no HWSD properties are selected."
        issues <- c(issues, "Select at least one HWSD soil property, or turn soil covariates off.")
      } else if (!file.exists(input$soil_path)) {
        soil_state <- "info"
        soil_detail <- paste("Soil file not found; HWSD layers will be skipped:", input$soil_path)
      } else {
        soil_state <- "ok"
        soil_detail <- paste(length(input$soil_vars), "HWSD properties selected from", input$soil_path)
      }
    }

    extent_state <- "ok"
    extent_detail <- paste0("xmin ", extent[1], ", xmax ", extent[2], ", ymin ", extent[3], ", ymax ", extent[4])
    if (any(!is.finite(extent)) || extent[1] >= extent[2] || extent[3] >= extent[4]) {
      extent_state <- "error"
      extent_detail <- "Projection extent is invalid. xmin/xmax and ymin/ymax must define a positive area."
      issues <- c(issues, "Fix the projection extent values.")
    }
    overlap_state <- "info"
    overlap_detail <- "Observation/projection overlap will be checked after observation records are available."
    overlap <- if (!is.null(cleaned) && is.null(cleaned$error)) occurrence_extent_overlap(cleaned$occ, extent) else NULL
    if (!is.null(overlap)) {
      overlap_detail <- paste0(overlap$count, " of ", overlap$total, " cleaned observation records (", fmt_num(overlap$percent, 1), "%) fall inside the selected projection extent.")
      overlap_state <- if (overlap$count == 0 || overlap$percent < 10) "warn" else "ok"
      if (identical(overlap_state, "warn")) warnings <- c(warnings, paste("Projection extent has little or no overlap with the observation records:", overlap_detail))
    }

    future_state <- "info"
    future_detail <- "Future climate projection is off."
    if (isTRUE(input$future_projection)) {
      future_dir <- trimws(input$future_worldclim_dir %||% "")
      if (!nzchar(future_dir)) {
        future_state <- "error"
        future_detail <- "Future projection is on, but no future climate folder is set."
        issues <- c(issues, future_detail)
      } else {
        future_files <- future_projection_files(future_dir, biovars)
        missing_future <- names(future_files)[is.na(future_files)]
        if (length(missing_future) > 0) {
          future_state <- "error"
          future_detail <- paste0("Missing future BIO", paste(missing_future, collapse = ", BIO"), " in ", future_dir, ".")
          issues <- c(issues, "Add matching future BIO GeoTIFFs or turn future projection off.")
        } else {
          future_state <- "ok"
          future_detail <- paste(length(future_files), "matching future BIO layers found in", future_dir)
        }
      }
    }

    elevation_count <- if (isTRUE(input$use_elevation) && identical(elevation_state, "ok")) 1L else 0L
    soil_count <- if (isTRUE(input$use_soil) && identical(soil_state, "ok")) length(input$soil_vars) else 0L
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
        readiness_item("HWSD soil", soil_detail, soil_state),
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

  output$maxnet_install_hint <- renderUI({
    if (!requireNamespace("maxnet", quietly = TRUE)) {
      div(class = "small-muted",
          "MaxEnt unavailable. Install with: ",
          tags$code("install.packages('maxnet')"),
          " then restart the app.")
    }
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
    rv$error <- NULL; rv$running <- TRUE; rv$log <- ""
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
      rv$error <- "Select at least one HWSD soil property, or turn soil covariates off."
      append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
    }
    projection_extent <- extent_from_inputs(input, cleaned_occurrence())
    species_label <- trimws(input$species %||% "")
    if (!nzchar(species_label)) species_label <- sdm_default_species

    withProgress(message = "Running SDM", value = 0, {
      result <- tryCatch(
        withCallingHandlers(
          run_fast_sdm(
            species = species_label, occurrence_file = occurrence_file, worldclim_dir = input$worldclim_dir,
            selected_biovars = as.integer(input$biovars), projection_extent = projection_extent,
            background_n = input$background_n, min_source_records = input$min_source_records,
            merge_small_sources = TRUE, thin_by_cell = isTRUE(input$thin_by_cell), model_id = input$model_id,
            include_quadratic = isTRUE(input$quadratic),
            threshold = input$threshold, aggregation_factor = input$aggregation_factor, cv_folds = as.integer(input$cv_folds),
            n_cores = input$n_cores, allow_download = isTRUE(input$download_worldclim), worldclim_res = as.numeric(input$worldclim_res),
            use_elevation = isTRUE(input$use_elevation), elevation_demtype = input$elevation_demtype,
            opentopo_api_key = input$opentopo_api_key,
            use_soil = isTRUE(input$use_soil), soil_path = input$soil_path, selected_soil_vars = input$soil_vars,
            covariate_cache_dir = sdm_default_covariate_cache_dir,
            vif_reduction = isTRUE(input$vif_reduction),
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
            output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = occurrence$detail,
            gbif_doi = rv$gbif_doi, source = input$climate_source, log_fun = append_log,
            progress_fun = function(amount, detail) incProgress(amount, detail = detail)
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

  output$suitability_map <- renderLeaflet({
    req(rv$result)
    r <- rv$result
    req(file.exists(r$paths$tif), "Output TIFF not found")

    map <- render_suitability_leaflet(
      suitability_raster = terra::rast(r$paths$tif),
      presence_df = r$occurrence_used %||% r$occurrence,
      background_df = r$background_used %||% NULL,
      mess_raster = if (!is.null(r$mess)) terra::rast(r$mess) else NULL,
      threshold = r$config$threshold %||% 0.5
    )

    if (!isTRUE(input$show_presence)) {
      map <- leaflet::hideGroup(map, "presence")
    }
    if (!isTRUE(input$show_background)) {
      map <- leaflet::hideGroup(map, "background")
    }

    map
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
    map <- leaflet::leafletProxy("suitability_map")

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
      map <- map %>% leaflet::addRasterImage(r_wgs84, opacity = 0.7,
                                              layerId = "suitability", project = FALSE)
    }
  })
  output$future_plot <- renderPlot({ if (is.null(rv$result) || is.null(rv$result$future)) return(placeholder_plot("Run with future projection enabled to view a future suitability map.")); r <- rv$result; plot_suitability_map(r$future$suitability, r$occurrence, r$config$projection_extent, paste(r$config$species, r$config$future_label), r$config$threshold, TRUE) })
  output$delta_plot <- renderPlot({ if (is.null(rv$result) || is.null(rv$result$future)) return(placeholder_plot("Run with future projection enabled to view current-to-future change.")); plot_delta_map(rv$result$future$delta, rv$result$config$future_label) })
  output$occurrence_plot <- renderPlot({ if (is.null(rv$result)) return(placeholder_plot("No occurrence map yet.")); plot_occurrence_map(rv$result$occurrence, rv$result$config$species) })
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
  output$source_table <- renderTable({ r <- rv$result; if (is.null(r)) return(data.frame(Message = "Run the model to view observation source counts.")); head(data.frame(Source = names(r$source_counts), Records = as.integer(r$source_counts), row.names = NULL), 25) }, striped = TRUE, hover = TRUE, spacing = "s")

  output$occurrence_cleaning_map <- renderLeaflet({
    req(rv$cleaned_occurrence)
    occ <- rv$cleaned_occurrence
    if (!is.data.frame(occ) || nrow(occ) < 1 || is.null(occ$longitude) || is.null(occ$latitude)) {
      return(leaflet::leaflet() %>% leaflet::addTiles() %>% leaflet::setView(lng = 0, lat = 0, zoom = 2))
    }

    colors <- ifelse(is.na(occ$cc_flag) | occ$cc_flag == FALSE, "blue", "red")

    leaflet::leaflet(occ) %>%
      leaflet::addTiles() %>%
      leaflet::addCircleMarkers(
        lng = ~longitude, lat = ~latitude,
        color = colors,
        fillOpacity = 0.7,
        radius = 5,
        layerId = ~seq_len(nrow(occ)),
        popup = ~paste0("Row ", seq_len(nrow(occ)), "<br>",
                         "Species: ", if("species" %in% names(occ)) species else "N/A", "<br>",
                         "Source: ", source)
      )
  })

  observeEvent(input$occurrence_cleaning_map_marker_click, {
    req(rv$cleaned_occurrence)

    click <- input$occurrence_cleaning_map_marker_click
    row_idx <- as.integer(click$id)

    if (is.na(row_idx) || row_idx < 1 || row_idx > nrow(rv$cleaned_occurrence)) {
      return()
    }
    current_flag <- rv$cleaned_occurrence$cc_flag[row_idx]
    rv$cleaned_occurrence$cc_flag[row_idx] <- !current_flag
  })

  observeEvent(input$remove_flagged_map, {
    req(rv$cleaned_occurrence)

    keep <- is.na(rv$cleaned_occurrence$cc_flag) | rv$cleaned_occurrence$cc_flag == FALSE
    rv$cleaned_occurrence <- rv$cleaned_occurrence[keep, ]

    leaflet::leafletProxy("occurrence_cleaning_map") %>%
      leaflet::clearMarkers() %>%
      leaflet::addCircleMarkers(
        data = rv$cleaned_occurrence,
        lng = ~longitude, lat = ~latitude,
        color = "blue", fillOpacity = 0.7, radius = 5,
        layerId = ~seq_len(nrow(rv$cleaned_occurrence))
      )
  })

  observeEvent(input$clear_flags, {
    req(rv$cleaned_occurrence)

    rv$cleaned_occurrence$cc_flag <- FALSE
  })

  output$flagged_records_table <- DT::renderDataTable({
    req(rv$cleaned_occurrence)
    occ <- rv$cleaned_occurrence
    if (!is.data.frame(occ) || nrow(occ) < 1) {
      return(DT::datatable(data.frame(Message = "No records available"), options = list(dom = "t")))
    }
    flagged <- occ[!is.na(occ$cc_flag) & occ$cc_flag == TRUE, , drop = FALSE]
    if (nrow(flagged) == 0) {
      return(DT::datatable(data.frame(Message = "No flagged records"), options = list(dom = "t")))
    }
    cols <- c("longitude", "latitude", "species", "source", "cc_flag")
    cols_present <- cols[cols %in% names(flagged)]
    DT::datatable(
      flagged[, cols_present, drop = FALSE],
      options = list(dom = "t", pageLength = 10),
      rownames = FALSE
    )
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
  output$run_log <- renderText(rv$log)
  observeEvent(input$remove_flagged, {
    req(rv$result)
    occ <- rv$result$occurrence
    if (!is.null(occ$cc_flag)) {
      rv$result$occurrence <- occ[is.na(occ$cc_flag) | occ$cc_flag == FALSE, ]
      rv$result$occurrence_used <- rv$result$occurrence
      append_log("Removed CoordinateCleaner-flagged records from current result.")
    }
  })
  output$sidecar_download_note <- renderUI({
    r <- rv$result
    if (is.null(r)) return(NULL)
    sidecars <- unlist(r$paths[c("glm_tif", "rangebag_tif", "disagreement_tif", "future_tif", "delta_tif")], use.names = FALSE)
    sidecars <- sidecars[!is.na(sidecars) & nzchar(sidecars) & file.exists(sidecars)]
    if (length(sidecars) == 0) return(p(class = "small-muted", "No model sidecar rasters were produced for this run."))
    tags$ul(class = "small-muted", lapply(sidecars, function(path) tags$li(basename(path))))
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
      sidecars <- unlist(rv$result$paths[c("glm_tif", "rangebag_tif", "disagreement_tif", "future_tif", "delta_tif")], use.names = FALSE)
      sidecars <- sidecars[!is.na(sidecars) & nzchar(sidecars) & file.exists(sidecars)]
      validate(need(length(sidecars) > 0, "No sidecar rasters are available for this run."))
      oldwd <- getwd()
      on.exit(setwd(oldwd), add = TRUE)
      setwd(dirname(sidecars[1]))
      utils::zip(file, files = basename(sidecars))
    }
  )
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
