ui_sidebar_controls <- function() {
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
      choices = stats::setNames(c("upload", "gbif", "project", "demo"), c("Upload file", "GBIF", paste0("Project ", sdm_default_occurrence_file), "Synthetic demo")),
      selected = if (file.exists(sdm_default_occurrence_file)) "project" else "demo"
    ),
    conditionalPanel("input.data_source == 'upload'", fileInput("occ_file", "Observation record CSV/TSV", accept = c(".csv", ".tsv", ".txt"))),
    conditionalPanel("input.data_source == 'gbif'",
      textInput("gbif_taxon", "Species name", placeholder = "e.g., Acacia mearnsii"),
      textInput("gbif_country", "Country filter (optional)", placeholder = "e.g., AU"),
      numericInput("gbif_max_records", "Max records to fetch", value = 100, min = 10, max = 10000),
      actionButton("fetch_gbif", "Fetch from GBIF"),
      tags$details(
        tags$summary("Use GBIF API token for unlimited access"),
        p("Get a free token at ",
          a("gbif.org/user/settings", href = "https://www.gbif.org/user/settings", target = "_blank")),
        textInput("gbif_token", "GBIF API token (optional)"),
        p(class = "small-muted", "Tokens allow downloading >10,000 records and capture DOI for reproducibility")
      ),
      uiOutput("gbif_status")
    ),
    uiOutput("occurrence_source_status"),
    div(class = "small-muted", "If the selected source is unavailable, the app falls back to project data, then demo data when possible."),
    checkboxInput("use_coordinatecleaner", "Advanced cleaning (CoordinateCleaner)"),
    conditionalPanel("input.use_coordinatecleaner == true",
      p(class = "small-muted",
        "Flags: sea coordinates, biodiversity institutions, capital cities,",
        "country centroids, urban areas, zero coordinates."),
      actionButton("view_flagged", "View flagged records (opens in table)")
    )
  ),
  div(class = "control-section",
    h4("Climate data"),
    textInput("worldclim_dir", "WorldClim folder", value = sdm_default_worldclim_dir),
    checkboxInput("download_worldclim", "Download missing WorldClim/elevation layers", value = TRUE),
    selectInput("worldclim_res", "WorldClim resolution", choices = c("10 arc-min" = "10", "5 arc-min" = "5", "2.5 arc-min" = "2.5"), selected = as.character(sdm_default_worldclim_res)),
    selectInput("climate_source", "Climate data source", choices = c("WorldClim" = "worldclim", "CHELSA" = "chelsa"), selected = sdm_default_climate_source)
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
      conditionalPanel("input.model_id == 'biomod2'",
        checkboxGroupInput("biomod2_models", "biomod2 algorithms",
          choices = c("GLM" = "GLM", "GAM" = "GAM", "MaxEnt (MAXNET)" = "MAXNET", "Random Forest" = "RF"),
          selected = c("GLM", "MAXNET", "RF")),
        checkboxInput("biomod2_ensemble", "Build ensemble forecast", value = TRUE),
        div(class = "small-muted", "Note: biomod2 backend requires options(sdm.enable_biomod2 = TRUE) and restart.")
      ),
      numericInput("background_n", "Background points", value = sdm_default_background_n, min = 500, max = 100000, step = 500),
      numericInput("min_source_records", "Merge sources with fewer than", value = sdm_default_min_source_records, min = 1, max = 100, step = 1),
      checkboxInput("thin_by_cell", "Thin duplicate records in the same climate cell", value = TRUE),
      checkboxInput("quadratic", "Include quadratic climate responses", value = TRUE),
      checkboxInput("vif_reduction", "Drop collinear covariates (VIF > 10)", value = FALSE),
      selectInput("cv_folds", "Cross-validation", choices = c("Off" = "0", "3-fold" = "3", "5-fold" = "5"), selected = as.character(sdm_default_cv_folds)),
      numericInput("n_cores", "CPU cores for compile/predict/CV", value = default_cores, min = 1, max = detect_available_cores(TRUE), step = 1),
      div(class = "small-muted", "Also sets MAKEFLAGS=-jN for source package compilation."),
      numericInput("aggregation_factor", "Raster aggregation for speed (1 = native)", value = sdm_default_aggregation_factor, min = 1, max = 8, step = 1),
      selectInput("bias_method", "Background sampling bias correction",
        choices = c("Uniform random (default)" = "uniform",
                    "Target-group (requires related species CSV)" = "target_group",
                    "Thickened (concentrate around presences)" = "thickened")),
      conditionalPanel("input.bias_method == 'target_group'",
        fileInput("target_group_file", "Upload related species occurrences (CSV)",
          accept = c(".csv")),
        div(class = "small-muted", "One record per row with longitude and latitude columns.")
      ),
      conditionalPanel("input.bias_method == 'thickened'",
        numericInput("thickening_distance_km", "Kernel distance (km)",
          value = 10, min = 1, max = 100)
      )
    )
  ),
  div(class = "control-section",
    h4("Projection"),
    selectInput("extent_preset", "Projection extent", choices = sdm_extent_choices, selected = sdm_default_extent_preset),
    conditionalPanel("input.extent_preset == 'custom'",
      fluidRow(column(6, numericInput("xmin", "xmin", sdm_default_projection_extent[1])), column(6, numericInput("xmax", "xmax", sdm_default_projection_extent[2]))),
      fluidRow(column(6, numericInput("ymin", "ymin", sdm_default_projection_extent[3])), column(6, numericInput("ymax", "ymax", sdm_default_projection_extent[4])))
    )
  ),
  div(class = "control-section",
    h4("Outputs"),
    sliderInput("threshold", "High-suitability threshold", min = 0.05, max = 0.95, value = sdm_default_threshold, step = 0.05),
    checkboxInput("future_projection", "Project a future climate scenario", value = FALSE),
    conditionalPanel("input.future_projection == true",
      textInput("future_worldclim_dir", "Future/CMIP6 BIO folder", value = sdm_default_future_worldclim_dir),
      textInput("future_label", "Scenario label", value = "Future climate"),
      div(class = "small-muted", "Provide future BIO GeoTIFFs with matching BIO variable numbers. The model backend is reused; only climate layers are swapped, while static elevation/soil covariates are reused.")
    )
  ),
  div(class = "run-button-wrap", actionButton("run_model", "Run SDM", class = "btn-primary btn-lg", width = "100%"))
  )
}