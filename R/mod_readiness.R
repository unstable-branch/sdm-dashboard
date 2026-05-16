mod_readiness_server <- function(id, rv, input, readiness_item) {
  moduleServer(id, function(input, output, session) {

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
      if (any(!is.finite(extent)) || extent[1] >= extent[2] || extent[3] >= extent[4]) {
        extent_state <- "error"
        extent_detail <- "Projection extent is invalid. Ensure xmin < xmax, ymin < ymax, and all values are finite numbers within longitude [-180,180] and latitude [-90,90]."
        issues <- c(issues, "Fix the projection extent values.")
      }
      overlap_state <- "info"
      overlap_detail <- "Observation/projection overlap will be checked after observation records are available."
      overlap <- if (!is.null(cleaned)) occurrence_extent_overlap(cleaned$df, extent) else NULL
      if (!is.null(overlap)) {
        overlap_detail <- paste0(overlap$count, " of ", overlap$total, " cleaned observation records (", fmt_num(overlap$percent, 1), "%) fall inside the selected projection extent.")
        overlap_state <- if (overlap$count == 0 || overlap$percent < 10) "info" else "ok"
      }

      cc_state <- "info"
      cc_detail <- "Advanced cleaning is off."
      if (isTRUE(input$use_coordinatecleaner)) {
        if (!is.null(cleaned) && is.data.frame(cleaned$df) && "cc_flag" %in% names(cleaned$df)) {
          n_flagged <- sum(cleaned$df$cc_flag, na.rm = TRUE)
          n_total <- nrow(cleaned$df)
          pct <- round(100 * n_flagged / n_total, 1)
          cc_detail <- paste0(n_flagged, " of ", n_total, " records flagged (", pct, "%)")
          cc_state <- if (n_flagged > 0) "warn" else "ok"
        } else {
          cc_detail <- "Advanced cleaning enabled — will run when data is loaded."
        }
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
          readiness_item("CoordinateCleaner", cc_detail, cc_state),
          readiness_item("Future climate projection", future_detail, future_state)
        )
      )
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

  })
}