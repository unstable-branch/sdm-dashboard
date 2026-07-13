mod_model_run_server <- function(id, rv, input, append_log, occurrence_source, last_progress) {
  moduleServer(id, function(input, output, session) {

    # Reactive state for background polling (single observer, created once)
    bg_state <- reactiveValues(
      process = NULL,
      result_file = NULL,
      log_file = NULL,
      active = FALSE,
      last_log_lines = 0,
      start_time = NULL,
      progress = NULL
    )

    # Kill orphaned background process when session ends
    session$onSessionEnded(function() {
      if (!is.null(bg_state$process) && bg_state$process$is_alive()) {
        bg_state$process$kill()
      }
      if (!is.null(bg_state$progress)) {
        bg_state$progress$close()
      }
    })

    observeEvent(input$cancel_model, {
      if (!isTRUE(rv$running)) return()
      message("SDM: Run cancelled by user")
      options(sdm_cancelled = TRUE)
      if (!is.null(bg_state$process) && bg_state$process$is_alive()) {
        bg_state$process$kill()
        append_log("Background model run killed by user.")
      }
      if (!is.null(bg_state$progress)) bg_state$progress$close()
      rv$running <- FALSE
      rv$error <- "Run cancelled."
      bg_state$active <- FALSE
      append_log("Run cancelled by user.")
    })

    observe({
      tryCatch({
        session$sendCustomMessage("setRunState", list(running = isTRUE(rv$running)))
      }, error = function(e) {
        message("Warning: setRunState message failed: ", conditionMessage(e))
      })
    })

    # Single polling observer — created once, uses invalidateLater for polling
    observe({
      req(bg_state$active, bg_state$process)
      invalidateLater(500, session)

      # Timeout watchdog: kill process if running too long
      if (!is.null(bg_state$start_time)) {
        elapsed <- as.numeric(difftime(Sys.time(), bg_state$start_time, units = "secs"))
        if (elapsed > 7200) {
          bg_state$process$kill()
          rv$error <- "Model run timed out after 2 hours."
          append_log(rv$error)
          rv$running <- FALSE
          bg_state$active <- FALSE
          if (!is.null(bg_state$progress)) bg_state$progress$close()
          unlink(c(bg_state$result_file, bg_state$log_file))
          return()
        }
      }

      if (!bg_state$process$is_alive()) {
        if (!is.null(bg_state$progress)) bg_state$progress$close()

        # Cancel check: user already cancelled — don't overwrite with "failed"
        if (isTRUE(getOption("sdm_cancelled", FALSE))) {
          rv$running <- FALSE
          bg_state$active <- FALSE
          unlink(c(bg_state$result_file, bg_state$log_file))
          return()
        }

        exit_status <- bg_state$process$get_exit_status()
        if (file.exists(bg_state$log_file)) {
          log_lines <- tryCatch(readLines(bg_state$log_file, warn = FALSE), error = function(e) character(0))
          if (length(log_lines) > bg_state$last_log_lines) {
            append_log(paste(log_lines[(bg_state$last_log_lines + 1):length(log_lines)], collapse = "\n"))
          }
        }
        if (isTRUE(exit_status == 0) && file.exists(bg_state$result_file)) {
          result <- tryCatch(readRDS(bg_state$result_file), error = function(e) {
            rv$error <- paste("Failed to read model result:", conditionMessage(e))
            NULL
          })
          if (!is.null(result)) {
            rv$result <- result
            store_past_run(rv, result)
          }
          append_log("Model run completed.")
        } else {
          stderr_text <- tryCatch(bg_state$process$read_error(), error = function(e) "")
          if (is.na(exit_status)) {
            rv$error <- "Model run killed by OOM, segfault, or external signal (exit status unavailable)"
          } else {
            rv$error <- paste0("Model run failed (exit ", exit_status, "): ", stderr_text)
          }
          append_log(rv$error)
        }
        rv$running <- FALSE
        bg_state$active <- FALSE
        unlink(c(bg_state$result_file, bg_state$log_file))
        message("SDM: Model run finished")
      } else {
        if (file.exists(bg_state$log_file)) {
          log_lines <- tryCatch(readLines(bg_state$log_file, warn = FALSE), error = function(e) character(0))
          if (length(log_lines) > bg_state$last_log_lines) {
            new_lines <- log_lines[(bg_state$last_log_lines + 1):length(log_lines)]
            append_log(paste(new_lines, collapse = "\n"))
            bg_state$last_log_lines <- length(log_lines)
          }
        }
        if (!is.null(bg_state$progress)) {
          bg_state$progress$inc(0.02)
        }
      }
    }, label = "sdm_bg_poll")

    observeEvent(input$run_model, {
      message("SDM: Run SDM button clicked")
      if (isTRUE(rv$running)) {
        message("SDM: Already running, ignoring click")
        return(invisible(NULL))
      }
      rv$error <- NULL; options(sdm_cancelled = FALSE); rv$running <- TRUE; rv$log <- ""
      message("SDM: Starting model run")
      occurrence <- occurrence_source()
      occurrence_file <- occurrence$path
      if (is.null(occurrence_file)) {
        rv$error <- paste("No observation record file found. Upload a CSV/TSV, add", sdm_default_occurrence_file, "to the project folder, or restore the demo dataset.")
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      if (length(input$biovars) < 2) {
        rv$error <- "Select at least two BIOCLIM variables."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      if (isTRUE(input$use_soil) && length(input$soil_vars) == 0) {
        rv$error <- "Select at least one SoilGrids variable, or turn soil covariates off."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      if (isTRUE(input$use_uv) && length(input$uv_vars) == 0 && length(input$uv_months) == 0) {
        rv$error <- "Select at least one UV-B variable or month, or turn UV covariates off."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      if (isTRUE(input$use_vegetation)) {
        veg_products <- input$veg_products
        if (length(veg_products) == 0) {
          rv$error <- "Select at least one vegetation product, or turn vegetation covariates off."
          append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
        }
        has_lai_gpp <- any(c("lai", "gpp") %in% veg_products)
        if (has_lai_gpp && !requireNamespace("rgee", quietly = TRUE)) {
          rv$error <- "LAI/GPP selected but rgee is not installed. Run: install.packages('rgee') and then rgee::ee_initialize()"
          append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
        }
        veg_year_val <- as.integer(input$veg_year)
        current_year <- as.integer(format(Sys.Date(), "%Y"))
        if (is.na(veg_year_val) || veg_year_val < 2000 || veg_year_val > current_year - 1) {
          rv$error <- paste0("Vegetation year must be between 2000 and ", current_year - 1, ".")
          append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
        }
      }
      if (isTRUE(input$use_hfp)) {
        hfp_year_val <- as.integer(input$hfp_year)
        if (is.na(hfp_year_val) || hfp_year_val < 2001 || hfp_year_val > 2020) {
          rv$error <- "Human Footprint year must be between 2001 and 2020."
          append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
        }
      }
      if (isTRUE(input$use_lulc)) {
        lulc_year_val <- as.integer(input$lulc_year)
        if (is.na(lulc_year_val) || lulc_year_val < 2001 || lulc_year_val > 2023) {
          rv$error <- "LULC year must be between 2001 and 2023."
          append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
        }
      }
      if (isTRUE(input$use_drought) && length(input$drought_periods) == 0) {
        rv$error <- "Select at least one drought period, or turn drought covariates off."
        append_log(rv$error); rv$running <- FALSE; return(invisible(NULL))
      }
      projection_extent <- extent_from_inputs(input, rv$cleaned_occurrence)
      species_label <- trimws(input$species %||% "")
      if (!nzchar(species_label)) species_label <- sdm_default_species

      cleaned_occ <- rv$cleaned_occurrence
      if (!is.null(cleaned_occ)) {
        run_overlap <- occurrence_extent_overlap(cleaned_occ$df, projection_extent)
        if (!is.null(run_overlap) && (run_overlap$count == 0 || run_overlap$percent < 10)) {
          msg <- paste0("NOTE: ", run_overlap$count, " of ", run_overlap$total, " cleaned occurrence records (", fmt_num(run_overlap$percent, 1), "%) fall inside the projection extent. Model will project into ", fmt_num(100 - run_overlap$percent, 1), "% of the extent area with no known presence records.")
          append_log(msg)
        }
      }

      withProgress(message = "Running SDM", value = 0, {
        cfg <- sdm_config(
          species = species_label,
          occurrence_file = occurrence_file,
          worldclim_dir = input$worldclim_dir,
          selected_biovars = as.integer(input$biovars),
          projection_extent = projection_extent,
          background_n = { v <- suppressWarnings(as.numeric(input$background_n)); if (is.finite(v) && v > 0) as.integer(v) else sdm_default_background_n },
          pa_replicates = as.integer(input$pa_replicates %||% 1),
          min_source_records = input$min_source_records,
          merge_small_sources = isTRUE(input$merge_small_sources) %||% TRUE,
          thin_by_cell = isTRUE(input$thin_by_cell),
          model_id = input$model_id,
          include_quadratic = isTRUE(input$quadratic),
          threshold = { v <- suppressWarnings(as.numeric(input$threshold)); if (is.finite(v) && v >= 0 && v <= 1) v else sdm_default_threshold },
          aggregation_factor = { v <- suppressWarnings(as.integer(input$aggregation_factor)); if (is.finite(v) && v >= 1) v else sdm_default_aggregation_factor },
          cv_folds = as.integer(input$cv_folds),
          cv_strategy = input$cv_strategy %||% sdm_default_cv_strategy,
          cv_block_size_km = if (identical(input$cv_strategy, "spatial_blocks")) input$cv_block_size_km else NA_real_,
          n_cores = input$n_cores,
          worldclim_res = as.numeric(input$worldclim_res),
          use_elevation = isTRUE(input$use_elevation),
          elevation_demtype = input$elevation_demtype,
          opentopo_api_key = input$opentopo_api_key %||% Sys.getenv("OPENTOPOGRAPHY_API_KEY", ""),
          use_soil = isTRUE(input$use_soil),
          selected_soil_vars = input$soil_vars,
          selected_soil_depths = input$soil_depths,
          use_uv = isTRUE(input$use_uv),
          selected_uv_vars = input$uv_vars,
          selected_uv_months = input$uv_months,
          use_vegetation = isTRUE(input$use_vegetation),
          veg_year = as.integer(input$veg_year),
          veg_products = input$veg_products,
          use_lulc = isTRUE(input$use_lulc),
          lulc_year = as.integer(input$lulc_year),
          use_hfp = isTRUE(input$use_hfp),
          hfp_year = as.integer(input$hfp_year),
          use_bioclim_season = isTRUE(input$use_bioclim_season),
          use_drought = isTRUE(input$use_drought),
          selected_drought_periods = input$drought_periods,
          selected_chelsa_extras = if (identical(input$climate_source, "chelsa")) input$chelsa_extras else NULL,
          vif_reduction = isTRUE(input$vif_reduction) %||% FALSE,
          climate_matching = isTRUE(input$climate_matching) %||% FALSE,
          climate_matching_method = input$climate_matching_method %||% "mahalanobis",
          future_projection = isTRUE(input$future_projection),
          future_worldclim_dir = input$future_worldclim_dir,
          future_label = input$future_label,
          future_worldclim_dir2 = if (nzchar(input$future_worldclim_dir2 %||% "")) input$future_worldclim_dir2 else NULL,
          future_label2 = input$future_label2 %||% "Future climate 2",
          maxnet_features = input$maxnet_features %||% sdm_default_maxnet_features,
          maxnet_regmult = input$maxnet_regmult %||% sdm_default_maxnet_regmult,
          brt_n_trees = input$brt_n_trees %||% 2000L,
          brt_interaction_depth = input$brt_interaction_depth %||% 3L,
          brt_shrinkage = input$brt_shrinkage %||% 0.01,
          brt_bag_fraction = input$brt_bag_fraction %||% 0.75,
          cta_cp = input$cta_cp %||% 0.01,
          cta_maxdepth = input$cta_maxdepth %||% 10L,
          cta_minsplit = input$cta_minsplit %||% 20L,
          mars_degree = input$mars_degree %||% 2L,
          mars_penalty = input$mars_penalty %||% 3.0,
          fda_degree = input$fda_degree %||% 2L,
          ann_size = input$ann_size %||% 5L,
          ann_decay = input$ann_decay %||% 0.01,
          ann_maxit = input$ann_maxit %||% 200L,
          dnn_n_seeds = input$dnn_n_seeds %||% 5L,
          dnn_mc_samples = input$dnn_mc_samples %||% 0L,
          dnn_uncertainty_method = input$dnn_uncertainty_method %||% "none",
          dnn_model_type = input$dnn_model_type %||% "DNN_Medium",
          gpu_enabled = input$gpu_enabled %||% "auto",
          dnn_device = input$dnn_device %||% "auto",
          dnn_mixed_precision = input$dnn_mixed_precision %||% "auto",
          dnn_cuda_graphs = input$dnn_cuda_graphs %||% "off",
          bias_method = input$bias_method %||% "uniform",
          target_group_occ = if (isTRUE(input$bias_method == "target_group") && !is.null(input$target_group_file)) {
            tryCatch(read.csv(input$target_group_file$datapath, header = TRUE), error = function(e) NULL)
          } else NULL,
          thickening_distance_km = if (isTRUE(input$bias_method == "thickened")) input$thickening_distance_km else NULL,
          cleaned_occurrence = rv$cleaned_occurrence,
          use_cc = TRUE,
          cc_tests = input$cc_tests %||% "all",
          max_coordinate_uncertainty = input$dwca_max_uncertainty %||% NULL,
          output_dir = sdm_default_output_dir,
          seed = sdm_default_seed,
          occurrence_source = occurrence$detail,
          gbif_doi = rv$gbif_doi,
          source = input$climate_source,
          log_fun = NULL,
          progress_fun = NULL,
          multi_ensemble_models = if (identical(input$model_id, "multi_ensemble")) {
            standalone <- input$multi_ensemble_standalone %||% character(0)
            if (length(input$multi_ensemble_biomod2 %||% character(0)) > 0) c(standalone, "biomod2") else standalone
          } else NULL,
          multi_ensemble_weighting = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_weighting %||% "auc" else "auc",
          multi_ensemble_power = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_power %||% sdm_default_ensemble_power else sdm_default_ensemble_power,
          multi_ensemble_min_auc = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_min_auc %||% sdm_default_ensemble_min_auc else sdm_default_ensemble_min_auc,
          multi_ensemble_min_tss = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_min_tss %||% sdm_default_ensemble_min_tss else sdm_default_ensemble_min_tss,
          export_ensemble_components = isTRUE(input$multi_ensemble_export),
          export_ensemble_stats = isTRUE(input$multi_ensemble_export),
          include_uncertainty = isTRUE(input$multi_ensemble_export),
          biomod2_models = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_biomod2 %||% NULL else NULL,
          esm_n_runs = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_n_runs %||% sdm_esm_default_n_runs else sdm_esm_default_n_runs,
          esm_split = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_split %||% sdm_esm_default_split else sdm_esm_default_split,
          esm_min_auc = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_min_auc %||% sdm_esm_default_min_auc else sdm_esm_default_min_auc,
          esm_weighting_metric = input$esm_weighting_metric %||% "AUC",
          esm_power = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_power %||% sdm_esm_default_power else sdm_esm_default_power,
          overlap_warn = !is.null(run_overlap) && (run_overlap$count == 0 || run_overlap$percent < 10),
          validation_occurrences = rv$validation_occurrences %||% NULL,
          allow_download = isTRUE(input$download_worldclim %||% TRUE)
        )

        result_file <- tempfile(pattern = "sdm_result_", fileext = ".rds")
        log_file <- tempfile(pattern = "sdm_log_", fileext = ".txt")
        bg_process <- tryCatch({
          start_model_bg(cfg, result_file, log_file)
        }, error = function(e) {
          append_log("Background process failed: ", conditionMessage(e), "; running synchronously")
          NULL
        })

        if (!is.null(bg_process)) {
          bg_state$process <- bg_process
          bg_state$result_file <- result_file
          bg_state$log_file <- log_file
          bg_state$active <- TRUE
          bg_state$start_time <- Sys.time()
          bg_state$last_log_lines <- 0
          bg_state$progress <- Progress$new(session, min = 0, max = 1)
          bg_state$progress$set(message = "Running SDM", value = 0.1)
        } else {
          result <- tryCatch(
            withCallingHandlers(
              run_fast_sdm(cfg),
              warning = function(w) { append_log(paste("Warning:", conditionMessage(w))); invokeRestart("muffleWarning") }
            ),
            error = function(e) { rv$error <- conditionMessage(e); append_log(paste("ERROR:", conditionMessage(e))); NULL }
          )
          if (!is.null(result)) {
            rv$result <- result
            store_past_run(rv, result)
          }
          rv$running <- FALSE
          message("SDM: Model run finished")
        }
      })
    })

  })
}
