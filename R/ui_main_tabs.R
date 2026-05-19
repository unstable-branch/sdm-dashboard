ui_main_tabs <- function() {
  mainPanel(
    width = 9,
    uiOutput("readiness-status_banner"),
    uiOutput("readiness-preflight_panel"),
    uiOutput("results-metric_cards"),
    tabsetPanel(
      id = "tabs",
      tabPanel(
        "Dashboard",
        br(),
        fluidRow(
          column(
            8,
            div(
              class = "content-card map-card",
              div(
                class = "map-title-row",
                h4("Current suitability"),
                span("Interactive map view")
              ),
              uiOutput("results-suitability_map_ui"),
              div(
                class = "map-controls",
                checkboxInput("show_presence", "Show presence points", value = TRUE),
                checkboxInput("show_background", "Show background points", value = FALSE),
                checkboxInput("show_mess", "Show MESS extrapolation", value = FALSE),
                selectInput("suitability_display", "Suitability display",
                  choices = c("Continuous" = "continuous", "Binary (threshold)" = "binary"),
                  selected = "continuous")
              )
            )
          ),
          column(
            4,
            div(
              class = "content-card",
              h4("Projection summary"),
              uiOutput("results-summary_panel")
            )
          )
        )
      ),
      tabPanel(
        "Future projection",
        br(),
        fluidRow(
          column(
            6,
            div(
              class = "content-card",
              h4("Future suitability"),
              plotOutput("results-future_plot", height = "48vh")
            )
          ),
          column(
            6,
            div(
              class = "content-card",
              h4("Suitability delta"),
              plotOutput("results-delta_plot", height = "48vh")
            )
          )
        )
      ),
      tabPanel(
        "Observation records",
        br(),
        fluidRow(
          column(
            7,
            div(
              class = "content-card",
              h4("Occurrence map"),
              p("Click a marker to flag for removal. Flagged records shown in red."),
              leafletOutput("occurrence_cleaning_map", height = "45vh"),
              br(),
              div(class = "flagged-actions",
                actionButton("remove_flagged_map", "Remove flagged records"),
                uiOutput("flagged_count"),
                actionButton("clear_flags", "Clear flags")
              )
            )
          ),
          column(
            5,
            div(
              class = "content-card",
              h4("Observation sources"),
              div(class = "table-scroll",
                tableOutput("source_table")
              ),
              verbatimTextOutput("absent_excluded_log"),
              hr(),
              h4("Flagged records"),
              verbatimTextOutput("cc_stats_log")
            ),
            uiOutput("dwca_issues_panel")
          )
        )
      ),
      tabPanel(
        "Model diagnostics",
        br(),
        fluidRow(
          column(
            7,
            div(
              class = "content-card",
              h4("Coefficient summary"),
              tableOutput("results-coef_table")
            ),
            uiOutput("results-response_curves_panel"),
            uiOutput("results-variable_importance_panel"),
            uiOutput("results-ensemble_weights_panel"),
            uiOutput("results-esm_diagnostics_panel")
          ),
          column(
            5,
            div(
              class = "content-card",
              h4("Run log"),
              p(class = "small-muted", "Warnings and progress messages from the latest run."),
              htmlOutput("results-run_log")
            )
          )
        )
      ),
      tabPanel(
        "Get Data",
        br(),
        uiOutput("get_data-get_data_content")
      ),
      tabPanel(
        "Downloads",
        br(),
        div(
          class = "content-card",
          h4("Export results"),
          p("Downloads are enabled after a successful run."),
          div(class = "downloads-section",
            h5("Maps"),
            div(class = "downloads-row",
              downloadButton("download_tif", "GeoTIFF (suitability raster)"),
              downloadButton("download_png", "PNG map preview"),
              downloadButton("download_sidecars", "Sidecar rasters (ZIP)")
            ),
            div(class = "downloads-row downloads-row-sm",
              uiOutput("results-future_tif_download_ui"),
              uiOutput("results-delta_tif_download_ui")
            ),
            uiOutput("results-ensemble_downloads_ui")
          ),
          div(class = "downloads-section",
            h5("Data"),
            div(class = "downloads-row",
              downloadButton("download_occ", "Cleaned observation records (CSV)")
            )
          ),
          div(class = "downloads-section",
            h5("Reports"),
            div(class = "downloads-row",
              downloadButton("download_report", "Text report (.txt)"),
              downloadButton("download_odmap_csv", "ODMAP report (CSV)"),
              downloadButton("download_odmap_md", "ODMAP report (Markdown)")
            )
          ),
          uiOutput("results-sidecar_download_note")
        )
      )
    )
  )
}

get_data_tab <- function(ns = identity) {
  fluidRow(
    column(
      10,
      div(
        class = "gd-sections-panel",
        div(
          class = "content-card",
          h4("Covariate Data Management"),
          p(class = "small-muted", "Download, verify, and manage all covariate layers used in SDM modelling. All activity appears in the Activity Log to the right."),
          hr()
        ),

        # Section 1: Climate — Current
        tags$details(
          class = "control-section",
          tags$summary(
            class = "gd-section-summary",
            span(class = "gd-section-icon", "🌡"),
            "Climate — Current (WorldClim / CHELSA)"
          ),
          div(
            class = "gd-section-body",
            fluidRow(
              column(
                6,
                h5("WorldClim"),
                selectInput(ns("gd_climate_source"), "Source",
                  choices = c("WorldClim" = "worldclim", "CHELSA" = "chelsa"),
                  selected = "worldclim"
                ),
                selectInput(ns("gd_worldclim_res"), "Resolution",
                  choices = c("10 arc-min" = 10, "5 arc-min" = 5, "2.5 arc-min" = 2.5),
                  selected = 10
                ),
                actionButton(ns("gd_verify_worldclim"), "Verify files", icon = icon("search"), class = "btn-outline-primary btn-sm"),
                br(), br(),
                actionButton(ns("gd_download_worldclim"), "Download missing layers", icon = icon("download"), class = "btn-outline-primary btn-sm"),
                p(class = "small-muted", "Downloads from WorldClim via geodata package")
              ),
              column(
                6,
                h5("CHELSA extras"),
                uiOutput(ns("gd_chelsa_status")),
                p(class = "small-muted", "CHELSA bioclim-plus extras:"),
                checkboxInput(ns("gd_chelsa_gdd5"), "GDD5 (growing degree days >5C)", value = FALSE),
                checkboxInput(ns("gd_chelsa_gdd10"), "GDD10 (growing degree days >10C)", value = FALSE),
                checkboxInput(ns("gd_chelsa_gsl"), "GSL (growing season length)", value = FALSE),
                checkboxInput(ns("gd_chelsa_fcf"), "FCF (frost change frequency)", value = FALSE),
                checkboxInput(ns("gd_chelsa_npp"), "NPP (net primary productivity)", value = FALSE),
                checkboxInput(ns("gd_chelsa_scd"), "SCD (snow cover days)", value = FALSE),
                br(),
                actionButton(ns("gd_download_chelsa"), "Download selected extras", icon = icon("download"), class = "btn-outline-primary btn-sm")
              )
            )
          )
        ),

        # Section 2: Climate — Future CMIP6
        tags$details(
          class = "control-section",
          tags$summary(
            class = "gd-section-summary",
            span(class = "gd-section-icon", "🗺"),
            "Climate — Future (CMIP6)"
          ),
          div(
            class = "gd-section-body",
            fluidRow(
              column(
                5,
                h5("Downloaded scenarios"),
                uiOutput(ns("gd_cmip6_scenarios")),
                hr(),
                actionButton(ns("gd_verify_future"), "Refresh scenarios", icon = icon("refresh"), class = "btn-outline-primary btn-sm")
              ),
              column(
                7,
                h5("Download new scenario"),
                fluidRow(
                  column(
                    4,
                    selectInput(ns("gd_cmip6_gcm"), "GCM",
                      choices = c(
                        "UKESM1-0-LL (UK)" = "UKESM1-0-LL",
                        "MPI-ESM1-2-HR (Germany)" = "MPI-ESM1-2-HR",
                        "IPSL-CM6A-LR (France)" = "IPSL-CM6A-LR",
                        "MRI-ESM2-0 (Japan)" = "MRI-ESM2-0",
                        "GFDL-ESM4 (USA)" = "GFDL-ESM4"
                      ),
                      selected = "UKESM1-0-LL"
                    )
                  ),
                  column(
                    4,
                    selectInput(ns("gd_cmip6_ssp"), "SSP",
                      choices = c(
                        "SSP1-2.6 (Low emissions)" = "SSP1-2.6",
                        "SSP2-4.5 (Intermediate)" = "SSP2-4.5",
                        "SSP3-7.0 (High emissions)" = "SSP3-7.0",
                        "SSP5-8.5 (Very high)" = "SSP5-8.5"
                      ),
                      selected = "SSP2-4.5"
                    )
                  ),
                  column(
                    4,
                    selectInput(ns("gd_cmip6_period"), "Period",
                      choices = c(
                        "2021-2040 (Near)" = "2021-2040",
                        "2041-2060 (Mid century)" = "2041-2060",
                        "2061-2080 (End century)" = "2061-2080",
                        "2081-2100 (Long term)" = "2081-2100"
                      ),
                      selected = "2041-2060"
                    )
                  )
                ),
                br(),
                actionButton(ns("gd_download_cmip6"), "Download scenario", icon = icon("download"), class = "btn-outline-primary btn-sm"),
                hr(),
                h6("Average multiple GCMs"),
                p(class = "small-muted", "Creates an ensemble average of selected GCMs for a given SSP and period. Outputs a blended future climate layer."),
                fluidRow(
                  column(
                    8,
                    selectInput(ns("gd_cmip6_avg_gcms"), "GCMs to average",
                      choices = c("UKESM1-0-LL", "MPI-ESM1-2-HR", "IPSL-CM6A-LR", "MRI-ESM2-0", "GFDL-ESM4"),
                      selected = character(0),
                      multiple = TRUE,
                      selectize = TRUE
                    )
                  ),
                  column(
                    4,
                    br(),
                    actionButton(ns("gd_average_gcms"), "Average GCMs", icon = icon("calculator"), class = "btn-outline-primary btn-sm")
                  )
                )
              )
            )
          )
        ),

        # Section 3: Terrain & Soil
        tags$details(
          class = "control-section",
          tags$summary(
            class = "gd-section-summary",
            span(class = "gd-section-icon", "⛰"),
            "Terrain & Soil"
          ),
          div(
            class = "gd-section-body",
            fluidRow(
              column(
                6,
                h5("Elevation (OpenTopography)"),
                uiOutput(ns("gd_elevation_status")),
                selectInput(ns("gd_demtype"), "DEM type",
                  choices = c(
                    "Copernicus 90m" = "COP90",
                    "SRTM GL 90m" = "SRTMGL3",
                    "Copernicus 30m" = "COP30",
                    "SRTM GL 30m" = "SRTMGL1",
                    "NASA DEM" = "NASADEM",
                    "ALOS World 3D 30m" = "AW3D30"
                  ),
                  selected = "COP90"
                ),
                passwordInput(ns("gd_opentopo_key"), "OpenTopography API key",
                  placeholder = "Get from OpenTopography.org"
                ) %>% tagAppendAttributes(autocomplete = "new-password"),
                p(class = "small-muted",
                  "API key required. Get a free key at ",
                  tags$a(href = "https://opentopography.org", target = "_blank", "opentopography.org")
                ),
                actionButton(ns("gd_download_elevation"), "Download elevation tiles", icon = icon("download"), class = "btn-outline-primary btn-sm")
              ),
              column(
                6,
                h5("SoilGrids (ISRIC)"),
                uiOutput(ns("gd_soil_status")),
                fluidRow(
                  column(
                    6,
                    h6("Select variables:"),
                    checkboxInput(ns("gd_soil_bdod"), "Bulk density (BDOD)", value = FALSE),
                    checkboxInput(ns("gd_soil_clay"), "Clay content", value = FALSE),
                    checkboxInput(ns("gd_soil_soc"), "Soil organic carbon (SOC)", value = FALSE),
                    checkboxInput(ns("gd_soil_phh2o"), "pH in H2O", value = FALSE),
                    checkboxInput(ns("gd_soil_sand"), "Sand content", value = FALSE)
                  ),
                  column(
                    6,
                    h6("Select depths:"),
                    checkboxGroupInput(ns("gd_soil_depths"),
                      label = NULL,
                      choices = c(
                        "0-5cm" = "5", "5-15cm" = "15", "15-30cm" = "30",
                        "30-60cm" = "60", "60-100cm" = "100", "100-200cm" = "200"
                      ),
                      selected = character(0)
                    )
                  )
                ),
                actionButton(ns("gd_download_soil"), "Download selected soil layers", icon = icon("download"), class = "btn-outline-primary btn-sm")
              )
            )
          )
        ),

        # Section 4: Environmental Layers
        tags$details(
          class = "control-section",
          tags$summary(
            class = "gd-section-summary",
            span(class = "gd-section-icon", "🌿"),
            "Environmental Layers"
          ),
          div(
            class = "gd-section-body",
            fluidRow(
              column(
                4,
                h5("UV-B Radiation (glUV)"),
                uiOutput(ns("gd_uv_status")),
                actionButton(ns("gd_download_uv"), "Download UV-B layers", icon = icon("download"), class = "btn-outline-primary btn-sm")
              ),
              column(
                4,
                h5("Vegetation (GIMMS NDVI/EVI)"),
                uiOutput(ns("gd_vegetation_status")),
                actionButton(ns("gd_download_vegetation"), "Download GIMMS NDVI", icon = icon("download"), class = "btn-outline-primary btn-sm"),
                p(class = "small-muted", "LAI/GPP require Google Earth Engine (rgee)")
              ),
              column(
                4,
                h5("LULC (MODIS MCD12Q1)"),
                uiOutput(ns("gd_lulc_status")),
                selectInput(ns("gd_lulc_year"), "Year to download",
                  choices = 2001:2023, selected = 2020
                ),
                actionButton(ns("gd_download_lulc"), "Download LULC year", icon = icon("download"), class = "btn-outline-primary btn-sm")
              )
            ),
            hr(),
            fluidRow(
              column(
                4,
                h5("Human Footprint (WCS)"),
                uiOutput(ns("gd_hfp_status")),
                selectInput(ns("gd_hfp_year"), "Year to download",
                  choices = 2001:2020, selected = 2020
                ),
                actionButton(ns("gd_download_hfp"), "Download HFP year", icon = icon("download"), class = "btn-outline-primary btn-sm")
              ),
              column(
                4,
                h5("Drought Index (CRU scPDSI)"),
                uiOutput(ns("gd_drought_status")),
                checkboxGroupInput(ns("gd_drought_periods"),
                  label = NULL,
                  choices = c(
                    "Annual mean" = "annual_mean",
                    "Wet season (Dec-Feb)" = "wet_season",
                    "Dry season (Jun-Aug)" = "dry_season"
                  ),
                  selected = character(0)
                ),
                actionButton(ns("gd_download_drought"), "Download drought layers", icon = icon("download"), class = "btn-outline-primary btn-sm")
              ),
              column(
                4,
                h5("Bioclimatic Seasonality"),
                uiOutput(ns("gd_bioclime_status")),
                actionButton(ns("gd_download_bioclime"), "Download seasonality", icon = icon("download"), class = "btn-outline-primary btn-sm"),
                p(class = "small-muted", "GDD5, GDD10, Moisture Index from WorldClim monthly data")
              )
            )
          )
        ),

        # Section 5: Quick Actions
        tags$details(
          class = "control-section",
          tags$summary(
            class = "gd-section-summary",
            span(class = "gd-section-icon", "⚡"),
            "Quick Actions"
          ),
          div(
            class = "gd-section-body",
            fluidRow(
              column(
                4,
                h5("Covariate cache summary"),
                uiOutput(ns("gd_cache_summary")),
                hr(),
                actionButton(ns("gd_verify_all"), "Refresh all status", icon = icon("refresh"), class = "btn-outline-primary btn-sm")
              ),
              column(
                4,
                h5("Cache management"),
                uiOutput(ns("gd_cache_size")),
                hr(),
                actionButton(ns("gd_clear_cache"), "Clear covariate cache", icon = icon("trash"), class = "btn-danger btn-sm"),
                p(class = "small-muted", "Removes all cached covariate rasters. Re-download required on next run.")
              ),
              column(
                4,
                h5("Auth & utilities"),
                uiOutput(ns("gd_gee_status")),
                actionButton(ns("gd_gee_check"), "Check GEE auth status", icon = icon("key"), class = "btn-outline-secondary btn-sm"),
                hr(),
                p(class = "small-muted", "GEE required for LULC, vegetation LAI/GPP, and some advanced layers.")
              )
            )
          )
        )
      )
    ),

    # Right sidebar: Activity Log
    column(
      2,
      div(
        class = "content-card gd-terminal-card",
        div(
          class = "gd-terminal-header",
          h4("Activity Log"),
          actionLink(ns("gd_clear_log"), "Clear log", class = "btn-outline-secondary btn-sm")
        ),
        div(
          class = "scrollable-log gd-log-box",
          htmlOutput(ns("gd_unified_log_styled"))
        )
      )
    )
  )
}
