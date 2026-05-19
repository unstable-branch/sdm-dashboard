ui_sidebar_controls <- function() {
  safe_numeric <- function(x, default = 1) {
    if (is.null(x) || length(x) == 0 || !is.finite(x)) default else x
  }
  div(
    class = "control-scroll",
    div(
      class = "control-section",
      h4("Input data"),
      textInput("species", "Species/model label", value = sdm_initial_species),
      radioButtons("data_source", "Observation record source",
        choices = stats::setNames(c("upload", "gbif", "project", "demo"), c("Upload file", "GBIF", paste0("Project ", sdm_default_occurrence_file), "Synthetic demo")),
        selected = if (file.exists(sdm_default_occurrence_file)) "project" else "demo"
      ),
      conditionalPanel("input.data_source == 'upload'", fileInput("occ_file", "Observation record CSV/TSV/DwC-A", accept = c(".csv", ".tsv", ".txt", ".zip"))),
      uiOutput("occ_format_detected"),
      conditionalPanel(
        "input.data_source == 'upload' && output.is_dwca === true",
        textInput("dwca_species_filter", "Filter to species (optional)",
          placeholder = "e.g., Acacia mearnsii"
        ),
        numericInput("dwca_max_uncertainty", "Max coordinate uncertainty (m)",
          value = .Machine$double.xmax, min = 0
        ),
        checkboxGroupInput("dwca_basis_filter", "Basis of record to include",
          choices = c(
            "Human observation" = "HUMAN_OBSERVATION",
            "Machine observation" = "MACHINE_OBSERVATION",
            "Preserved specimen" = "PRESERVED_SPECIMEN",
            "Literature" = "LITERATURE",
            "Occurrence" = "OCCURRENCE"
          ),
          selected = c("HUMAN_OBSERVATION", "MACHINE_OBSERVATION", "PRESERVED_SPECIMEN", "LITERATURE")
        )
      ),
      conditionalPanel(
        "input.data_source == 'gbif'",
        textInput("gbif_taxon", "Species name", placeholder = "e.g., Acacia mearnsii"),
        textInput("gbif_country", "Country filter (optional)", placeholder = "e.g., AU"),
        numericInput("gbif_max_records", "Max records to fetch", value = 100, min = 10, max = 10000),
        actionButton("fetch_gbif", "Fetch from GBIF"),
        tags$details(
          tags$summary("Use GBIF API token for unlimited access"),
          p(
            "Get a free token at ",
            a("gbif.org/user/settings", href = "https://www.gbif.org/user/settings", target = "_blank")
          ),
          textInput("gbif_token", "GBIF API token (optional)"),
          p(class = "small-muted", "Tokens allow downloading >10,000 records and capture DOI for reproducibility")
        ),
        uiOutput("gbif_status")
      ),
      uiOutput("occurrence_source_status"),
      div(class = "small-muted", "If the selected source is unavailable, the app falls back to project data, then demo data when possible."),
      div(class = "action-parent", actionButton("run_cc", "Run Advanced Cleaning", class = "btn-outline-secondary btn-sm", width = "100%")),
      uiOutput("cc_run_status"),
      selectInput("cc_tests", "CC tests to run",
        choices = c(
          "All tests" = "all", "Sea only" = "sea", "Capitals only" = "capitals",
          "Institutions only" = "institutions", "Centroids only" = "centroids",
          "Urban only" = "urban", "Zero only" = "zero"
        ),
        selected = "all"
      ),
      div(class = "checkbox-parent", checkboxInput("batch_mode", "Run batch of multiple species", value = FALSE)),
      conditionalPanel(
        "input.batch_mode == true",
        div(
          class = "batch-controls",
          p(class = "small-muted", "Upload a CSV with one row per species."),
          fileInput("batch_config_file", "Batch config CSV", accept = c(".csv", ".tsv")),
          div(
            class = "small-muted batch-template",
            "Required: species, occurrences_csv | Optional: model_id, biovars, worldclim_dir, cv_folds...",
            tags$a("Download template", href = "#", onclick = "Shiny.setInputValue('batch_download_template', Date.now())")
          ),
          numericInput("batch_n_cores", "Parallel workers",
            value = default_cores, min = 1, max = detect_available_cores(TRUE), step = 1
          ),
          div(
            class = "batch-action",
            actionButton("batch_run", "Run batch", class = "btn-primary btn-sm"),
            actionButton("batch_cancel", "Cancel", class = "btn-outline-secondary btn-sm")
          ),
          uiOutput("batch_progress_ui")
        )
      )
    ),
    div(
      class = "control-section",
      h4("Climate & BIO variables"),
      textInput("worldclim_dir", "WorldClim folder", value = sdm_default_worldclim_dir),
      selectInput("worldclim_res", "WorldClim resolution", choices = c("10 arc-min" = "10", "5 arc-min" = "5", "2.5 arc-min" = "2.5"), selected = as.character(sdm_default_worldclim_res)),
      checkboxInput("download_worldclim", "Auto-download missing BIO layers", value = TRUE),
      div(class = "small-muted", "Select at least 2 climate variables."),
      selectInput("climate_source", "Climate data source", choices = c("WorldClim" = "worldclim", "CHELSA" = "chelsa"), selected = sdm_default_climate_source),
      conditionalPanel(
        "input.climate_source == 'chelsa'",
        checkboxGroupInput("chelsa_extras", "CHELSA bioclim-plus variables",
          choices = c(
            "GDD5" = "gdd5", "GDD10" = "gdd10", "Growing season length" = "gsl",
            "Frost change frequency" = "fcf", "NPP" = "npp", "Snow cover days" = "scd"
          ),
          selected = NULL
        ),
        div(class = "small-muted", "CHELSA bioclim-plus: gdd5/10 (growing degree days), gsl, fcf, npp, scd. Downloaded automatically when selected.")
      ),
      checkboxGroupInput("biovars", NULL, choices = biovar_choices, selected = as.character(sdm_default_biovars))
    ),
    tags$details(
      class = "control-section",
      tags$summary("Optional covariates"),
      div(
        class = "details-body",
        div(class = "checkbox-parent", checkboxInput("use_elevation", "Add elevation from OpenTopography", value = FALSE)),
        conditionalPanel(
          "input.use_elevation == true",
          selectInput("elevation_demtype", "Elevation DEM", choices = opentopo_dem_choices, selected = sdm_default_elevation_demtype),
          tagAppendAttributes(passwordInput("opentopo_api_key", "OpenTopography API key (optional)", value = ""), autocomplete = "new-password"),
          div(class = "small-muted", "Leave blank to use OPENTOPOGRAPHY_API_KEY from your environment. Keys are not saved in outputs."),
          div(class = "small-muted", "Terrain derivatives (TRI, slope, aspect, curvature) are computed automatically from the DEM.")
        ),
        div(class = "checkbox-parent", checkboxInput("use_soil", "Add SoilGrids covariates", value = FALSE)),
        conditionalPanel(
          "input.use_soil == true",
          checkboxGroupInput("soil_vars", "Soil variables",
            choices = c(
              "Bulk density" = "bdod", "Coarse fragments" = "cfvo", "Clay content" = "clay",
              "Nitrogen" = "nitrogen", "Soil organic carbon" = "soc", "pH (water)" = "phh2o",
              "Sand content" = "sand", "Silt content" = "silt", "CEC" = "cec"
            ),
            selected = sdm_default_soil_vars
          ),
          checkboxGroupInput("soil_depths", "Depths",
            choices = c("0-5cm" = "0-5cm", "5-15cm" = "5-15cm", "15-30cm" = "15-30cm", "30-60cm" = "30-60cm", "60-100cm" = "60-100cm", "100-200cm" = "100-200cm"),
            selected = c("0-5cm", "30-60cm")
          ),
          div(class = "small-muted", "SoilGrids (ISRIC) variables downloaded on demand. SoilGrids uses WGS84; reprojection happens automatically.")
        ),
        div(class = "checkbox-parent", checkboxInput("use_uv", "Add UV-B covariates (glUV)", value = FALSE)),
        conditionalPanel(
          "input.use_uv == true",
          checkboxGroupInput("uv_vars", "UV-B variables",
            choices = c(
              "UVB1 Annual Mean" = "UVB1", "UVB2 Seasonality" = "UVB2",
              "UVB3 Highest Month" = "UVB3", "UVB4 Lowest Month" = "UVB4",
              "UVB5 Highest Quarter" = "UVB5", "UVB6 Lowest Quarter" = "UVB6"
            ),
            selected = sdm_default_uv_vars
          ),
          checkboxGroupInput("uv_months", "Monthly UV-B",
            choices = c(
              "January" = "January", "February" = "February", "March" = "March",
              "April" = "April", "May" = "May", "June" = "June",
              "July" = "July", "August" = "August", "September" = "September",
              "October" = "October", "November" = "November", "December" = "December"
            ),
            selected = NULL
          ),
          div(class = "small-muted", "glUV (UFZ) UV-B radiation layers. 15 arc-min resolution, WGS84. Downloaded on demand from UFZ archive.")
        ),
        div(class = "checkbox-parent", checkboxInput("use_vegetation", "Add vegetation productivity indices", value = FALSE)),
        conditionalPanel(
          "input.use_vegetation == true",
          numericInput("veg_year", "Year",
            value = sdm_default_veg_year,
            min = 2000, max = as.integer(format(Sys.Date(), "%Y")) - 1,
            step = 1
          ),
          checkboxGroupInput("veg_products", "Products to include",
            choices = c(
              "NDVI annual mean (250m → 2.5amin)" = "ndvi_annual_mean",
              "NDVI peak greenness (annual max)" = "ndvi_annual_max",
              "NDVI long-term mean 2001-2024 (climatology)" = "ndvi_gimms_clim",
              "EVI coarse (~8km, no year)" = "evi",
              "LAI — Leaf Area Index (GEE, 500m, requires auth)" = "lai",
              "GPP — Gross Primary Production (GEE, 1km, requires auth)" = "gpp",
              "NDVI January" = "jan", "NDVI February" = "feb",
              "NDVI March" = "mar", "NDVI April" = "apr",
              "NDVI May" = "may", "NDVI June" = "jun",
              "NDVI July" = "jul", "NDVI August" = "aug",
              "NDVI September" = "sep", "NDVI October" = "oct",
              "NDVI November" = "nov", "NDVI December" = "dec"
            ),
            selected = "ndvi_annual_mean"
          ),
          div(
            class = "small-muted",
            "NDVI/EVI via GIMMS NASA (no auth needed). LAI/GPP require GEE authentication:",
            " run rgee::ee_initialize() once in R, or set up a service account.",
            " LAI/GPP download uses Google Drive as intermediate storage.",
            " All layers aggregated to ~2.5 arc-min to match climate covariates."
          )
        ),
        div(class = "checkbox-parent", checkboxInput("use_lulc", "Add LULC fractional covariates (MODIS)", value = FALSE)),
        conditionalPanel(
          "input.use_lulc == true",
          selectInput("lulc_year", "LULC year",
            choices = as.character(2001:2023),
            selected = "2020"
          ),
          div(class = "small-muted", "MODIS MCD12Q1 IGBP classification, fractional layers (forest, cropland, urban, etc.). 500m, aggregated to 2.5 arc-min.")
        ),
        div(class = "checkbox-parent", checkboxInput("use_hfp", "Add Human Footprint covariate", value = FALSE)),
        conditionalPanel(
          "input.use_hfp == true",
          selectInput("hfp_year", "Human Footprint year",
            choices = as.character(2001:2020),
            selected = "2020"
          ),
          div(class = "small-muted", "WCS Human Footprint (Vizzuality/WCS). 300m, aggregated to 2.5 arc-min. Direct download from Google Cloud.")
        ),
        div(class = "checkbox-parent", checkboxInput("use_bioclim_season", "Add bioclimatic seasonality (GDD, Moisture Index)", value = FALSE)),
        conditionalPanel(
          "input.use_bioclim_season == true",
          div(class = "small-muted", "GDD5, GDD10 (growing degree days), and Moisture Index (P/PET) derived from WorldClim monthly TMIN/TMAX/PREC. No extra download — computed from existing monthly climate data.")
        ),
        div(class = "checkbox-parent", checkboxInput("use_drought", "Add drought index (scPDSI)", value = FALSE)),
        conditionalPanel(
          "input.use_drought == true",
          checkboxGroupInput("drought_periods", "Drought periods",
            choices = c(
              "Annual mean" = "annual_mean",
              "Wet season (Dec-Feb)" = "wet_season",
              "Dry season (Jun-Aug)" = "dry_season"
            ),
            selected = "annual_mean"
          ),
          div(class = "small-muted", "CRU scPDSI (Palmer Drought Severity Index) at 0.5 deg resolution (coarser than climate layers). Downloaded from CRU.")
        )
      )
    ),
    tags$details(
      class = "control-section",
      tags$summary("Model settings"),
      div(
        class = "details-body",
        uiOutput("esm_recommendation"),
        selectInput("model_id", "Model backend", choices = sdm_model_choices(), selected = sdm_default_model_id),
        uiOutput("maxnet_install_hint"),
        conditionalPanel(
          "input.model_id == 'maxnet'",
          selectInput("maxnet_features", "MaxEnt features",
            choices = c(
              "Linear" = "l", "Linear + Quadratic" = "lq",
              "Linear + Quadratic + Product" = "lqp",
              "Linear + Quadratic + Hinge" = "lqh",
              "All" = "lqpht"
            ),
            selected = "lqp"
          ),
          numericInput("maxnet_regmult", "Regularization multiplier",
            value = 1.0, min = 0.1, max = 10, step = 0.1
          )
        ),
        div(class = "small-muted", "Rangebagging is experimental; GLM remains the stable default."),
        conditionalPanel(
          "input.model_id == 'biomod2'",
          checkboxGroupInput("biomod2_models", "biomod2 algorithms",
            choices = c("GLM" = "GLM", "GAM" = "GAM", "MaxEnt (MAXNET)" = "MAXNET", "Random Forest" = "RF"),
            selected = c("GLM", "MAXNET", "RF")
          ),
          checkboxInput("biomod2_ensemble", "Build ensemble forecast", value = TRUE),
          div(class = "small-muted", "Note: biomod2 backend requires options(sdm.enable_biomod2 = TRUE) and restart.")
        ),
        uiOutput("biomod2_install_hint"),
        conditionalPanel(
          "input.model_id == 'multi_ensemble'",
          tags$strong("Standalone models"),
          checkboxGroupInput("multi_ensemble_standalone", NULL,
            choices = c("GLM" = "glm", "Rangebagging" = "rangebag"),
            selected = "glm"
          ),
          tags$strong("biomod2 algorithms"),
          checkboxGroupInput("multi_ensemble_biomod2", NULL,
            choices = c(
              "GAM" = "GAM", "FDA" = "FDA", "MARS" = "MARS",
              "Random Forest" = "RF", "GBM" = "GBM", "BRT" = "BRT",
              "MaxEnt (MAXNET)" = "MAXNET", "SRE" = "SRE", "CTA" = "CTA",
              "XGBoost" = "XGBOOST"
            ),
            selected = c("RF", "MAXNET")
          ),
          selectInput("multi_ensemble_weighting", "Ensemble weighting",
            choices = c("Equal average" = "equal", "AUC-weighted" = "auc", "TSS-weighted" = "tss"),
            selected = "auc"
          ),
          sliderInput("multi_ensemble_power", "Weight emphasis (power):",
            min = 1, max = 5, value = sdm_default_ensemble_power, step = 0.5
          ),
          div(class = "small-muted", "Higher values give more weight to better-performing models."),
          numericInput("multi_ensemble_min_auc", "Minimum AUC to include:",
            value = sdm_default_ensemble_min_auc, min = 0.5, max = 1.0, step = 0.05
          ),
          numericInput("multi_ensemble_min_tss", "Minimum TSS to include:",
            value = sdm_default_ensemble_min_tss, min = 0.0, max = 1.0, step = 0.05
          ),
          checkboxInput("multi_ensemble_export", "Export individual model rasters", value = TRUE),
          uiOutput("multi_ensemble_validation"),
          div(class = "small-muted", "Select at least 2 models. biomod2 requires options(sdm.enable_biomod2 = TRUE).")
        ),
        conditionalPanel(
          "input.model_id == 'esm_glm' || input.model_id == 'esm_maxnet'",
          tags$details(
            tags$summary("Advanced ESM settings"),
            numericInput("esm_n_runs", "Evaluation runs",
              value = sdm_esm_default_n_runs, min = 3, max = 20, step = 1
            ),
            numericInput("esm_split", "Train / test split (%)",
              value = sdm_esm_default_split, min = 50, max = 90, step = 5
            ),
            numericInput("esm_min_auc", "Min AUC (bivariate filter)",
              value = sdm_esm_default_min_auc, min = 0.5, max = 0.95, step = 0.05
            ),
            selectInput("esm_weighting_metric", "Weighting metric",
              choices = c("AUC" = "AUC", "TSS" = "TSS"),
              selected = "AUC", selectize = FALSE
            ),
            numericInput("esm_power", "Weight exponent",
              value = sdm_esm_default_power, min = 0.5, max = 5, step = 0.5
            )
          ),
          uiOutput("esm_complexity_warning")
        ),
        numericInput("background_n", "Background points", value = sdm_default_background_n, min = 500, max = 100000, step = 500),
        checkboxInput("quadratic", "Include quadratic climate responses", value = TRUE),
        selectInput("cv_folds", "Cross-validation", choices = c("Off" = "0", "3-fold" = "3", "5-fold" = "5"), selected = as.character(sdm_default_cv_folds)),
        selectInput("cv_strategy", "CV strategy", choices = c("Random" = "random", "Spatial blocks" = "spatial_blocks"), selected = sdm_default_cv_strategy),
        conditionalPanel(
          "input.cv_strategy == 'spatial_blocks'",
          numericInput("cv_block_size_km", "Spatial block size (km)",
            value = if (is.na(sdm_default_cv_block_size_km)) 50 else sdm_default_cv_block_size_km,
            min = 1, max = 500, step = 1
          ),
          div(class = "small-muted", "Auto-estimated if left at default.")
        ),
        numericInput("n_cores", "CPU cores for compile/predict/CV", value = safe_numeric(default_cores, 1), min = 1, max = safe_numeric(detect_available_cores(TRUE), 4), step = 1),
        div(class = "small-muted", "Also sets MAKEFLAGS=-jN for source package compilation."),
        numericInput("aggregation_factor", "Raster aggregation for speed (1 = native)", value = sdm_default_aggregation_factor, min = 1, max = 8, step = 1)
      )
    ),
    div(
      class = "control-section",
      h4("Projection"),
      selectInput("extent_preset", "Projection extent", choices = sdm_extent_choices, selected = sdm_default_extent_preset),
      conditionalPanel(
        "input.extent_preset == 'custom'",
        fluidRow(column(6, numericInput("xmin", "xmin", sdm_default_projection_extent[1])), column(6, numericInput("xmax", "xmax", sdm_default_projection_extent[2]))),
        fluidRow(column(6, numericInput("ymin", "ymin", sdm_default_projection_extent[3])), column(6, numericInput("ymax", "ymax", sdm_default_projection_extent[4])))
      ),
      conditionalPanel(
        "input.extent_preset == 'boundary_file'",
        fileInput("boundary_shp", "Upload boundary shapefile or GeoJSON",
          accept = c(".shp", ".shx", ".dbf", ".prj", ".geojson", ".json"),
          multiple = FALSE
        ),
        div(class = "small-muted", "Upload a polygon boundary file to define the projection extent automatically. The bounding box of the geometry is used.")
      ),
      div(class = "checkbox-parent", checkboxInput("future_projection", "Project a future climate scenario", value = FALSE)),
      conditionalPanel(
        "input.future_projection == true",
        uiOutput("future_scenario_selector"),
        textInput("future_label", "Scenario label", value = "Future climate"),
        uiOutput("future_download_status")
      ),
      sliderInput("threshold", "High-suitability threshold", min = 0.05, max = 0.95, value = sdm_default_threshold, step = 0.05)
    ),
    tags$details(
      class = "control-section",
      tags$summary("Advanced settings"),
      div(
        class = "details-body",
        checkboxInput("vif_reduction", "Drop collinear covariates (VIF > 10)", value = FALSE),
        checkboxInput("thin_by_cell", "Thin duplicate records in same climate cell", value = TRUE),
        checkboxInput("merge_small_sources", "Merge small occurrence sources", value = TRUE),
        numericInput("min_source_records", "Merge sources with fewer than", value = sdm_default_min_source_records, min = 1, max = 100, step = 1),
        selectInput("bias_method", "Background sampling bias correction",
          choices = c(
            "Uniform random (default)" = "uniform",
            "Target-group (requires related species CSV)" = "target_group",
            "Thickened (concentrate around presences)" = "thickened"
          )
        ),
        conditionalPanel(
          "input.bias_method == 'target_group'",
          fileInput("target_group_file", "Upload related species occurrences (CSV)", accept = c(".csv"))
        ),
        conditionalPanel(
          "input.bias_method == 'thickened'",
          numericInput("thickening_distance_km", "Kernel distance (km)", value = 10, min = 1, max = 100)
        )
      )
    ),
    ui_advanced_modal(),
    div(
      class = "run-button-wrap",
      actionButton("run_model", "Run SDM", class = "btn-primary btn-lg", width = "100%"),
      div(style = "margin-top: 6px;", actionButton("cancel_model", "Cancel", class = "btn-outline-secondary btn-sm", width = "100%"))
    )
  )
}

ui_advanced_modal <- function() {
  tags$div(id = "advanced-modal-placeholder")
}
