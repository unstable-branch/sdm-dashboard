write_manifest <- function(result, output_dir, base_name) {
  tryCatch(
    {
      manifest <- list()

      manifest$run_timestamp <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")

      manifest$r_version <- R.version.string

      si <- sessionInfo()
      manifest$package_versions <- lapply(si$otherPkgs, function(pkg) {
        if (is.null(pkg$Version)) NA_character_ else pkg$Version
      })

      git_sha <- tryCatch(
        system("git rev-parse HEAD", intern = TRUE, ignore.stderr = TRUE),
        error = function(e) NA_character_
      )
      manifest$git_sha <- if (length(git_sha) == 1 && nzchar(git_sha)) git_sha else NA_character_

      if (!is.null(result$config$occurrence_file) && nzchar(result$config$occurrence_file)) {
        hash <- tryCatch(
          tools::md5sum(result$config$occurrence_file)[[1]],
          error = function(e) NA_character_
        )
        manifest$input_file_hash <- hash
      } else {
        manifest$input_file_hash <- NA_character_
      }

      manifest$cleaning_summary <- result$cleaning %||% list()
      manifest$covariate_source <- result$environment %||% list()
      manifest$model_id <- result$model_info$id %||% NA_character_
      manifest$model_label <- result$model_info$label %||% NA_character_
      manifest$cv_strategy <- result$config$cv_strategy %||% NA_character_
      manifest$cv_folds <- result$cv$k %||% NA_integer_
      manifest$output_paths <- result$paths %||% list()

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
