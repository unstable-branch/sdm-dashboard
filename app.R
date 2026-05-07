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

# Load the modelling engine. R/optimized_sdm.R is now a compatibility loader
# for the refactored modules; the root file remains as an older launch fallback.
engine_candidates <- unique(c(
  file.path("R", "optimized_sdm.R"),
  "optimized_sdm.R",
  file.path(dirname(normalizePath("app.R", winslash = "/", mustWork = FALSE)), "R", "optimized_sdm.R"),
  file.path(dirname(normalizePath("app.R", winslash = "/", mustWork = FALSE)), "optimized_sdm.R")
))
engine_file <- engine_candidates[file.exists(engine_candidates)][1]
if (is.na(engine_file)) {
  stop(
    "Could not find the modelling engine file optimized_sdm.R.\n",
    "Expected either R/optimized_sdm.R or optimized_sdm.R in the same folder as app.R.\n",
    "Your zip/extraction is incomplete. Re-extract the full SDM folder or copy the missing R folder."
  )
}
source(engine_file)
default_cores <- normalize_core_count(NULL, reserve_one = TRUE)
ensure_sdm_packages(c("shiny", "bslib", "terra"), n_cores = default_cores)

suppressPackageStartupMessages({
  library(shiny)
  library(bslib)
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
    tags$script(HTML("\n      Shiny.addCustomMessageHandler('setRunState', function(x) {\n        var btn = document.getElementById('run_model');\n        if (!btn) return;\n        btn.disabled = !!x.running;\n        btn.classList.toggle('disabled', !!x.running);\n        btn.textContent = x.running ? 'Running SDM...' : 'Run SDM';\n      });\n      (function() {\n        function setTheme(dark) {\n          document.body.classList.toggle('sdm-dark', dark);\n          document.body.classList.toggle('sdm-light', !dark);\n          try { window.localStorage.setItem('sdm-dashboard-theme', dark ? 'dark' : 'light'); } catch (e) {}\n        }\n        function initialTheme() {\n          try {\n            var saved = window.localStorage.getItem('sdm-dashboard-theme');\n            if (saved === 'dark' || saved === 'light') return saved === 'dark';\n          } catch (e) {}\n          return true;\n        }\n        function wireToggle() {\n          var toggle = document.getElementById('dark_mode');\n          var dark = initialTheme();\n          setTheme(dark);\n          if (!toggle || toggle.dataset.themeBound === '1') return;\n          toggle.checked = dark;\n          toggle.dataset.themeBound = '1';\n          toggle.addEventListener('change', function() { setTheme(toggle.checked); });\n        }\n        document.addEventListener('DOMContentLoaded', wireToggle);\n        document.addEventListener('shiny:connected', wireToggle);\n      })();\n    "))
  ),

  tags$style(HTML("\n    .hero { padding:12px 20px; margin:8px 0 10px; border-radius:16px; }\n    .hero h1 { font-size:1.55rem; margin-bottom:1px; } .hero p { font-size:.92rem; }\n    .control-panel { display:flex; flex-direction:column; height:calc(100vh - 94px); max-height:calc(100vh - 94px); padding:12px; overflow:hidden; }\n    .control-scroll { flex:1 1 auto; min-height:0; overflow:auto; padding-right:3px; }\n    .control-panel .form-group { margin-bottom:.62rem; }\n    .control-section { border:1px solid #e7edf4; border-radius:14px; padding:10px 12px; margin-bottom:10px; background:#fbfdff; }\n    .control-section h4 { margin:0 0 8px; }\n    details.control-section { padding:0; overflow:hidden; }\n    details.control-section > summary { cursor:pointer; padding:10px 12px; font-weight:800; color:#0B4F4A; list-style:none; }\n    details.control-section > summary::-webkit-details-marker { display:none; }\n    details.control-section > summary:after { content:'+'; float:right; color:#5d6d7e; }\n    details.control-section[open] > summary:after { content:'-'; }\n    .details-body { padding:0 12px 10px; }\n    .run-button-wrap { flex:0 0 auto; position:static; bottom:auto; background:white; border-top:1px solid #e7edf4; margin-top:8px; padding-top:10px; }\n    .main-panel { padding-top:0; }\n    .content-card { padding:14px; margin-bottom:12px; }\n    .metric-grid { grid-template-columns:repeat(4,minmax(120px,1fr)); gap:10px; margin-bottom:10px; }\n    .metric-card { padding:12px; }\n    .metric-value { font-size:1.45rem; }\n    .status-ok,.status-warn,.status-error,.status-info { margin-bottom:10px; padding:10px 12px; }\n    .preflight-compact .readiness-grid { display:none; }\n    .preflight-compact { padding:10px 12px; }\n    .summary-list { display:grid; gap:6px; }\n    .summary-row { display:grid; grid-template-columns:minmax(105px,38%) 1fr; gap:8px; padding:6px 0; border-bottom:1px solid #edf2f7; }\n    .summary-row:last-child { border-bottom:0; }\n    .summary-label { color:#5d6d7e; font-size:.74rem; text-transform:uppercase; letter-spacing:.06em; font-weight:800; }\n    .summary-value { color:#102a43; font-weight:650; overflow-wrap:anywhere; }\n    .downloads-row .btn { margin:0 8px 8px 0; }\n    @media (max-width: 991px) { .control-panel { position:static; height:auto; max-height:none; overflow:visible; } .control-scroll { overflow:visible; } .metric-grid { grid-template-columns:repeat(2,minmax(140px,1fr)); } }\n  ")),

  tags$style(HTML("\n    .status-ok,.status-warn,.status-error,.status-info { overflow-wrap:anywhere; }\n    .status-ok:focus,.status-warn:focus,.status-error:focus,.status-info:focus,\n    .btn:focus-visible,.form-control:focus,.form-select:focus,input[type='radio']:focus-visible,input[type='checkbox']:focus-visible,summary:focus-visible { outline:3px solid #4cc9b0; outline-offset:2px; box-shadow:0 0 0 .2rem rgba(76,201,176,.25); }\n    @media (max-width: 991px) {\n      .control-panel { position:static; height:auto; max-height:none; margin-bottom:12px; }\n      .control-scroll { overflow:visible; }\n      .run-button-wrap { position:sticky; bottom:0; z-index:10; padding-bottom:8px; }\n      .metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }\n      .main-panel .content-card { overflow-x:auto; }\n    }\n    @media (max-width: 575px) {\n      .hero { padding:14px; }\n      .metric-grid,.summary-row { grid-template-columns:1fr; }\n      .metric-value { font-size:1.3rem; }\n      .content-card { padding:12px; }\n    }\n  ")),

  tags$style(HTML(sdm_theme_css)),

  div(class = "hero",
    div(class = "hero-kicker", "Experimental multi-model SDM workbench"),
    h1("Species Distribution Model"),
    p("Clean occurrence records, compare model backends, and export habitat suitability maps from one local-first dashboard."),
    div(class = "hero-badges",
      span("CSV/data ready"), span("BIO vars configured"), span("GLM ready"), span("Provenance exports")
    )
  ),

  sidebarLayout(
    sidebarPanel(width = 3, class = "control-panel",
      div(class = "control-scroll",
      div(class = "control-section display-section",
        h4("Display"),
        checkboxInput("dark_mode", "Dark professional mode", value = TRUE),
        div(class = "small-muted", "Presentation-only setting. It does not change model inputs or outputs.")
      ),
      div(class = "control-section",
        h4("Input data"),
        textInput("species", "Species/model label", value = sdm_initial_species),
        radioButtons("data_source", "Observation record source",
          choices = stats::setNames(c("upload", "project", "demo"), c("Upload file", paste0("Project ", sdm_default_occurrence_file), "Synthetic demo")),
          selected = if (file.exists(sdm_default_occurrence_file)) "project" else "demo"
        ),
        conditionalPanel("input.data_source == 'upload'", fileInput("occ_file", "Observation record CSV/TSV", accept = c(".csv", ".tsv", ".txt"))),
        uiOutput("occurrence_source_status"),
        div(class = "small-muted", "If the selected source is unavailable, the app falls back to project data, then demo data when possible.")
      ),
      div(class = "control-section",
        h4("Climate data"),
        textInput("worldclim_dir", "WorldClim folder", value = sdm_default_worldclim_dir),
        checkboxInput("download_worldclim", "Download missing WorldClim/elevation layers", value = TRUE),
        selectInput("worldclim_res", "WorldClim resolution", choices = c("10 arc-min" = "10", "5 arc-min" = "5", "2.5 arc-min" = "2.5"), selected = as.character(sdm_default_worldclim_res))
      ),
      tags$details(class = "control-section", open = TRUE,
        tags$summary("Climate variables"),
        div(class = "details-body",
          checkboxGroupInput("biovars", NULL, choices = biovar_choices, selected = as.character(sdm_default_biovars))
        )
      ),
      tags$details(class = "control-section",
        tags$summary("Optional covariates"),
        div(class = "details-body",
          checkboxInput("use_elevation", "Add elevation from OpenTopography", value = FALSE),
          conditionalPanel("input.use_elevation == true",
            selectInput("elevation_demtype", "Elevation DEM", choices = opentopo_dem_choices, selected = sdm_default_elevation_demtype),
            passwordInput("opentopo_api_key", "OpenTopography API key (optional)", value = ""),
            div(class = "small-muted", "Leave blank to use OPENTOPOGRAPHY_API_KEY from your environment. Keys are not saved in outputs.")
          ),
          checkboxInput("use_soil", "Add HWSD v2 soil covariates", value = FALSE),
          conditionalPanel("input.use_soil == true",
            checkboxGroupInput("soil_vars", "Soil properties", choices = hwsd_soil_choices, selected = sdm_default_soil_vars),
            textInput("soil_path", "HWSD v2 soil GeoTIFF", value = sdm_default_soil_path),
            div(class = "small-muted", "Use a local GeoTIFF exported from the HWSD v2 GEE asset. Missing files are skipped with an informational warning.")
          )
        )
      ),
      tags$details(class = "control-section",
        tags$summary("Model settings"),
        div(class = "details-body",
          selectInput("model_id", "Model backend", choices = sdm_model_choices(), selected = sdm_default_model_id),
          uiOutput("maxnet_install_hint"),
          conditionalPanel("input.model_id == 'maxnet'",
            selectInput("maxnet_features", "MaxEnt features",
              choices = c("Linear" = "l", "Linear + Quadratic" = "lq",
                          "Linear + Quadratic + Product" = "lqp",
                          "Linear + Quadratic + Hinge" = "lqh",
                          "All" = "lqpht"),
              selected = "lqp"),
            numericInput("maxnet_regmult", "Regularization multiplier",
              value = 1.0, min = 0.1, max = 10, step = 0.1)
          ),
          div(class = "small-muted", "Rangebagging is experimental; GLM remains the stable default."),
          numericInput("background_n", "Background points", value = sdm_default_background_n, min = 500, max = 100000, step = 500),
          numericInput("min_source_records", "Merge sources with fewer than", value = sdm_default_min_source_records, min = 1, max = 100, step = 1),
          checkboxInput("thin_by_cell", "Thin duplicate records in the same climate cell", value = TRUE),
          checkboxInput("quadratic", "Include quadratic climate responses", value = TRUE),
          checkboxInput("vif_reduction", "Drop collinear covariates (VIF > 10)", value = FALSE),
          selectInput("cv_folds", "Cross-validation", choices = c("Off" = "0", "3-fold" = "3", "5-fold" = "5"), selected = as.character(sdm_default_cv_folds)),
          numericInput("n_cores", "CPU cores for compile/predict/CV", value = default_cores, min = 1, max = detect_available_cores(TRUE), step = 1),
          div(class = "small-muted", "Also sets MAKEFLAGS=-jN for source package compilation."),
          numericInput("aggregation_factor", "Raster aggregation for speed (1 = native)", value = sdm_default_aggregation_factor, min = 1, max = 8, step = 1)
        )
      ),
      div(class = "control-section",
        h4("Projection"),
        selectInput("extent_preset", "Projection extent", choices = sdm_extent_choices, selected = sdm_default_extent_preset),
        conditionalPanel("input.extent_preset == 'custom'",
          fluidRow(column(6, numericInput("xmin", "xmin", sdm_default_projection_extent[1])), column(6, numericInput("xmax", "xmax", sdm_default_projection_extent[2]))),
          fluidRow(column(6, numericInput("ymin", "ymin", sdm_default_projection_extent[3])), column(6, numericInput("ymax", "ymax", sdm_default_projection_extent[4])))
        ),
        sliderInput("threshold", "High-suitability threshold", min = 0.05, max = 0.95, value = sdm_default_threshold, step = 0.05),
        checkboxInput("future_projection", "Project a future climate scenario", value = FALSE),
        conditionalPanel("input.future_projection == true",
          textInput("future_worldclim_dir", "Future/CMIP6 BIO folder", value = sdm_default_future_worldclim_dir),
          textInput("future_label", "Scenario label", value = "Future climate"),
          div(class = "small-muted", "Provide future BIO GeoTIFFs with matching BIO variable numbers. The model backend is reused; only climate layers are swapped, while static elevation/soil covariates are reused.")
        )
      ),
      ),
      div(class = "run-button-wrap", actionButton("run_model", "Run SDM", class = "btn-primary btn-lg", width = "100%"))
    ),

    mainPanel(width = 9,
      uiOutput("status_banner"), uiOutput("preflight_panel"), uiOutput("metric_cards"),
      tabsetPanel(id = "tabs",
        tabPanel("Dashboard", br(), fluidRow(column(8, div(class = "content-card map-card", div(class = "map-title-row", h4("Current suitability"), span("Australia-first map view")), plotOutput("suitability_plot", height = "56vh"))), column(4, div(class = "content-card", h4("Projection summary"), uiOutput("summary_panel"))))),
        tabPanel("Future projection", br(), fluidRow(column(6, div(class = "content-card", h4("Future suitability"), plotOutput("future_plot", height = "48vh"))), column(6, div(class = "content-card", h4("Suitability delta"), plotOutput("delta_plot", height = "48vh"))))),
        tabPanel("Observation records", br(), fluidRow(column(7, div(class = "content-card", plotOutput("occurrence_plot", height = "50vh"))), column(5, div(class = "content-card", h4("Top observation sources"), tableOutput("source_table"))))),
        tabPanel("Model diagnostics", br(), fluidRow(column(7, div(class = "content-card", h4("Coefficient summary"), tableOutput("coef_table"))), column(5, div(class = "content-card", h4("Run log"), p(class = "small-muted", "Warnings and progress messages from the latest run."), verbatimTextOutput("run_log"))))),
        tabPanel("Downloads", br(), div(class = "content-card", h4("Export results"), p("Downloads are enabled after a successful run."), div(class = "downloads-row", downloadButton("download_tif", "Download GeoTIFF"), downloadButton("download_png", "Download PNG map"), downloadButton("download_future_tif", "Download future GeoTIFF"), downloadButton("download_delta_tif", "Download delta GeoTIFF"), downloadButton("download_occ", "Download cleaned observation records"), downloadButton("download_report", "Download text report"), downloadButton("download_sidecars", "Download sidecar rasters")), div(class = "downloads-row", downloadButton("download_odmap_csv", "Download ODMAP report (CSV)"), downloadButton("download_odmap_md", "Download ODMAP report (Markdown)")), uiOutput("sidecar_download_note")))
      )
    )
  )
)

server <- function(input, output, session) {
  rv <- reactiveValues(result = NULL, log = "Ready.\n", error = NULL, running = FALSE)
  append_log <- function(message) rv$log <- paste0(rv$log, format(Sys.time(), "%H:%M:%S"), "  ", message, "\n")
  last_auto_species <- reactiveVal(sdm_initial_species)
  species_manually_set <- reactiveVal(FALSE)
  readiness_item <- function(title, detail, state = "info") {
    symbol <- switch(state, ok = "OK", warn = "!", error = "!", "i")
    div(class = "readiness-item", div(class = "readiness-title", span(class = paste("pill", paste0("pill-", state)), symbol), title), div(class = "readiness-detail", detail))
  }
  occurrence_source <- function() {
    selected <- if (is.null(input$data_source)) "project" else input$data_source
    uploaded <- !is.null(input$occ_file)
    project_exists <- file.exists(sdm_default_occurrence_file)
    demo_exists <- file.exists(sdm_demo_occurrence_file)
    if (identical(selected, "upload") && uploaded) {
      return(list(path = input$occ_file$datapath, detail = paste("Using uploaded observation records:", input$occ_file$name), state = "ok", issue = NULL))
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

  cleaned_occurrence <- reactive({
    occurrence <- occurrence_source()
    if (is.null(occurrence$path)) return(NULL)
    clean_occurrence_preview(occurrence$path, min_source_records = input$min_source_records)
  })

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
      climate_detail <- paste0(climate_detail, "; missing BIO", paste(missing_climate, collapse = ", BIO"), ".")
      issues <- c(issues, "Enable WorldClim download or add the missing BIO layers.")
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
    session$sendCustomMessage("setRunState", list(running = isTRUE(rv$running)))
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
    if (isTRUE(rv$running)) return(invisible(NULL))
    rv$error <- NULL; rv$running <- TRUE; rv$log <- ""
    on.exit({ rv$running <- FALSE }, add = TRUE)
    occurrence <- occurrence_source()
    occurrence_file <- occurrence$path
    if (is.null(occurrence_file)) {
      rv$error <- paste("No observation record file found. Upload a CSV/TSV, add", sdm_default_occurrence_file, "to the project folder, or restore the demo dataset.")
      append_log(rv$error); return(invisible(NULL))
    }
    if (length(input$biovars) < 2) {
      rv$error <- "Select at least two BIOCLIM variables."
      append_log(rv$error); return(invisible(NULL))
    }
    if (isTRUE(input$use_soil) && length(input$soil_vars) == 0) {
      rv$error <- "Select at least one HWSD soil property, or turn soil covariates off."
      append_log(rv$error); return(invisible(NULL))
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
            output_dir = sdm_default_output_dir, seed = sdm_default_seed, occurrence_source = occurrence$detail, log_fun = append_log,
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
  output$download_odmap_md <- downloadHandler(filename = function() { req(rv$result); paste0(safe_slug(rv$result$config$species), "_odmap_report.md") }, content = function(file) { req(rv$result); write_odmap_report(rv$result, tempfile(fileext = ".csv"), file) })
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

if (sys.nframe() == 0) {
  port <- as.integer(Sys.getenv("PORT", "3838"))
  shiny::runApp(shiny::shinyApp(ui, server), host = "0.0.0.0", port = port)
}
