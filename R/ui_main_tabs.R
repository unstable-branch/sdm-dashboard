ui_main_tabs <- function() {
  mainPanel(width = 9,
    uiOutput("status_banner"),
    uiOutput("preflight_panel"),
    uiOutput("metric_cards"),

    tabsetPanel(id = "tabs",

      tabPanel("Dashboard",
        br(),
        fluidRow(
          column(8,
            div(class = "content-card map-card",
              div(class = "map-title-row",
                h4("Current suitability"),
                span("Interactive map view")
              ),
              leafletOutput("suitability_map", height = "56vh"),
              div(class = "map-controls",
                checkboxInput("show_presence", "Show presence points", value = TRUE),
                checkboxInput("show_background", "Show background points", value = FALSE),
                checkboxInput("show_mess", "Show MESS extrapolation", value = FALSE),
                selectInput("suitability_display", "Suitability display",
                  choices = c("Continuous" = "continuous", "Binary (threshold)" = "binary"),
                  selected = "continuous")
              )
            )
          ),
          column(4,
            div(class = "content-card",
              h4("Projection summary"),
              uiOutput("summary_panel")
            )
          )
        )
      ),

      tabPanel("Future projection",
        br(),
        fluidRow(
          column(6,
            div(class = "content-card",
              h4("Future suitability"),
              plotOutput("future_plot", height = "48vh")
            )
          ),
          column(6,
            div(class = "content-card",
              h4("Suitability delta"),
              plotOutput("delta_plot", height = "48vh")
            )
          )
        )
      ),

      tabPanel("Observation records",
        br(),
        fluidRow(
          column(7,
            div(class = "content-card",
              h4("Occurrence map"),
              p("Click a marker to flag for removal. Flagged records shown in red."),
              leafletOutput("occurrence_cleaning_map", height = "45vh"),
              br(),
              actionButton("remove_flagged_map", "Remove flagged records"),
              actionButton("clear_flags", "Clear flags")
            )
          ),
          column(5,
            div(class = "content-card",
              h4("Observation sources"),
              tableOutput("source_table"),
              hr(),
              h4("Flagged records"),
              DT::dataTableOutput("flagged_records_table")
            ),
            uiOutput("dwca_issues_panel")
          )
        )
      ),

      tabPanel("Model diagnostics",
        br(),
        fluidRow(
          column(7,
            div(class = "content-card",
              h4("Coefficient summary"),
              tableOutput("coef_table")
            ),
            uiOutput("ensemble_weights_panel"),
            uiOutput("esm_diagnostics_panel")
          ),
          column(5,
            div(class = "content-card",
              h4("Run log"),
              p(class = "small-muted", "Warnings and progress messages from the latest run."),
              verbatimTextOutput("run_log")
            )
          )
        )
      ),

      tabPanel("Get Data",
        br(),
        uiOutput("get_data_content")
      ),

      tabPanel("Downloads",
        br(),
        div(class = "content-card",
          h4("Export results"),
          p("Downloads are enabled after a successful run."),
          div(class = "downloads-row",
            downloadButton("download_tif", "Download GeoTIFF"),
            downloadButton("download_png", "Download PNG map"),
            uiOutput("future_tif_download_ui"),
            uiOutput("delta_tif_download_ui"),
            downloadButton("download_occ", "Download cleaned observation records"),
            downloadButton("download_report", "Download text report"),
            downloadButton("download_sidecars", "Download sidecar rasters")
          ),
          div(class = "downloads-row",
            downloadButton("download_odmap_csv", "Download ODMAP report (CSV)"),
            downloadButton("download_odmap_md", "Download ODMAP report (Markdown)")
          ),
          uiOutput("ensemble_downloads_ui"),
          uiOutput("sidecar_download_note")
        )
      )

    )
  )
}

get_data_tab <- function() {
  status_dot <- function(status) {
    color <- switch(status, ok = "#0b594f", warn = "#7a4b00", error = "#8c1d18", "warn")
    span(style = sprintf("display:inline-block;width:10px;height:10px;border-radius:50%%;background:%s;margin-right:6px;", color))
  }

  section_header <- function(label, icon = NULL, status = NULL, detail = NULL) {
    tagList(
      tags$summary(style = "cursor:pointer;font-weight:700;font-size:0.95rem;padding:6px 0;list-style:none;display:flex;align-items:center;gap:8px;",
        if (!is.null(status)) status_dot(status),
        if (!is.null(icon)) icon,
        label
      ),
      if (!is.null(detail)) tags$p(style = "margin:4px 0 8px 18px;font-size:0.82rem;color:#66768a;", detail)
    )
  }

  card <- function(...) div(class = "content-card", ...)

  fluidRow(
    column(12,
      card(
        h4("Covariate Data Management"),
        p(class = "small-muted", "Download, verify, and manage all covariate layers used in SDM modelling. No sidebar space used — all data operations in one place."),
        hr()
      ),

      # ----------------------------------------------------------------
      # Section 1: Climate — Current
      # ----------------------------------------------------------------
      tags$details(class = "control-section",
        tags$summary(style = "cursor:pointer;font-weight:800;font-size:1rem;padding:10px 12px;list-style:none;",
          span(style = "font-size:1.2em;margin-right:8px;", "🌡"),
          "Climate — Current (WorldClim / CHELSA)"
        ),
        div(style = "padding:0 12px 12px;",
          fluidRow(
            column(4,
              h5("WorldClim")
            ),
            column(4,
              h5("CHELSA extras")
            ),
            column(4,
              h5("Status")
            )
          ),
          fluidRow(
            column(4,
              selectInput("gd_climate_source", "Source",
                choices = c("WorldClim" = "worldclim", "CHELSA" = "chelsa"),
                selected = "worldclim"),
              selectInput("gd_worldclim_res", "Resolution",
                choices = c("10 arc-min" = 10, "5 arc-min" = 5, "2.5 arc-min" = 2.5),
                selected = 10),
              actionButton("gd_verify_worldclim", "Verify files", icon = icon("search"), class = "btn-outline-primary btn-sm"),
              br(), br(),
              actionButton("gd_download_worldclim", "Download missing layers", icon = icon("download"), class = "btn-primary btn-sm"),
              p(class = "small-muted", "Downloads from WorldClim via geodata package")
            ),
            column(4,
              p(class = "small-muted", "CHELSA bioclim-plus extras:"),
              checkboxInput("gd_chelsa_gdd5", "GDD5 (growing degree days >5C)", value = FALSE),
              checkboxInput("gd_chelsa_gdd10", "GDD10 (growing degree days >10C)", value = FALSE),
              checkboxInput("gd_chelsa_gsl", "GSL (growing season length)", value = FALSE),
              checkboxInput("gd_chelsa_fcf", "FCF (frost change frequency)", value = FALSE),
              checkboxInput("gd_chelsa_npp", "NPP (net primary productivity)", value = FALSE),
              checkboxInput("gd_chelsa_scd", "SCD (snow cover days)", value = FALSE),
              br(),
              actionButton("gd_download_chelsa", "Download selected extras", icon = icon("download"), class = "btn-outline-primary btn-sm")
            ),
            column(4,
              uiOutput("gd_worldclim_status"),
              hr(),
              uiOutput("gd_chelsa_status")
            )
          ),
          fluidRow(
            column(12,
              verbatimTextOutput("gd_worldclim_log"),
              style = "max-height:120px;overflow-y:scroll;background:#f4f7fb;border-radius:8px;padding:8px;font-size:0.8rem;margin-top:8px;"
            )
          )
        )
      ),

      tags$br(),

      # ----------------------------------------------------------------
      # Section 2: Climate — Future CMIP6
      # ----------------------------------------------------------------
      tags$details(class = "control-section",
        tags$summary(style = "cursor:pointer;font-weight:800;font-size:1rem;padding:10px 12px;list-style:none;",
          span(style = "font-size:1.2em;margin-right:8px;", "🗺"),
          "Climate — Future (CMIP6)"
        ),
        div(style = "padding:0 12px 12px;",
          fluidRow(
            column(5,
              h5("Downloaded scenarios"),
              uiOutput("gd_cmip6_scenarios"),
              hr(),
              actionButton("gd_verify_future", "Refresh scenarios", icon = icon("refresh"), class = "btn-outline-primary btn-sm")
            ),
            column(7,
              h5("Download new scenario"),
              fluidRow(
                column(4,
                  selectInput("gd_cmip6_gcm", "GCM",
                    choices = c(
                      "UKESM1-0-LL (UK)" = "UKESM1-0-LL",
                      "MPI-ESM1-2-HR (Germany)" = "MPI-ESM1-2-HR",
                      "IPSL-CM6A-LR (France)" = "IPSL-CM6A-LR",
                      "MRI-ESM2-0 (Japan)" = "MRI-ESM2-0",
                      "GFDL-ESM4 (USA)" = "GFDL-ESM4"
                    ),
                    selected = "UKESM1-0-LL")
                ),
                column(4,
                  selectInput("gd_cmip6_ssp", "SSP",
                    choices = c(
                      "SSP1-2.6 (Low emissions)" = "SSP1-2.6",
                      "SSP2-4.5 (Intermediate)" = "SSP2-4.5",
                      "SSP3-7.0 (High emissions)" = "SSP3-7.0",
                      "SSP5-8.5 (Very high)" = "SSP5-8.5"
                    ),
                    selected = "SSP2-4.5")
                ),
                column(4,
                  selectInput("gd_cmip6_period", "Period",
                    choices = c(
                      "2021-2040 (Near)" = "2021-2040",
                      "2041-2060 (Mid century)" = "2041-2060",
                      "2061-2080 (End century)" = "2061-2080",
                      "2081-2100 (Long term)" = "2081-2100"
                    ),
                    selected = "2041-2060")
                )
              ),
              br(),
              actionButton("gd_download_cmip6", "Download scenario", icon = icon("download"), class = "btn-primary btn-sm"),
              hr(),
              h6("Average multiple GCMs"),
              fluidRow(
                column(8,
                  selectInput("gd_cmip6_avg_gcms", "GCMs to average",
                    choices = c("UKESM1-0-LL","MPI-ESM1-2-HR","IPSL-CM6A-LR","MRI-ESM2-0","GFDL-ESM4"),
                    selected = character(0),
                    multiple = TRUE,
                    selectize = TRUE)
                ),
                column(4,
                  br(),
                  actionButton("gd_average_gcms", "Average GCMs", icon = icon("calculate"), class = "btn-outline-primary btn-sm")
                )
              )
            )
          ),
          fluidRow(
            column(12,
              verbatimTextOutput("gd_cmip6_log"),
              style = "max-height:120px;overflow-y:scroll;background:#f4f7fb;border-radius:8px;padding:8px;font-size:0.8rem;margin-top:8px;"
            )
          )
        )
      ),

      tags$br(),

      # ----------------------------------------------------------------
      # Section 3: Terrain & Soil
      # ----------------------------------------------------------------
      tags$details(class = "control-section",
        tags$summary(style = "cursor:pointer;font-weight:800;font-size:1rem;padding:10px 12px;list-style:none;",
          span(style = "font-size:1.2em;margin-right:8px;", "⛰"),
          "Terrain & Soil"
        ),
        div(style = "padding:0 12px 12px;",
          fluidRow(
            column(4,
              h5("Elevation (OpenTopography)"),
              uiOutput("gd_elevation_status"),
              selectInput("gd_demtype", "DEM type",
                choices = c(
                  "Copernicus 90m" = "COP90",
                  "SRTM GL 90m" = "SRTMGL3",
                  "Copernicus 30m" = "COP30",
                  "SRTM GL 30m" = "SRTMGL1",
                  "NASA DEM" = "NASADEM",
                  "ALOS World 3D 30m" = "AW3D30"
                ),
                selected = "COP90"),
              passwordInput("gd_opentopo_key", "OpenTopography API key",
                placeholder = "Get from OpenTopography.org"),
              p(class = "small-muted", "API key required. Get free key atopentography.org"),
              actionButton("gd_download_elevation", "Download elevation tiles", icon = icon("download"), class = "btn-outline-primary btn-sm")
            ),
            column(8,
              h5("SoilGrids (ISRIC)"),
              uiOutput("gd_soil_status"),
              fluidRow(
                column(6,
                  h6("Select variables to download:"),
                  checkboxInput("gd_soil_bdod", "Bulk density (BDOD)", value = FALSE),
                  checkboxInput("gd_soil_clay", "Clay content", value = FALSE),
                  checkboxInput("gd_soil_soc", "Soil organic carbon (SOC)", value = FALSE),
                  checkboxInput("gd_soil_phh2o", "pH in H2O", value = FALSE),
                  checkboxInput("gd_soil_sand", "Sand content", value = FALSE)
                ),
                column(6,
                  h6("Select depths:"),
                  checkboxGroupInput("gd_soil_depths", label = NULL,
                    choices = c("0-5cm" = "5", "5-15cm" = "15", "15-30cm" = "30",
                                 "30-60cm" = "60", "60-100cm" = "100", "100-200cm" = "200"),
                    selected = character(0))
                )
              ),
              actionButton("gd_download_soil", "Download selected soil layers", icon = icon("download"), class = "btn-outline-primary btn-sm")
            )
          ),
          fluidRow(
            column(12,
              verbatimTextOutput("gd_terrain_log"),
              style = "max-height:100px;overflow-y:scroll;background:#f4f7fb;border-radius:8px;padding:8px;font-size:0.8rem;margin-top:8px;"
            )
          )
        )
      ),

      tags$br(),

      # ----------------------------------------------------------------
      # Section 4: Environmental Layers
      # ----------------------------------------------------------------
      tags$details(class = "control-section",
        tags$summary(style = "cursor:pointer;font-weight:800;font-size:1rem;padding:10px 12px;list-style:none;",
          span(style = "font-size:1.2em;margin-right:8px;", "🌿"),
          "Environmental Layers"
        ),
        div(style = "padding:0 12px 12px;",
          fluidRow(
            column(4,
              h5("UV-B Radiation (glUV)"),
              uiOutput("gd_uv_status"),
              actionButton("gd_download_uv", "Download UV-B layers", icon = icon("download"), class = "btn-outline-primary btn-sm")
            ),
            column(4,
              h5("Vegetation (GIMMS NDVI/EVI)"),
              uiOutput("gd_vegetation_status"),
              actionButton("gd_download_vegetation", "Download GIMMS NDVI", icon = icon("download"), class = "btn-outline-primary btn-sm"),
              p(class = "small-muted", "LAI/GPP require Google Earth Engine (rgee)"),
              actionButton("gd_gee_check", "Check GEE auth status", icon = icon("key"), class = "btn-outline-secondary btn-sm")
            ),
            column(4,
              h5("LULC (MODIS MCD12Q1)"),
              uiOutput("gd_lulc_status"),
              selectInput("gd_lulc_year", "Year to download",
                choices = 2001:2023, selected = 2020),
              actionButton("gd_download_lulc", "Download LULC year", icon = icon("download"), class = "btn-outline-primary btn-sm")
            )
          ),
          hr(),
          fluidRow(
            column(4,
              h5("Human Footprint (WCS)"),
              uiOutput("gd_hfp_status"),
              selectInput("gd_hfp_year", "Year to download",
                choices = 2001:2020, selected = 2020),
              actionButton("gd_download_hfp", "Download HFP year", icon = icon("download"), class = "btn-outline-primary btn-sm")
            ),
            column(4,
              h5("Drought Index (CRU scPDSI)"),
              uiOutput("gd_drought_status"),
              checkboxGroupInput("gd_drought_periods", label = NULL,
                choices = c("Annual mean" = "annual_mean",
                            "Wet season (Dec-Feb)" = "wet_season",
                            "Dry season (Jun-Aug)" = "dry_season"),
                selected = character(0)),
              actionButton("gd_download_drought", "Download drought layers", icon = icon("download"), class = "btn-outline-primary btn-sm")
            ),
            column(4,
              h5("Bioclimatic Seasonality"),
              uiOutput("gd_bioclime_status"),
              actionButton("gd_download_bioclime", "Download seasonality", icon = icon("download"), class = "btn-outline-primary btn-sm"),
              p(class = "small-muted", "GDD5, GDD10, Moisture Index from WorldClim monthly data")
            )
          ),
          fluidRow(
            column(12,
              verbatimTextOutput("gd_env_log"),
              style = "max-height:100px;overflow-y:scroll;background:#f4f7fb;border-radius:8px;padding:8px;font-size:0.8rem;margin-top:8px;"
            )
          )
        )
      ),

      tags$br(),

      # ----------------------------------------------------------------
      # Section 5: Quick Actions
      # ----------------------------------------------------------------
      tags$details(class = "control-section",
        tags$summary(style = "cursor:pointer;font-weight:800;font-size:1rem;padding:10px 12px;list-style:none;",
          span(style = "font-size:1.2em;margin-right:8px;", "⚡"),
          "Quick Actions"
        ),
        div(style = "padding:0 12px 12px;",
          fluidRow(
            column(6,
              h5("Covariate cache summary"),
              uiOutput("gd_cache_summary"),
              hr(),
              actionButton("gd_verify_all", "Refresh all status", icon = icon("refresh"), class = "btn-outline-primary btn-sm"),
              actionButton("gd_download_all", "Download all missing", icon = icon("download"), class = "btn-primary btn-sm")
            ),
            column(6,
              h5("Cache management"),
              uiOutput("gd_cache_size"),
              hr(),
              actionButton("gd_clear_cache", "Clear covariate cache", icon = icon("trash"), class = "btn-danger btn-sm"),
              p(class = "small-muted", "Removes all cached covariate rasters. Re-download required on next run.")
            )
          )
        )
      )
    )
  )
}