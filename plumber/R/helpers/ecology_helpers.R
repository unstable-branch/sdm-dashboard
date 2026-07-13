handle_ecology_run <- function(res, run_id, app_dir) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  output_files <- meta$output_files %||% list()
  config <- meta$config %||% list()

  result <- list(
    run_id = run_id,
    species = config$species,
    model_id = config$model_id
  )

  eoo_aoo_file <- file.path(job_dir, "eoo_aoo.json")
  if (file.exists(eoo_aoo_file)) {
    result$eoo_aoo <- jsonlite::fromJSON(eoo_aoo_file, simplifyVector = FALSE)
  } else if (!is.null(meta$metrics) && !is.null(meta$metrics$eoo_aoo)) {
    result$eoo_aoo <- meta$metrics$eoo_aoo
  } else {
    result$eoo_aoo <- list(available = FALSE, message = "EOO/AOO not computed for this run")
  }

  aoa_png <- output_files$aoa_png
  if (!is.null(aoa_png) && file.exists(aoa_png)) {
    result$aoa <- list(available = TRUE, png = aoa_png)
  } else {
    result$aoa <- list(available = FALSE, message = "AOA not computed for this run")
  }

  cm_tif <- output_files$climate_matching_tif
  if (!is.null(cm_tif) && file.exists(cm_tif)) {
    result$climate_matching <- list(available = TRUE, tif = cm_tif)
  } else {
    result$climate_matching <- list(available = FALSE, message = "Climate matching not enabled for this run")
  }

  mess_tif <- output_files$future_mess_tif
  mod_tif <- output_files$future_mod_tif
  if (!is.null(mess_tif) && file.exists(mess_tif)) {
    result$mess <- list(
      available = TRUE,
      mess_tif = mess_tif,
      mod_tif = mod_tif,
      pct_extrapolation = if (!is.null(meta$metrics)) meta$metrics$mess_pct_extrapolation %||% NULL
    )
  } else {
    result$mess <- list(available = FALSE, message = "No future projection with MESS for this run")
  }

  niche_file <- file.path(job_dir, "niche_overlap.json")
  if (file.exists(niche_file)) {
    result$niche_overlap <- jsonlite::fromJSON(niche_file, simplifyVector = FALSE)
  }

  result
}

handle_ecology_eoo_aoo <- function(res, run_id, app_dir) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

  eoo_aoo_file <- file.path(job_dir, "eoo_aoo.json")
  if (file.exists(eoo_aoo_file)) {
    return(jsonlite::fromJSON(eoo_aoo_file, simplifyVector = FALSE))
  }

  if (!is.null(meta$metrics) && !is.null(meta$metrics$eoo_aoo)) {
    return(meta$metrics$eoo_aoo)
  }

  list(available = FALSE, message = "EOO/AOO not computed for this run")
}

handle_ecology_aoa <- function(res, run_id, app_dir) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  output_files <- meta$output_files %||% list()

  aoa_png <- output_files$aoa_png
  if (!is.null(aoa_png) && file.exists(aoa_png)) {
    list(available = TRUE, png = aoa_png)
  } else {
    list(available = FALSE, message = "AOA not computed for this run")
  }
}

handle_ecology_report <- function(res, run_id, app_dir) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  config <- meta$config %||% list()
  metrics <- meta$metrics %||% list()

  lines <- character(0)
  lines <- c(lines, paste0("Conservation Status Summary: ", config$species %||% "Unknown species"))
  lines <- c(lines, paste0("Model: ", config$model_id %||% "Unknown"))
  lines <- c(lines, "")

  eoo_aoo_file <- file.path(job_dir, "eoo_aoo.json")
  if (file.exists(eoo_aoo_file)) {
    eoo_aoo <- jsonlite::fromJSON(eoo_aoo_file, simplifyVector = FALSE)
    eoo_km2 <- eoo_aoo$eoo_km2 %||% NA
    aoo_km2 <- eoo_aoo$aoo_km2 %||% NA
    iucn_category <- eoo_aoo$iucn_category %||% "Unknown"

    lines <- c(lines, "Extent and Area of Occurrence:")
    if (!is.na(eoo_km2)) lines <- c(lines, paste0("  EOO: ", round(eoo_km2, 1), " km²"))
    if (!is.na(aoo_km2)) lines <- c(lines, paste0("  AOO: ", round(aoo_km2, 1), " km²"))
    lines <- c(lines, paste0("  IUCN Red List guidance: ", iucn_category))
    lines <- c(lines, "")
  }

  output_files <- meta$output_files %||% list()
  if (!is.null(output_files$aoa_png) && file.exists(output_files$aoa_png)) {
    lines <- c(lines, "Area of Applicability: Computed (see AOA map)")
    lines <- c(lines, "")
  }

  if (!is.null(output_files$climate_matching_tif) && file.exists(output_files$climate_matching_tif)) {
    lines <- c(lines, "Climate Matching: Enabled (see similarity map)")
    lines <- c(lines, "")
  }

  if (!is.null(output_files$future_mess_tif) && file.exists(output_files$future_mess_tif)) {
    lines <- c(lines, "MESS Extrapolation: Future projection computed")
    if (!is.null(metrics$mess_pct_extrapolation)) {
      lines <- c(lines, paste0("  % extrapolation: ", round(metrics$mess_pct_extrapolation, 1), "%"))
    }
    lines <- c(lines, "")
  }

  if (!is.null(metrics$auc_mean)) {
    lines <- c(lines, paste0("Model Performance: AUC = ", round(metrics$auc_mean, 3)))
  }
  if (!is.null(metrics$tss_mean)) {
    lines <- c(lines, paste0("  TSS = ", round(metrics$tss_mean, 3)))
  }

  paste(lines, collapse = "\n")
}

handle_ecology_niche_overlap <- function(req, app_dir) {
  body <- tryCatch(jsonlite::fromJSON(req$postBody), error = function(e) NULL)
  if (is.null(body)) return(sdm_error(req, 400, "Invalid JSON body"))

  run_id_1 <- body$run_id_1
  run_id_2 <- body$run_id_2
  if (is.null(run_id_1) || is.null(run_id_2)) {
    return(sdm_error(req, 400, "run_id_1 and run_id_2 are required"))
  }

  job_dir_1 <- sdm_safe_job_dir(run_id_1)
  job_dir_2 <- sdm_safe_job_dir(run_id_2)
  if (is.null(job_dir_1) || is.null(job_dir_2)) {
    return(sdm_error(req, 404, "One or both runs not found"))
  }
  meta_file_1 <- file.path(job_dir_1, "meta.json")
  meta_file_2 <- file.path(job_dir_2, "meta.json")

  if (!file.exists(meta_file_1) || !file.exists(meta_file_2)) {
    return(sdm_error(req, 404, "One or both runs not found"))
  }

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  job_id <- sdm_submit_async_job(req, app_dir, "niche_overlap", list(
    run_id_1 = run_id_1,
    run_id_2 = run_id_2,
    n_boot = body$n_boot %||% 100
  ), user_id)

  list(
    job_id = job_id,
    status = "running",
    message = "Niche overlap computation started in background"
  )
}
