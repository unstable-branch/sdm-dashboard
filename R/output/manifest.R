write_manifest <- function(result, output_dir, base_name, cpu_ms = NA_real_, peak_mb = NA_real_,
                           occurrence_hash = NA_character_) {
  tryCatch(
    {
      cfg <- result$config %||% list()

      git_sha <- tryCatch(
        system("git rev-parse HEAD", intern = TRUE, ignore.stderr = TRUE),
        error = function(e) NA_character_
      )
      if (length(git_sha) != 1 || !nzchar(git_sha)) git_sha <- NA_character_

      si <- sessionInfo()
      pkg_versions <- list()
      if (!is.null(si$otherPkgs)) {
        for (pkg_name in names(si$otherPkgs)) {
          pkg_versions[[pkg_name]] <- si$otherPkgs[[pkg_name]]$Version %||% NA_character_
        }
      }

      occ_file <- cfg$occurrence_file %||% NA_character_
      if (is.na(occurrence_hash) && !is.na(occ_file) && nzchar(occ_file) && file.exists(occ_file)) {
        occurrence_hash <- tryCatch(
          digest::digest(occ_file, algo = "sha256", file = TRUE),
          error = function(e) NA_character_
        )
      }

      manifest <- list(
        run_timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
        app_version = list(
          git_sha = git_sha,
          r_version = R.version.string,
          platform = R.version$platform,
          package_versions = pkg_versions
        ),
        species = cfg$species %||% NA_character_,
        model = list(
          id = result$model_info$id %||% cfg$model_id %||% NA_character_,
          label = result$model_info$label %||% cfg$model_label %||% NA_character_,
          seed = as.integer(cfg$seed %||% sdm_default_seed),
          parameters = as.list(cfg)
        ),
        data = list(
          occurrence_file = occ_file,
          occurrence_hash_sha256 = occurrence_hash,
          cleaned_file = cfg$cleaned_file_id %||% NA_character_,
          cleaning_summary = result$cleaning %||% list()
        ),
        covariates = list(
          source = cfg$source %||% "worldclim",
          worldclim_dir = cfg$worldclim_dir %||% sdm_default_worldclim_dir,
          biovars = cfg$selected_biovars %||% list(),
          resolution = as.integer(cfg$worldclim_res %||% sdm_default_worldclim_res),
          vif_reduction = isTRUE(cfg$vif_reduction),
          vif_threshold = cfg$vif_threshold %||% NA_real_
        ),
        validation = list(
          cv_folds = as.integer(cfg$cv_folds %||% sdm_default_cv_folds),
          cv_strategy = cfg$cv_strategy %||% sdm_default_cv_strategy,
          cv_block_size_km = if (!is.null(cfg$cv_block_size_km) && is.finite(cfg$cv_block_size_km)) as.numeric(cfg$cv_block_size_km) else sdm_default_cv_block_size_km,
          seed = as.integer(cfg$seed %||% sdm_default_seed)
        ),
        metrics = if (!is.null(result$cv)) list(
          auc_mean = result$cv$auc_mean %||% NA_real_,
          auc_sd = result$cv$auc_sd %||% NA_real_,
          tss_mean = result$cv$tss_mean %||% NA_real_,
          tss_sd = result$cv$tss_sd %||% NA_real_,
          presence_records = result$metrics$presence_records %||% NA_integer_,
          background_points = result$metrics$background_points %||% NA_integer_,
          elapsed_seconds = result$metrics$elapsed_seconds %||% NA_real_,
          high_suitability_area_km2 = result$summary$high_risk_area_km2 %||% NA_real_
        ) else NULL,
        resources = list(
          r_cpu_time_ms = as.numeric(cpu_ms),
          r_peak_memory_mb = as.numeric(peak_mb)
        ),
        output_files = result$paths %||% list(),
        extent = if (!is.null(cfg$projection_extent)) list(
          xmin = cfg$projection_extent[1],
          xmax = cfg$projection_extent[2],
          ymin = cfg$projection_extent[3],
          ymax = cfg$projection_extent[4]
        ) else NULL
      )

      json_path <- file.path(output_dir, paste0(base_name, "_manifest.json"))
      jsonlite::write_json(manifest, json_path, auto_unbox = TRUE, pretty = TRUE)

      invisible(json_path)
    },
    error = function(e) {
      warning("write_manifest failed: ", conditionMessage(e))
      invisible(NULL)
    }
  )
}