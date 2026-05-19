mod_results_server <- function(id, rv, input) {
  moduleServer(id, function(input, output, session) {

    # --- Run comparison table ---
    output$run_comparison <- renderUI({
      past <- rv$past_runs
      if (length(past) == 0) return(NULL)
      if (length(past) == 1) return(p(class = "small-muted", "Run more models to see a comparison table."))
      df <- do.call(rbind, lapply(past, function(r) {
        data.frame(
          Time = format(r$timestamp, "%H:%M:%S"),
          Species = r$species,
          Model = r$model_id,
          AUC = if (is.finite(r$auc)) sprintf("%.3f", r$auc) else "-",
          TSS = if (is.finite(r$tss)) sprintf("%.3f", r$tss) else "-",
          stringsAsFactors = FALSE
        )
      }))
      div(class = "content-card",
        h4("Run comparison"),
        p(class = "small-muted", "Metrics from recent runs in this session."),
        DT::datatable(df, options = list(dom = "t", ordering = FALSE), rownames = FALSE,
                     class = "display compact", style = "bootstrap")
      )
    })

    output$metric_cards <- renderUI({
      r <- rv$result
      if (is.null(r)) return(div(class = "metric-grid", metric_card("Observation records", "-", "waiting for run"), metric_card("Covariates", "-", "waiting for run"), metric_card("AUC", "-", "cross-validation"), metric_card("High-suitability area", "-", "km2 above threshold")))
      auc <- r$metrics$auc_mean
      auc_note <- if (is.numeric(auc)) {
        if (auc >= 0.9) "Excellent" else if (auc >= 0.7) "Good" else "Poor"
      } else ""
      auc_class <- if (auc_note == "Excellent") "metric-note-excellent" else if (auc_note == "Good") "metric-note-good" else if (auc_note == "Poor") "metric-note-poor" else ""
      div(class = "metric-grid",
        metric_card("Observation records used", fmt_num(r$metrics$presence_records), "after cleaning/thinning"),
        metric_card("Model", r$config$model_label %||% "GLM", "backend"),
        metric_card("CV AUC", fmt_num(auc, 3), paste(auc_note, paste0(r$metrics$cv_folds, " folds; ", r$metrics$n_cores, " cores"), sep = " — "), auc_class),
        metric_card("High-suitability area", fmt_num(r$summary$high_risk_area_km2), "km2 above threshold"))
    })

    output$suitability_map_ui <- renderUI({
      if (is.null(rv$result) || is.null(rv$result$paths$tif) || !file.exists(rv$result$paths$tif)) {
        return(div(class = "content-card map-card",
          div(class = "map-title-row", h4("Current suitability"), span("Interactive map view")),
          plotOutput("suitability_placeholder", height = "56vh")
        ))
      }
      leafletOutput("suitability_map", height = "56vh")
    })

    output$suitability_map <- renderLeaflet({
      req(rv$result)
      r <- rv$result
      req(file.exists(r$paths$tif), "Output TIFF not found")

      map <- render_suitability_leaflet(
        suitability_raster = terra::rast(r$paths$tif),
        presence_df = r$occurrence_used %||% r$occurrence,
        background_df = r$background_used %||% NULL,
        mess_raster = if (!is.null(r$mess)) terra::rast(r$mess) else NULL,
        threshold = r$config$threshold %||% 0.5,
        show_mess = isTRUE(input$show_mess)
      )

      if (!isTRUE(input$show_presence)) {
        map <- leaflet::hideGroup(map, "presence")
      }
      if (!isTRUE(input$show_background)) {
        map <- leaflet::hideGroup(map, "background")
      }

      map
    })

    output$suitability_placeholder <- renderPlot({
      placeholder_plot("No suitability map yet. Configure options on the left, then click Run SDM.")
    })

    observeEvent(input$show_mess, {
      req(rv$result)
      r <- rv$result
      map <- leaflet::leafletProxy("suitability_map")
      if (isTRUE(input$show_mess)) {
        mess_src <- tryCatch(terra::sources(r$mess), error = function(e) NULL)
        if (!is.null(r$mess) && !is.null(mess_src) && length(mess_src) > 0 && any(nzchar(mess_src))) {
          mess_raster <- terra::rast(r$mess)
          r_mess <- tryCatch(terra::project(mess_raster, "EPSG:4326"),
                             error = function(e) { showNotification(paste("MESS projection failed:", e$message), type = "warning"); NULL })
          if (is.null(r_mess)) {
            updateCheckboxInput(session, "show_mess", value = FALSE)
            return()
          }
          mess_binary <- r_mess
          terra::values(mess_binary) <- ifelse(terra::values(r_mess) < 0, 1, 0)
          map <- map %>%
            leaflet::addRasterImage(mess_binary, opacity = 0.5, layerId = "mess",
                                    project = FALSE, colors = "red") %>%
            leaflet::addLegend(position = "bottomright", colors = "red",
                                labels = "Extrapolation (MESS<0)", title = "MESS", layerId = "mess_legend")
        } else {
          showNotification("No MESS layer available for this model run.", type = "message")
          updateCheckboxInput(session, "show_mess", value = FALSE)
        }
      } else {
        if (!is.null(map$dependencies)) {
          map <- map %>% leaflet::removeLegend(layerId = "mess_legend") %>% leaflet::removeImages(layerId = "mess")
        }
      }
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
      map <- leaflet::leafletProxy("suitability_map") %>% leaflet::removeImages(layerId = "suitability")

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
        cols <- grDevices::colorRampPalette(c("#0A1624", "#123247", "#15545D",
                                             "#1F8A70", "#59C174", "#C6D65B",
                                             "#F3C45A", "#F28A3C", "#E34B35", "#A51E3B"))(180)
        map <- map %>% leaflet::addRasterImage(r_wgs84, opacity = 0.7,
                                                layerId = "suitability", colors = cols, project = TRUE)
      }
    })
    output$future_plot <- renderPlot({ if (is.null(rv$result) || is.null(rv$result$future)) return(placeholder_plot("Run with future projection enabled to view a future suitability map.")); r <- rv$result; plot_suitability_map(r$future$suitability, r$occurrence, r$config$projection_extent, paste(r$config$species, r$config$future_label), r$config$threshold, TRUE) })
    output$delta_plot <- renderPlot({ if (is.null(rv$result) || is.null(rv$result$future)) return(placeholder_plot("Run with future projection enabled to view current-to-future change.")); plot_delta_map(rv$result$future$delta, rv$result$config$future_label) })
    output$summary_panel <- renderUI({
      r <- rv$result
      if (is.null(r)) {
        return(div(class = "welcome-panel",
          h4("Welcome to the SDM Dashboard"),
          p("Follow these steps to run your first species distribution model:"),
          div(class = "welcome-steps",
            div(class = "welcome-step", span(class = "welcome-step-num", "1"), div(h5("Load occurrence data"), p("Upload a CSV, fetch from GBIF, or use the bundled demo data. Configure in the left sidebar under Input data."))),
            div(class = "welcome-step", span(class = "welcome-step-num", "2"), div(h5("Select climate variables"), p("Choose BIOCLIM variables and optional covariates (elevation, soil, vegetation). Toggle optional covariates under Climate variables."))),
            div(class = "welcome-step", span(class = "welcome-step-num", "3"), div(h5("Choose a model"), p("Select GLM, MaxEnt, GAM, or ensemble backends. Configure cross-validation and bias correction under Model settings."))),
            div(class = "welcome-step", span(class = "welcome-step-num", "4"), div(h5("Run and explore"), p("Click Run SDM, then review maps, metrics, and diagnostics in the tabs above. Export results from the Downloads tab.")))
          ),
          div(class = "welcome-hint", "Tip: Start with the bundled synthetic demo data and WorldClim layers to test the pipeline before using your own data.")
        ))
      }
      row <- function(label, value) div(class = "summary-row", div(class = "summary-label", label), div(class = "summary-value", value))
      div(class = "summary-list",
        row("Model backend", r$config$model_label %||% "GLM"),
        row("Mean suitability", fmt_num(r$summary$mean, 3)),
        row("Median suitability", fmt_num(r$summary$median, 3)),
        row("Maximum suitability", fmt_num(r$summary$max, 3)),
        row("Cells above threshold", paste0(fmt_num(r$summary$cells_above_threshold), " (", fmt_num(r$summary$percent_above_threshold, 1), "%)")),
        row("High-suitability area", paste(fmt_num(r$summary$high_risk_area_km2), "km2")),
        if (!is.null(r$eoo_aoo) && is.finite(r$eoo_aoo$eoo_km2))
          row("EOO (MCP)", paste(fmt_num(r$eoo_aoo$eoo_km2), "km2")),
        if (!is.null(r$eoo_aoo) && is.finite(r$eoo_aoo$aoo_km2))
          row("AOO (2x2 km)", paste(r$eoo_aoo$aoo_cells, "cells =", fmt_num(r$eoo_aoo$aoo_km2), "km2")),
        row("Observation source", r$config$occurrence_source),
        row("Observation file", r$config$occurrence_file),
        row("Covariates", paste(r$environment$names, collapse = ", ")),
        row("CPU cores used", r$metrics$n_cores),
        row("Elapsed time", paste(fmt_num(r$metrics$elapsed_seconds, 1), "sec")),
        row("Output TIFF", r$paths$tif),
        if (!is.null(r$future)) row("Future scenario", r$config$future_label %||% "Future climate"),
        if (!is.null(r$future)) row("Future mean suitability", fmt_num(r$future$summary$mean, 3)),
        if (!is.null(r$future)) {
          cur_area <- r$summary$high_risk_area_km2 %||% NA_real_
          fut_area <- r$future$summary$high_risk_area_km2 %||% NA_real_
          if (is.finite(cur_area) && is.finite(fut_area)) {
            change_pct <- (fut_area - cur_area) / cur_area * 100
            direction <- if (change_pct > 0) "expansion" else if (change_pct < 0) "contraction" else "no change"
            row("Range change", paste0(fmt_num(abs(change_pct), 1), "% ", direction, " (", fmt_num(cur_area), " → ", fmt_num(fut_area), " km2)"))
          }
        },
        if (!is.null(r$future)) row("Future output TIFF", r$paths$future_tif %||% "not available"),
        if (!is.null(r$future)) row("Delta output TIFF", r$paths$delta_tif %||% "not available"),
        if (!is.null(r$future2)) tagList(
          row("2nd scenario", r$config$future_label2 %||% "Scenario 2"),
          row("2nd future mean", fmt_num(r$future2$summary$mean, 3)),
          if (is.finite(r$future$summary$high_risk_area_km2) && is.finite(r$future2$summary$high_risk_area_km2)) {
            diff_pct <- (r$future2$summary$high_risk_area_km2 - r$future$summary$high_risk_area_km2) / r$future$summary$high_risk_area_km2 * 100
            row("Scenario diff", paste0(fmt_num(abs(diff_pct), 1), "% ", if(diff_pct > 0) "more" else "less", " area in scenario 2"))
          }
        )
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
    output$response_curves_panel <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$response_curves) || length(r$response_curves) == 0) return(NULL)
      div(class = "content-card",
        h4("Response curves"),
        p(class = "small-muted", "Marginal (partial) response of suitability to each covariate, holding others at their mean."),
        plotOutput("results-response_curves_plot", height = "auto")
      )
    })
    output$response_curves_plot <- renderPlot({
      r <- rv$result
      req(r)
      curve_data <- r$response_curves
      if (is.null(curve_data) || length(curve_data) == 0) return(placeholder_plot("Response curves not available for this backend."))
      plot_response_curves(curve_data, ncol = 3)
    }, height = function() {
      r <- rv$result
      if (is.null(r) || is.null(r$response_curves)) return(200)
      n_vars <- max(1, length(r$response_curves))
      ceiling(n_vars / 3) * 180 + 60
    })
    output$variable_importance_panel <- renderUI({
      r <- rv$result
      if (is.null(r)) return(NULL)
      imp <- r$variable_importance
      if (is.null(imp) || !is.data.frame(imp) || nrow(imp) == 0) return(NULL)
      # ESM has its own dedicated panel with pair heatmap
      if (!is.null(r$esm_config)) return(NULL)
      div(class = "content-card",
        h4("Variable importance"),
        p(class = "small-muted", "Permutation importance: drop in AUC when each variable is randomly shuffled."),
        plotOutput("results-var_importance_plot", height = "auto")
      )
    })
    # Shared variable importance plot renderer
    render_var_importance <- function(imp, y_limit = NULL) {
      if (!is.data.frame(imp) || nrow(imp) == 0) return(NULL)
      imp <- imp[order(imp$importance, decreasing = TRUE), , drop = FALSE]
      if (!requireNamespace("ggplot2", quietly = TRUE)) {
        plot.new(); title("ggplot2 not available"); return(NULL)
      }
      ylim <- y_limit %||% c(0, max(1, max(imp$importance, na.rm = TRUE) * 1.1))
      p <- ggplot2::ggplot(imp, ggplot2::aes(x = ggplot2::reorder(variable, importance), y = importance)) +
        ggplot2::geom_col(fill = "#2166ac", width = 0.7) +
        ggplot2::coord_flip() +
        ggplot2::scale_y_continuous(limits = ylim, expand = c(0, 0.02)) +
        ggplot2::labs(x = NULL, y = "Relative importance") +
        ggplot2::theme_minimal(base_size = 11) +
        ggplot2::theme(panel.grid.major.y = ggplot2::element_blank())
      print(p)
    }

    output$var_importance_plot <- renderPlot({
      r <- rv$result
      req(r, r$variable_importance)
      render_var_importance(r$variable_importance)
    }, height = function() {
      r <- rv$result
      if (is.null(r) || is.null(r$variable_importance)) return(200)
      n <- max(1, nrow(r$variable_importance))
      max(180, min(n * 30 + 60, 500))
    })
    output$calibration_panel <- renderUI({
      r <- rv$result
      if (is.null(r)) return(NULL)
      div(class = "content-card",
        h4("Calibration plot"),
        p(class = "small-muted", "Binned observed vs predicted suitability. Points near the diagonal indicate good calibration (Pearce & Ferrier 2000)."),
        plotOutput("results-calibration_plot", height = "300px")
      )
    })
    output$calibration_plot <- renderPlot({
      r <- rv$result
      req(r, r$fit, r$model_data)
      cal_data <- tryCatch(compute_calibration(r$model_data, r$fit, n_bins = 10), error = function(e) {
        data.frame(bin_mid = numeric(0), observed = numeric(0), predicted = numeric(0), n = integer(0))
      })
      if (nrow(cal_data) == 0) return(placeholder_plot("Calibration plot not available for this backend."))
      plot_calibration(cal_data)
    })
    output$climate_match_panel <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$climate_match)) return(NULL)
      cm <- r$climate_match
      div(class = "content-card",
        h4("Climate matching"),
        p(class = "small-muted", paste0(cm$summary$method, " distance across ", cm$summary$n_variables, " variables.")),
        div(class = "metric-row",
          div(class = "metric", strong(sprintf("%.1f%%", cm$summary$pct_similar)), "similar (>0.5)"),
          div(class = "metric", strong(sprintf("%.1f%%", cm$summary$pct_dissimilar)), "dissimilar (<0.2)")
        ),
        p(class = "small-muted", paste("Variables:", paste(cm$summary$variables, collapse = ", "))),
        if (!is.null(r$paths$climate_matching_tif))
          p(class = "small-muted", paste("Output:", r$paths$climate_matching_tif))
      )
    })
    output$aoa_panel <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$aoa)) return(NULL)
      aoa <- r$aoa
      div(class = "content-card",
        h4("Area of Applicability (AOA)"),
        p(class = "small-muted", "Model-weighted extrapolation detection (Meyer & Pebesma 2022). Cells outside the AOA should be interpreted with caution."),
        div(class = "metric-row",
          div(class = "metric", strong(sprintf("%.1f%%", aoa$summary$pct_applicable)), "applicable"),
          div(class = "metric", strong(sprintf("%.1f%%", aoa$summary$pct_outside)), "outside training envelope")
        ),
        p(class = "small-muted", paste("Method:", aoa$summary$method, "| Threshold:", sprintf("%.1f", aoa$summary$threshold),
          "| Training points:", aoa$summary$n_training))
      )
    })
    output$dwca_issues_panel <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$dwca_issues) || nrow(r$dwca_issues) == 0) return(NULL)
      issues <- r$dwca_issues
      if (!is.data.frame(issues) || nrow(issues) == 0) return(NULL)
      tags$div(
        h4("GBIF quality flags"),
        tags$small(class = "small-muted", "Records with GBIF-assigned quality issues. Review and optionally exclude before modelling."),
        br(),
        DT::dataTableOutput("gbif_issues_table"),
        actionButton("exclude_flagged", "Exclude flagged records", class = "btn-warning btn-sm")
      )
    })

    output$gbif_issues_table <- DT::renderDataTable({
      r <- rv$result
      if (is.null(r) || is.null(r$dwca_issues) || nrow(r$dwca_issues) == 0) {
        return(DT::datatable(data.frame(Message = "No GBIF quality flags"), options = list(dom = "t")))
      }
      issues <- r$dwca_issues
      cols_needed <- c("x", "y", "species", "issue_flags")
      cols_present <- cols_needed[cols_needed %in% names(issues)]
      if (length(cols_present) == 0) {
        return(DT::datatable(data.frame(Message = "No GBIF quality flags"), options = list(dom = "t")))
      }
      display_df <- issues[, cols_present, drop = FALSE]
      names(display_df) <- ifelse(names(display_df) == "x", "longitude", ifelse(names(display_df) == "y", "latitude", names(display_df)))
      if ("issue_flags" %in% names(display_df)) {
        critical <- c("ZERO_COORDINATE", "COORDINATE_OUT_OF_RANGE", "COUNTRY_COORDINATE_MISMATCH", "COORDINATE_INVALID")
        flag_colors <- ifelse(display_df$issue_flags %in% critical, "#8c1d18", "#66768a")
        display_df$issue_flags <- sapply(seq_len(nrow(display_df)), function(i) {
          span(display_df$issue_flags[i], style = paste0("color:", flag_colors[i], ";font-weight:700;"))
        })
      }
      DT::datatable(display_df, options = list(dom = "t", pageLength = 10), rownames = FALSE, escape = FALSE)
    })

    observeEvent(input$exclude_flagged, {
      showModal(modalDialog(
        title = "Confirm exclusion",
        "This will remove all records with GBIF quality flags from the current result. Continue?",
        footer = tagList(
          actionButton("confirm_exclude_yes", "Yes, exclude flagged records"),
          modalButton("Cancel")
        ),
        easyClose = FALSE
      ))
    })
    observeEvent(input$confirm_exclude_yes, {
      removeModal()
      r <- rv$result
      if (!is.null(r) && !is.null(r$dwca_issues) && nrow(r$dwca_issues) > 0) {
        issues_flagged <- r$dwca_issues
        if ("x" %in% names(issues_flagged) && "y" %in% names(issues_flagged)) {
          flagged_coords <- paste(issues_flagged$x, issues_flagged$y, sep = "_")
          if (!is.null(rv$cleaned_occurrence)) {
            occ_coords <- paste(rv$cleaned_occurrence$df$longitude, rv$cleaned_occurrence$df$latitude, sep = "_")
            rv$cleaned_occurrence$df <- rv$cleaned_occurrence$df[!occ_coords %in% flagged_coords, , drop = FALSE]
            append_log(paste0("Excluded ", length(flagged_coords), " GBIF-flagged records from current result."))
          }
        }
      }
    })

    output$ensemble_weights_panel <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$cv$component_metrics)) return(NULL)
      if (!identical(r$config$model_id, "multi_ensemble")) return(NULL)
      metrics <- r$cv$component_metrics
      if (is.null(metrics) || nrow(metrics) == 0) return(NULL)
      excluded <- r$ensemble_config$models_excluded
      div(class = "content-card",
        h4("Ensemble weights"),
        if (length(excluded) > 0) {
          div(class = "small-muted mb-sm",
            "Models excluded (below threshold): ", paste(excluded, collapse = ", "))
        },
        tableOutput("ensemble_weights_table"),
        tags$small(class = "small-muted", "Weights are normalised to sum to 1. Higher power gives more emphasis to better-performing models.")
      )
    })
    output$ensemble_weights_table <- renderTable({
      r <- rv$result
      if (is.null(r) || is.null(r$cv$component_metrics)) return(data.frame())
      metrics <- r$cv$component_metrics
      if (nrow(metrics) == 0) return(data.frame())
      w <- metrics
      w$auc_mean <- sprintf("%.3f", w$auc_mean)
      w$tss_mean <- sprintf("%.3f", w$tss_mean)
      w$weight <- sprintf("%.3f", w$weight)
      colnames(w) <- c("Model", "Method", "AUC (CV)", "TSS (CV)", "Weight")
      w
    }, striped = TRUE, hover = TRUE, spacing = "s")

    output$esm_diagnostics_panel <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$esm_config)) return(NULL)
      esm <- r$esm_config
      n_vars <- esm$n_vars
      n_total <- esm$n_pairs_total
      n_used  <- esm$n_pairs_used
      n_drop  <- esm$n_pairs_dropped
      min_auc <- esm$min_auc
      algo    <- esm$algorithm

      tagList(
        div(class = "content-card",
          h4("ESM bivariate models"),
          div(sprintf("%d of %d bivariate models kept (AUC >= %.2f); %d dropped.",
                      n_used, n_total, min_auc, n_drop)),
          tags$small(class = "small-muted",
            sprintf("Algorithm: %s | Variables: %d | Runs: %d | Split: %d%%",
                    algo, n_vars, esm$n_runs, esm$data_split))
        ),
        div(class = "content-card",
          h4("ESM bivariate pair weights"),
          plotOutput("esm_pair_heatmap", height = "auto"),
          tags$small(class = "small-muted",
            "Symmetric matrix: cell [i,j] shows the weight of the (variable_i, variable_j) bivariate model. Higher weight = more informative for prediction.")
        ),
        div(class = "content-card",
          h4("ESM variable importance"),
          plotOutput("esm_var_importance", height = "auto"),
          tags$small(class = "small-muted",
            "Importance = mean weight of all pairs containing each variable, normalised to 0-1.")
        )
      )
    })

    output$esm_pair_heatmap <- renderPlot({
      r <- rv$result
      if (is.null(r) || is.null(r$esm_config)) return(NULL)
      p <- plot_esm_pair_heatmap(r)
      if (is.null(p)) {
        plot.new(); title("ggplot2 not available")
      } else {
        print(p)
      }
    }, height = function() {
      n <- length(rv$result$esm_config$covariates %||% seq_len(6))
      max(200, min(n * 60, 600))
    })

    output$esm_var_importance <- renderPlot({
      r <- rv$result
      if (is.null(r) || is.null(r$variable_importance)) return(NULL)
      render_var_importance(r$variable_importance, y_limit = c(0, 1))
    }, height = function() {
      n <- nrow(rv$result$variable_importance %||% data.frame(variable = character(0)))
      max(150, min(n * 35, 500))
    })

    output$run_log <- renderUI({
      log_text <- rv$log %||% ""
      if (!nzchar(log_text)) return(div(class = "run-log-line", "No log output yet."))
      lines <- strsplit(log_text, "\n")[[1]]
      lines <- lines[nzchar(lines)]

      # Detect section headers in log lines
      section_patterns <- list(
        "Data" = "(?i)(occurrence|data|gbif|download|cleaning|source)",
        "Covariates" = "(?i)(covariate|worldclim|biovar|elevation|soil|vif|layer|climate)",
        "Model" = "(?i)(fitting|model|glm|gam|maxnet|rf|xgboost|rangebag|esm|ensemble|cross-valid|auc|tss|pa rep)",
        "Projection" = "(?i)(predict|project|raster|suitability|tif|output|future|range)"
      )

      # Tag each line with its section
      section_tags <- rep("Other", length(lines))
      for (sec_name in names(section_patterns)) {
        matches <- grepl(section_patterns[[sec_name]], lines)
        section_tags[matches] <- sec_name
      }

      # Group consecutive same-section lines together
      groups <- rle(section_tags)
      group_starts <- c(0, cumsum(groups$lengths[-length(groups$lengths)]))

      tag_list <- lapply(seq_along(groups$values), function(g) {
        sec <- groups$values[g]
        start_idx <- group_starts[g] + 1
        end_idx <- group_starts[g] + groups$lengths[g]
        group_lines <- lines[start_idx:end_idx]

        line_divs <- lapply(group_lines, function(line) {
          cls <- "run-log-line"
          if (grepl("ERROR", line, ignore.case = TRUE)) {
            cls <- paste(cls, "run-log-error")
          } else if (grepl("Warning", line, ignore.case = TRUE)) {
            cls <- paste(cls, "run-log-warn")
          } else if (grepl("NOTE", line, ignore.case = TRUE)) {
            cls <- paste(cls, "run-log-note")
          }
          div(class = cls, line)
        })

        # If group is small (<=3 lines), don't collapse
        if (groups$lengths[g] <= 3) {
          tagList(line_divs)
        } else {
          tags$details(
            tags$summary(paste0(sec, " (", groups$lengths[g], " lines)")),
            tagList(line_divs)
          )
        }
      })

      tags$div(class = "run-log", tagList(tag_list))
    })

    collect_sidecar_paths <- function(result) {
      sidecars <- unlist(result$paths[c("glm_tif", "rangebag_tif", "disagreement_tif", "future_tif", "delta_tif")], use.names = FALSE)
      multi_ens_keys <- grep("^multi_ens_comp_|^multi_ens_(mean|median|committee|sd)_tif$", names(result$paths), value = TRUE)
      if (length(multi_ens_keys) > 0) sidecars <- c(sidecars, unlist(result$paths[multi_ens_keys], use.names = FALSE))
      sidecars[!is.na(sidecars) & nzchar(sidecars) & file.exists(sidecars)]
    }

    output$sidecar_download_note <- renderUI({
      r <- rv$result
      if (is.null(r)) return(NULL)
      sidecars <- collect_sidecar_paths(r)
      if (length(sidecars) == 0) return(p(class = "small-muted", "No model sidecar rasters were produced for this run."))
      tags$ul(class = "small-muted", lapply(sidecars, function(path) tags$li(basename(path))))
    })
    output$future_tif_download_ui <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$paths$future_tif) || !file.exists(r$paths$future_tif)) return(NULL)
      downloadButton("download_future_tif", "Download future GeoTIFF")
    })
    output$delta_tif_download_ui <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$paths$delta_tif) || !file.exists(r$paths$delta_tif)) return(NULL)
      downloadButton("download_delta_tif", "Download delta GeoTIFF")
    })
    output$ensemble_downloads_ui <- renderUI({
      r <- rv$result
      if (is.null(r) || is.null(r$paths)) return(NULL)
      ens_keys <- grep("^multi_ens_(mean|median|committee|sd)_tif$", names(r$paths), value = TRUE)
      ens_files <- ens_keys[!is.na(r$paths[ens_keys]) & nzchar(r$paths[ens_keys]) & sapply(r$paths[ens_keys], file.exists)]
      if (length(ens_files) == 0) return(NULL)
      div(class = "content-card mt-sm",
        h4("Ensemble rasters"),
        p(class = "small-muted", "Individual ensemble strategy outputs."),
        div(class = "downloads-row",
          lapply(names(ens_files), function(key) {
            label <- switch(key,
              "multi_ens_mean_tif" = "Mean",
              "multi_ens_median_tif" = "Median",
              "multi_ens_committee_tif" = "Committee",
              "multi_ens_sd_tif" = "SD (uncertainty)",
              basename(r$paths[[key]])
            )
            downloadButton(paste0("download_", key), paste("Download", label))
          })
        )
      )
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
        sidecars <- collect_sidecar_paths(rv$result)
        validate(need(length(sidecars) > 0, "No sidecar rasters are available for this run."))
        oldwd <- getwd()
        on.exit(setwd(oldwd), add = TRUE)
        setwd(dirname(sidecars[1]))
        utils::zip(file, files = basename(sidecars))
      }
    )
    output$download_multi_ens_mean_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_mean_tif); basename(r$paths$multi_ens_mean_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_mean_tif, file.exists(r$paths$multi_ens_mean_tif)); file.copy(r$paths$multi_ens_mean_tif, file, overwrite = TRUE) })
    output$download_multi_ens_median_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_median_tif); basename(r$paths$multi_ens_median_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_median_tif, file.exists(r$paths$multi_ens_median_tif)); file.copy(r$paths$multi_ens_median_tif, file, overwrite = TRUE) })
    output$download_multi_ens_committee_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_committee_tif); basename(r$paths$multi_ens_committee_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_committee_tif, file.exists(r$paths$multi_ens_committee_tif)); file.copy(r$paths$multi_ens_committee_tif, file, overwrite = TRUE) })
    output$download_multi_ens_sd_tif <- downloadHandler(filename = function() { r <- rv$result; req(r, r$paths$multi_ens_sd_tif); basename(r$paths$multi_ens_sd_tif) }, content = function(file) { r <- rv$result; req(r, r$paths$multi_ens_sd_tif, file.exists(r$paths$multi_ens_sd_tif)); file.copy(r$paths$multi_ens_sd_tif, file, overwrite = TRUE) })

  })
}