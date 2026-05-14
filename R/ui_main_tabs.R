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