mod_get_data_server <- function(id, rv, input) {
  moduleServer(id, function(input, output, session) {

    output$get_data_content <- renderUI({ get_data_tab() })

    gd_append_log <- function(target, msg) {
      cur <- rv[[target]] %||% ""
      rv[[target]] <- paste0(cur, format(Sys.time(), "%H:%M:%S"), " ", msg, "\n")
    }

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
      tagList(div(class = "text-sm", rows))
    })
    outputOptions(output, "gd_cmip6_scenarios", suspendWhenHidden = FALSE)

    observe({
      rv$cmip6_scenarios <- verify_future_cache()
    })

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
        log_target = "gd_env_log", log_append = gd_append_log,
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

  })
}