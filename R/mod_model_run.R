mod_model_run_server <- function(id, rv, input, append_log, occurrence_source, last_progress) {
  moduleServer(id, function(input, output, session) {

    observeEvent(input$cancel_model, {
      if (!isTRUE(rv$running)) return()
      message("SDM: Run cancelled by user")
      options(sdm_cancelled = TRUE)
      rv$running <- FALSE
      rv$error <- "Run cancelled."
      append_log("Run cancelled by user.")
    })

    observe({
      tryCatch({
        session$sendCustomMessage("setRunState", list(running = isTRUE(rv$running)))
      }, error = function(e) {
        message("Warning: setRunState message failed: ", conditionMessage(e))
      })
    })

    observeEvent(input$run_model, {
      message("SDM: Run SDM button clicked")
      if (isTRUE(rv$running)) {
        message("SDM: Already running, ignoring click")
        return(invisible(NULL))
      }
      rv$error <- NULL; options(sdm_cancelled = FALSE); rv$running <- TRUE; rv$log <- ""
      message("SDM: Starting model run")
      on.exit({ rv$running <- FALSE; message("SDM: Model run finished") }, add = TRUE)
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
          background_n = input$background_n,
          min_source_records = input$min_source_records,
          merge_small_sources = isTRUE(input$merge_small_sources) %||% TRUE,
          thin_by_cell = isTRUE(input$thin_by_cell),
          model_id = input$model_id,
          include_quadratic = isTRUE(input$quadratic),
          threshold = input$threshold,
          aggregation_factor = input$aggregation_factor,
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
          future_projection = isTRUE(input$future_projection),
          future_worldclim_dir = input$future_worldclim_dir,
          future_label = input$future_label,
          maxnet_features = input$maxnet_features %||% sdm_default_maxnet_features,
          maxnet_regmult = input$maxnet_regmult %||% sdm_default_maxnet_regmult,
          bias_method = input$bias_method %||% "uniform",
          target_group_occ = if (isTRUE(input$bias_method == "target_group") && !is.null(input$target_group_file)) {
            tryCatch(read.csv(input$target_group_file$datapath, header = TRUE), error = function(e) NULL)
          } else NULL,
          thickening_distance_km = if (isTRUE(input$bias_method == "thickened")) input$thickening_distance_km else NULL,
          cleaned_occurrence = rv$cleaned_occurrence,
          use_cc = TRUE,
          cc_tests = input$cc_tests %||% "all",
          output_dir = sdm_default_output_dir,
          seed = sdm_default_seed,
          occurrence_source = occurrence$detail,
          gbif_doi = rv$gbif_doi,
          source = input$climate_source,
          log_fun = append_log,
          progress_fun = function(p) {
            if (is.list(p) && !is.null(p$detail)) {
              incProgress(p$value - last_progress(), detail = p$detail)
              last_progress(p$value)
            } else {
              incProgress(as.numeric(p))
            }
          },
          multi_ensemble_models = if (identical(input$model_id, "multi_ensemble")) {
            standalone <- input$multi_ensemble_standalone %||% character(0)
            if (length(input$multi_ensemble_biomod2 %||% character(0)) > 0) c(standalone, "biomod2") else standalone
          } else NULL,
          multi_ensemble_weighting = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_weighting %||% "auc" else "auc",
          multi_ensemble_power = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_power %||% sdm_default_ensemble_power else sdm_default_ensemble_power,
          multi_ensemble_min_auc = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_min_auc %||% sdm_default_ensemble_min_auc else sdm_default_ensemble_min_auc,
          multi_ensemble_min_tss = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_min_tss %||% sdm_default_ensemble_min_tss else sdm_default_ensemble_min_tss,
          multi_ensemble_export = isTRUE(input$multi_ensemble_export),
          biomod2_models = if (identical(input$model_id, "multi_ensemble")) input$multi_ensemble_biomod2 %||% NULL else NULL,
          esm_n_runs = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_n_runs %||% sdm_esm_default_n_runs else sdm_esm_default_n_runs,
          esm_split = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_split %||% sdm_esm_default_split else sdm_esm_default_split,
          esm_min_auc = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_min_auc %||% sdm_esm_default_min_auc else sdm_esm_default_min_auc,
          esm_power = if (identical(input$model_id, "esm_glm") || identical(input$model_id, "esm_maxnet")) input$esm_power %||% sdm_esm_default_power else sdm_esm_default_power,
          overlap_warn = !is.null(run_overlap) && (run_overlap$count == 0 || run_overlap$percent < 10)
        )

        result <- tryCatch(
          withCallingHandlers(
            run_fast_sdm(cfg),
            warning = function(w) { append_log(paste("Warning:", conditionMessage(w))); invokeRestart("muffleWarning") }
          ),
          error = function(e) { rv$error <- conditionMessage(e); append_log(paste("ERROR:", conditionMessage(e))); NULL }
        )
        if (!is.null(result)) rv$result <- result
      })
    })

  })
}