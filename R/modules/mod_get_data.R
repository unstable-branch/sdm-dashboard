mod_get_data_server <- function(id, rv, input) {
  moduleServer(id, function(input, output, session) {

    output$get_data_content <- renderUI({ get_data_tab(session$ns) })

    gd_append_log <- function(msg) {
      rv$gd_unified_log <- paste0(rv$gd_unified_log %||% "", format(Sys.time(), "%H:%M:%S"), " ", msg, "\n")
    }

    gd_status_dots <- function(v) {
      status <- v$status %||% "unknown"
      cls <- paste0("status-dot-", status)
      span(class = paste("status-dot", cls), title = v$detail %||% "")
    }

    # Non-blocking download state
    gd_download_state <- reactiveVal(NULL)

    gd_download_last_dot <- reactiveVal(-1L)

    gd_progress <- NULL

    gd_start_download <- function(label, download_fun, args = NULL,
                                  verify_fun = NULL, notification_msg = NULL,
                                  timeout_sec = 300, kill_on_timeout = FALSE,
                                  init_engine = TRUE, estimated_sec = 120) {
      current <- gd_download_state()
      if (!is.null(current) && isTRUE(current$bg$is_alive())) {
        gd_append_log("ERROR: A download is already in progress.")
        return(invisible())
      }
      if (!is.null(gd_progress)) {
        gd_progress$close()
        gd_progress <<- NULL
      }
      gd_append_log(paste0("[...] Starting ", label, " download..."))
      gd_progress <<- Progress$new(session, min = 0, max = 1)
      gd_progress$set(message = paste("Downloading", label, "..."), value = 0.05)
      bg <- start_download_bg(download_fun, args = args, init_engine = init_engine)
      gd_download_last_dot(-1L)
      gd_download_state(list(
        bg = bg, label = label, verify_fun = verify_fun,
        notification_msg = notification_msg, timeout_sec = timeout_sec,
        kill_on_timeout = kill_on_timeout, start_time = Sys.time(),
        estimated_sec = estimated_sec
      ))
    }

    # Cache refresh observer — recompute summary, trigger status updates
    observe({
      rv$gd_cache_refresh
      rv$gd_cache_summary <- tryCatch(
        get_data_summary(),
        error = function(e) NULL
      )
    })

    # Non-blocking download poller
    observe({
      handle <- gd_download_state()
      req(handle)
      invalidateLater(1000)

      lines <- tryCatch(handle$bg$read_output(), error = function(e) character(0))
      if (length(lines) > 0) {
        for (ln in lines[nzchar(lines)]) gd_append_log(ln)
      }

      err_lines <- tryCatch(handle$bg$read_error(), error = function(e) character(0))
      if (length(err_lines) > 0) {
        for (ln in err_lines[nzchar(err_lines)]) gd_append_log(ln)
      }

      if (handle$bg$is_alive()) {
        elapsed <- as.numeric(difftime(Sys.time(), handle$start_time, units = "secs"))
        if (elapsed > handle$timeout_sec) {
          if (handle$kill_on_timeout) handle$bg$kill()
          gd_append_log(paste0("ERROR: ", handle$label, " timed out after ", handle$timeout_sec, "s."))
          if (!is.null(gd_progress)) {
            gd_progress$set(value = 1, detail = "Timed out")
            gd_progress$close()
            gd_progress <<- NULL
          }
          gd_download_state(NULL)
          return()
        }
        interval <- floor(elapsed / 10)
        if (interval > gd_download_last_dot()) {
          gd_download_last_dot(interval)
          gd_append_log(paste0("...", handle$label, " still downloading... (", round(elapsed), "s)"))
        }
        if (!is.null(gd_progress)) {
          pct <- min(elapsed / handle$estimated_sec, 0.95)
          gd_progress$set(value = pct, detail = paste(round(elapsed), "s /", handle$estimated_sec, "s"))
        }
        return()
      }

      # Process completed
      last_lines <- tryCatch(handle$bg$read_output(), error = function(e) character(0))
      if (length(last_lines) > 0) for (ln in last_lines[nzchar(last_lines)]) gd_append_log(ln)

      exit_status <- handle$bg$get_exit_status()
      if (!is.null(exit_status) && exit_status != 0) {
        err_lines <- tryCatch(handle$bg$read_error(), error = function(e) character(0))
        if (length(err_lines) > 0) for (ln in err_lines[nzchar(err_lines)]) gd_append_log(paste0("ERROR: ", ln))
        gd_append_log(paste0("ERROR: ", handle$label, " failed (exit ", exit_status, ")."))
        if (!is.null(gd_progress)) {
          gd_progress$set(value = 1, detail = "Failed")
          gd_progress$close()
          gd_progress <<- NULL
        }
      } else {
        gd_append_log(paste0("DONE: ", handle$label, " downloaded successfully."))
        if (!is.null(handle$verify_fun)) {
          v <- handle$verify_fun()
          gd_append_log(paste("Verification:", v$detail))
        }
        if (!is.null(gd_progress)) {
          gd_progress$set(value = 1, detail = "Complete")
          gd_progress$close()
          gd_progress <<- NULL
        }
        if (!is.null(handle$notification_msg)) {
          shiny::showNotification(handle$notification_msg, type = "message", duration = 5)
        }
        rv$gd_cache_refresh <- (rv$gd_cache_refresh %||% 0) + 1
        if (grepl("CMIP6|GCM", handle$label)) {
          rv$cmip6_scenarios <- verify_future_cache()
        }
      }
      gd_download_state(NULL)
    })

    # ---- Status output renderers ----

    make_status_renderer <- function(output_id, verify_fun) {
      output[[output_id]] <- renderUI({
        rv$gd_cache_refresh
        v <- tryCatch(
          verify_fun(),
          error = function(e) list(status = "error", detail = paste("Error:", conditionMessage(e)))
        )
        tagList(gd_status_dots(v), span(class = "small-muted", v$detail))
      })
      outputOptions(output, output_id, suspendWhenHidden = FALSE)
    }

    make_status_renderer("gd_worldclim_status", function() {
      verify_worldclim_cache(sdm_default_worldclim_dir, source = input$gd_climate_source %||% "worldclim")
    })
    make_status_renderer("gd_chelsa_status", function() {
      verify_chelsa_extras_cache(sdm_default_chelsa_extras_dir)
    })
    make_status_renderer("gd_elevation_status", verify_elevation_cache)
    make_status_renderer("gd_soil_status", verify_soil_cache)
    make_status_renderer("gd_uv_status", verify_uv_cache)
    make_status_renderer("gd_vegetation_status", verify_vegetation_cache)
    make_status_renderer("gd_lulc_status", verify_lulc_cache)
    make_status_renderer("gd_hfp_status", verify_hfp_cache)
    make_status_renderer("gd_drought_status", verify_drought_cache)
    make_status_renderer("gd_bioclime_status", verify_bioclim_season_cache)

    output$gd_cmip6_scenarios <- renderUI({
      rv$gd_cache_refresh
      v <- rv$cmip6_scenarios
      if (is.null(v) || isTRUE(v$status != "ok") || nrow(v$scenarios %||% data.frame()) == 0) {
        return(p("No CMIP6 scenarios downloaded yet."))
      }
      rows <- lapply(seq_len(nrow(v$scenarios)), function(i) {
        r <- v$scenarios[i, ]
        div(class = "scenario-row", strong(r$GCM), " / ", r$SSP, " / ", r$Period,
          span(class = "scenario-meta", paste0(r$Files, " files, ", r$SizeMB, " MB")))
      })
      tagList(div(class = "text-sm", rows))
    })
    outputOptions(output, "gd_cmip6_scenarios", suspendWhenHidden = FALSE)

    observe({
      isolate(rv$cmip6_scenarios <- verify_future_cache())
    })

    output$gd_cache_summary <- renderUI({
      s <- rv$gd_cache_summary
      if (is.null(s)) {
        s <- tryCatch(get_data_summary(), error = function(e) NULL)
      }
      if (is.null(s)) return(div(class = "small-muted", "Could not read cache summary."))
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
      s <- rv$gd_cache_summary
      if (is.null(s)) {
        s <- tryCatch(get_data_summary(), error = function(e) NULL)
      }
      mb <- if (is.null(s)) NA_real_ else s$total_covariates_mb
      p(class = "small-muted", paste("Total covariate cache:", round(mb, 1), "MB"))
    })
    outputOptions(output, "gd_cache_size", suspendWhenHidden = FALSE)

    # ---- Unified log styling ----

    output$gd_unified_log_styled <- renderUI({
      log_text <- rv$gd_unified_log %||% ""
      if (!nzchar(log_text)) return(div(class = "gd-log-line", "No activity yet."))
      lines <- strsplit(log_text, "\n")[[1]]
      lines <- lines[nzchar(lines)]
      tags$div(class = "gd-log",
        lapply(lines, function(line) {
          cls <- "gd-log-line"
          if (grepl("^ERROR", line)) {
            cls <- paste(cls, "gd-log-error")
          } else if (grepl("^Warning", line)) {
            cls <- paste(cls, "gd-log-warn")
          } else if (grepl("^NOTE", line)) {
            cls <- paste(cls, "gd-log-note")
          } else if (grepl("^DONE:", line)) {
            cls <- paste(cls, "gd-log-done")
          } else if (grepl("^\\.\\.\\.", line)) {
            cls <- paste(cls, "gd-log-progress-dots")
          }
          div(class = cls, line)
        })
      )
    })

    # ---- Verify handlers ----

    observeEvent(input$gd_verify_worldclim, {
      gd_append_log("Verifying WorldClim files...")
      v <- tryCatch(
        verify_worldclim_cache(sdm_default_worldclim_dir, source = input$gd_climate_source %||% "worldclim"),
        error = function(e) list(detail = paste("Error:", conditionMessage(e)))
      )
      gd_append_log(v$detail)
      if (is.numeric(v$size_mb) && v$size_mb > 0) gd_append_log(paste("Cache size:", round(v$size_mb, 1), "MB"))
      rv$gd_cache_refresh <- (rv$gd_cache_refresh %||% 0) + 1
    })

    observeEvent(input$gd_verify_future, {
      gd_append_log("Scanning CMIP6 scenarios...")
      v <- tryCatch(
        verify_future_cache(),
        error = function(e) list(detail = paste("Error:", conditionMessage(e)), scenarios = NULL)
      )
      rv$cmip6_scenarios <- v
      gd_append_log(v$detail)
      if (!is.null(v$scenarios) && nrow(v$scenarios) > 0) {
        for (i in 1:nrow(v$scenarios)) {
          r <- v$scenarios[i, ]
          gd_append_log(paste(r$GCM, r$SSP, r$Period, "-", r$Files, "files,", r$SizeMB, "MB"))
        }
      }
      rv$gd_cache_refresh <- (rv$gd_cache_refresh %||% 0) + 1
    })

    observeEvent(input$gd_verify_all, {
      gd_append_log("--- Full verification ---")
      s <- tryCatch(get_data_summary(), error = function(e) NULL)
      if (is.null(s)) {
        gd_append_log("ERROR: could not read cache summary")
        return()
      }
      gd_append_log(paste("WorldClim:", s$worldclim$detail))
      gd_append_log(paste("CHELSA extras:", s$chelsa_extras$detail))
      gd_append_log(paste("CMIP6 futures:", s$future$detail))
      gd_append_log(paste("Elevation:", s$elevation$detail))
      gd_append_log(paste("Soil:", s$soil$detail))
      gd_append_log(paste("UV-B:", s$uv$detail))
      gd_append_log(paste("Vegetation:", s$vegetation$detail))
      gd_append_log(paste("LULC:", s$lulc$detail))
      gd_append_log(paste("HFP:", s$hfp$detail))
      gd_append_log(paste("Drought:", s$drought$detail))
      gd_append_log(paste("Bioclim season:", s$bioclim_season$detail))
      gd_append_log(paste("Total cache:", round(s$total_covariates_mb, 1), "MB"))
      rv$gd_cache_refresh <- (rv$gd_cache_refresh %||% 0) + 1
    })

    # ---- GEE check ----

    observeEvent(input$gd_gee_check, {
      rv$gd_gee_cached <- if (requireNamespace("rgee", quietly = TRUE)) {
        tryCatch({
          rgee::ee_check()
          "GEE: authenticated"
        }, error = function(e) paste("GEE:", conditionMessage(e)))
      } else "GEE: rgee not installed"
      gd_append_log(rv$gd_gee_cached)
    })

    output$gd_gee_status <- renderUI({
      rv$gd_cache_refresh
      div(class = "small-muted", rv$gd_gee_cached %||% "GEE: click 'Check GEE auth status' to verify")
    })
    outputOptions(output, "gd_gee_status", suspendWhenHidden = FALSE)

    # ---- Download handlers ----

    observeEvent(input$gd_download_worldclim, {
      source <- input$gd_climate_source %||% "worldclim"
      res <- as.numeric(input$gd_worldclim_res %||% 10)
      gd_start_download(
        label = "WorldClim",
        download_fun = function() {
          source(sdm_resolve_module("covariates_climate.R"))
          load_climate_covariates(
            worldclim_dir = sdm_default_worldclim_dir, selected_biovars = 1:19,
            training_extent = NULL, projection_extent = NULL, aggregation_factor = 1,
            allow_download = TRUE, worldclim_res = res, source = source,
            selected_chelsa_extras = NULL, log_fun = function(...) cat(paste(...), "\n")
          )
          cat("WorldClim download complete.\n")
        },
        verify_fun = function() verify_worldclim_cache(sdm_default_worldclim_dir, source = source),
        timeout_sec = 300, estimated_sec = 120,
        notification_msg = paste0("WorldClim downloaded to ", file.path(sdm_project_root(), sdm_default_worldclim_dir))
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
        gd_append_log("No CHELSA extras selected.")
        return()
      }
      gd_append_log(paste("Downloading CHELSA extras:", paste(extras, collapse = ", ")))
      gd_start_download(
        label = "CHELSA extras",
        download_fun = function(extras) {
          source(sdm_resolve_module("covariates_climate.R"))
          download_chelsa_extras(sdm_default_chelsa_extras_dir, selected_extras = extras, log_fun = function(...) cat(paste(...), "\n"))
          cat("CHELSA extras download complete.\n")
        },
        args = list(extras = extras),
        verify_fun = function() verify_chelsa_extras_cache(sdm_default_chelsa_extras_dir),
        timeout_sec = 300, estimated_sec = 120,
        notification_msg = paste0("CHELSA extras downloaded to ", file.path(sdm_project_root(), sdm_default_chelsa_extras_dir))
      )
    })

    observeEvent(input$gd_download_cmip6, {
      gcm <- input$gd_cmip6_gcm %||% "UKESM1-0-LL"
      ssp <- input$gd_cmip6_ssp %||% "SSP2-4.5"
      period <- input$gd_cmip6_period %||% "2041-2060"
      gd_append_log(paste("Starting CMIP6 download:", gcm, ssp, period, "..."))
      gd_start_download(
        label = "CMIP6",
        download_fun = function(gcm, ssp, period) {
          library(terra)
          source(sdm_resolve_module("covariates_climate_future.R"))
          fetch_cmip6_worldclim(gcm = gcm, ssp = ssp, period = period, var = "bioc", res = 10,
                                 out_dir = sdm_default_future_worldclim_dir, quiet = FALSE)
          cat("CMIP6 download complete.\n")
        },
        args = list(gcm = gcm, ssp = ssp, period = period),
        verify_fun = function() verify_future_cache(),
        timeout_sec = 600, kill_on_timeout = TRUE, estimated_sec = 300,
        notification_msg = "CMIP6 scenario download complete."
      )
    })

    observeEvent(input$gd_average_gcms, {
      gcm_list <- input$gd_cmip6_avg_gcms %||% character(0)
      ssp <- input$gd_cmip6_ssp %||% "SSP2-4.5"
      period <- input$gd_cmip6_period %||% "2041-2060"
      if (length(gcm_list) < 2) {
        gd_append_log("Select at least 2 GCMs to average.")
        return()
      }
      gd_append_log(paste("Averaging GCMs:", paste(gcm_list, collapse = ", "), "SSP", ssp, period))
      gd_start_download(
        label = "GCM averaging",
        download_fun = function(gcm_list, ssp, period) {
          library(terra)
          source(sdm_resolve_module("covariates_climate_future.R"))
          average_cmip6_gcms(gcm_list = gcm_list, ssp = ssp, period = period, var = "bioc",
                             res = 10, out_dir = sdm_default_future_worldclim_dir, quiet = FALSE)
          cat("GCM averaging complete.\n")
        },
        args = list(gcm_list = gcm_list, ssp = ssp, period = period),
        verify_fun = function() verify_future_cache(),
        timeout_sec = 600, kill_on_timeout = TRUE, estimated_sec = 300,
        notification_msg = "GCM averaging complete."
      )
    })

    observeEvent(input$gd_download_elevation, {
      demtype <- input$gd_demtype %||% "COP90"
      api_key <- input$gd_opentopo_key %||% Sys.getenv("OPENTOPOGRAPHY_API_KEY", "")
      if (!nzchar(api_key)) {
        gd_append_log("ERROR: OpenTopography API key required. Enter in the field above.")
        return()
      }
      gd_start_download(
        label = paste("elevation DEM:", demtype),
        download_fun = function(demtype, api_key) {
          library(terra)
          source(sdm_resolve_module("covariates_elevation.R"))
          load_elevation_covariate(training_extent = c(-180, 180, -90, 90), projection_extent = NULL,
                                    cache_dir = file.path(sdm_project_root(), "covariates"), demtype = demtype,
                                    api_key = api_key, allow_download = TRUE,
                                    log_fun = function(...) cat(paste(...), "\n"))
          cat("Elevation download complete.\n")
        },
        args = list(demtype = demtype, api_key = api_key),
        verify_fun = function() verify_elevation_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 120
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
        gd_append_log("Select at least one variable and one depth.")
        return()
      }
      gd_start_download(
        label = paste("soil:", paste(selected_vars, collapse = ",")),
        download_fun = function(selected_vars, selected_depths) {
          library(terra)
          cache_dir <- file.path(sdm_project_root(), "covariates", "soilgrids")
          dir.create(cache_dir, recursive = TRUE)
          for (v in selected_vars) {
            for (d in selected_depths) {
              tryCatch({
                cat("Downloading soil ", v, " depth ", d, "cm...\n")
                r <- geodata::soil_world(var = v, depth = as.integer(d), stat = "mean", path = cache_dir)
                f <- list.files(cache_dir, pattern = paste0("sg_", v, "_d", d), full.names = TRUE)[1]
                if (!is.na(f) && file.exists(f)) cat("OK: ", f, "\n")
              }, error = function(e) cat("ERROR soil ", v, " d", d, ": ", e$message, "\n"))
            }
          }
          cat("Soil download complete.\n")
        },
        args = list(selected_vars = selected_vars, selected_depths = selected_depths),
        verify_fun = function() verify_soil_cache(),
        timeout_sec = 1200, kill_on_timeout = TRUE, estimated_sec = 300
      )
    })

    observeEvent(input$gd_download_uv, {
      gd_start_download(
        label = "UV-B radiation",
        download_fun = function() {
          library(terra)
          source(sdm_resolve_module("covariates_uv.R"))
          load_uv_covariate(selected_uv_vars = c("UVB1","UVB2","UVB3","UVB4","UVB5","UVB6"),
                            selected_uv_months = as.character(1:12),
                             covariate_cache_dir = file.path(sdm_project_root(), "covariates"),
                            allow_download = TRUE, log_fun = function(...) cat(paste(...), "\n"))
          cat("UV-B download complete.\n")
        },
        verify_fun = function() verify_uv_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 120
      )
    })

    observeEvent(input$gd_download_vegetation, {
      gd_start_download(
        label = "GIMMS NDVI climatology",
        download_fun = function() {
          library(terra)
          source(sdm_resolve_module("covariates_vegetation.R"))
          load_gimms_ndvi_period(period = "clim", ndvi_year = 2020,
                                  extent_vec = c(-180,180,-90,90),
                                  aggregate_factor = 1,
                                  cache_dir = file.path(sdm_project_root(), "covariates", "vegetation"),
                                  allow_download = TRUE, log_fun = function(...) cat(paste(...), "\n"))
          cat("GIMMS NDVI download complete.\n")
        },
        verify_fun = function() verify_vegetation_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 120
      )
    })

    observeEvent(input$gd_download_lulc, {
      year <- as.integer(input$gd_lulc_year %||% 2020)
      gd_start_download(
        label = paste("LULC year:", year),
        download_fun = function(year) {
          library(terra)
          source(sdm_resolve_module("covariates_lulc.R"))
          load_lulc_covariate(lulc_year = year, extent_vec = c(-180,180,-90,90),
                              aggregate_factor = 1,
                               covariate_cache_dir = file.path(sdm_project_root(), "covariates"),
                              allow_download = TRUE, log_fun = function(...) cat(paste(...), "\n"))
          cat("LULC download complete.\n")
        },
        args = list(year = year),
        verify_fun = function() verify_lulc_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 90
      )
    })

    observeEvent(input$gd_download_hfp, {
      year <- as.integer(input$gd_hfp_year %||% 2020)
      gd_start_download(
        label = paste("Human Footprint year:", year),
        download_fun = function(year) {
          library(terra)
          source(sdm_resolve_module("covariates_human_footprint.R"))
          load_human_footprint_covariate(hfp_year = year, extent_vec = c(-180,180,-90,90),
                                          aggregate_factor = 1,
                                           covariate_cache_dir = file.path(sdm_project_root(), "covariates"),
                                          allow_download = TRUE, log_fun = function(...) cat(paste(...), "\n"))
          cat("HFP download complete.\n")
        },
        args = list(year = year),
        verify_fun = function() verify_hfp_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 90
      )
    })

    observeEvent(input$gd_download_drought, {
      periods <- input$gd_drought_periods %||% character(0)
      if (length(periods) == 0) {
        gd_append_log("Select at least one drought period.")
        return()
      }
      gd_start_download(
        label = paste("drought periods:", paste(periods, collapse = ", ")),
        download_fun = function(periods) {
          library(terra)
          source(sdm_resolve_module("covariates_drought.R"))
          load_drought_covariate(selected_periods = periods,
                                  extent_vec = c(-180,180,-90,90),
                                  aggregate_factor = 1,
                                   covariate_cache_dir = file.path(sdm_project_root(), "covariates"),
                                  allow_download = TRUE, log_fun = function(...) cat(paste(...), "\n"))
          cat("Drought download complete.\n")
        },
        args = list(periods = periods),
        verify_fun = function() verify_drought_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 120
      )
    })

    observeEvent(input$gd_download_bioclime, {
      gd_start_download(
        label = "bioclimatic seasonality",
        download_fun = function() {
          library(terra)
          source(sdm_resolve_module("covariates_bioclim_seasonality.R"))
          load_bioclim_seasonality(extent_vec = c(-180,180,-90,90),
                                    worldclim_dir = file.path(sdm_project_root(), "Worldclim"),
                                    aggregate_factor = 1,
                                     covariate_cache_dir = file.path(sdm_project_root(), "covariates"),
                                    allow_download = TRUE, log_fun = function(...) cat(paste(...), "\n"))
          cat("Bioclim season download complete.\n")
        },
        verify_fun = function() verify_bioclim_season_cache(),
        timeout_sec = 300, kill_on_timeout = TRUE, estimated_sec = 120
      )
    })

    # ---- Cache management ----

    observeEvent(input$gd_clear_cache, {
      showModal(modalDialog(
        title = "Clear covariate cache?",
        "This will permanently delete all cached covariate rasters in the covariates/ directory.",
        "Re-download will be required on next model run.",
        footer = tagList(
          actionButton(session$ns("confirm_clear_cache_yes"), "Yes, clear cache", class = "btn-danger"),
          modalButton("Cancel")
        ), easyClose = FALSE
      ))
    })

    observeEvent(input$confirm_clear_cache_yes, {
      removeModal()
      tryCatch({
        unlink(file.path(sdm_project_root(), "covariates"), recursive = TRUE)
        gd_append_log("Covariate cache cleared.")
        rv$gd_cache_refresh <- (rv$gd_cache_refresh %||% 0) + 1
      }, error = function(e) {
        gd_append_log(paste("ERROR clearing cache:", conditionMessage(e)))
      })
    })

    observeEvent(input$gd_clear_log, {
      rv$gd_unified_log <- ""
    })

  })
}
