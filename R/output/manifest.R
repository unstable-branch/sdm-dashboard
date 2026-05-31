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

      manifest$cleaning_summary <- result$cleaning %||% list()
      manifest$covariate_source <- result$environment %||% list()
      manifest$model_id <- result$model_info$id %||% NA_character_
      manifest$model_label <- result$model_info$label %||% NA_character_
      manifest$cv_strategy <- result$config$cv_strategy %||% NA_character_
      manifest$cv_folds <- result$cv$k %||% NA_integer_
      manifest$output_paths <- result$paths %||% list()

      manifest$spatial <- list(
        analysis_crs = result$config$analysis_crs %||% sdm_default_analysis_crs %||% "auto",
        aoo_crs = result$eoo_aoo$aoo_crs %||% NA_character_,
        projection_extent = result$config$projection_extent %||% list(NA_real_, NA_real_, NA_real_, NA_real_),
        occurrence_bounds = if (!is.null(result$eoo_aoo) && !is.null(result$occ)) {
          occ <- result$occ
          if (is.data.frame(occ) && nrow(occ) > 0 && all(c("longitude", "latitude") %in% names(occ))) {
            list(
              lon_min = min(occ$longitude, na.rm = TRUE),
              lon_max = max(occ$longitude, na.rm = TRUE),
              lat_min = min(occ$latitude, na.rm = TRUE),
              lat_max = max(occ$latitude, na.rm = TRUE)
            )
          } else NULL
        } else NULL,
        eoo_km2 = result$eoo_aoo$eoo_km2 %||% NA_real_,
        aoo_km2 = result$eoo_aoo$aoo_km2 %||% NA_real_,
        aoo_cell_size_km = result$eoo_aoo$aoo_cell_size_km %||% 2,
        iucn_category = result$eoo_aoo$iucn_category %||% "Not evaluated"
      )

      if (!is.null(result$mess)) {
        manifest$mess_path <- result$mess$mess_tif %||% result$mess$paths$mess_tif %||% NA_character_
      } else {
        manifest$mess_path <- NA_character_
      }

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
