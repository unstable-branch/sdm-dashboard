#!/usr/bin/env Rscript
# plumber/R/async_dispatcher.R
#
# Generic async job dispatcher for Plumber data endpoints.
# Called by callr::r_bg — reads input.json from job_dir, processes,
# and writes result.json.
#
# Job types:
#   clean        — run_clean_occurrence(input_file, params)
#   niche_overlap — compute_niche_overlap(run_id_1, run_id_2, params)
#   dwca         — parse Darwin Core Archive
#   gbif         — search GBIF

`%||%` <- function(a, b) if (is.null(a)) b else a

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 2) {
  cat("Usage: Rscript async_dispatcher.R <app_dir> <job_dir>\n")
  quit(status = 1)
}

app_dir <- args[1]
job_dir <- args[2]

# Source project infrastructure
source(file.path(app_dir, "R", "core", "bootstrap.R"))
sdm_set_project_root(app_dir)
source(file.path(app_dir, "R", "engine_load.R"))

input_file <- file.path(job_dir, "input.json")
result_file <- file.path(job_dir, "result.json")
progress_file <- file.path(job_dir, "progress.log")

log_lines <- character(0)
log_msg <- function(...) {
  msg <- paste0(format(Sys.time(), "%H:%M:%S"), " ", ...)
  cat(msg, "\n")
  cat(msg, "\n", file = progress_file, append = TRUE)
  log_lines <<- c(log_lines, msg)
}

if (!file.exists(input_file)) {
  log_msg("ERROR: No input.json found in ", job_dir)
  writeLines(jsonlite::toJSON(list(status = "failed", error = "No input file"), auto_unbox = TRUE), result_file)
  quit(status = 1)
}

input <- jsonlite::fromJSON(input_file, simplifyVector = FALSE)
job_type <- input$type %||% "unknown"

log_msg("Starting async job: ", job_type)

result <- tryCatch({
  switch(job_type,
    clean = {
      file_id <- input$file_id
      cleaned_file_id <- input$cleaned_file_id %||% NULL

      safe_path <- tryCatch({
        base_dir <- file.path(app_dir, "data", "uploads")
        base_norm <- normalizePath(base_dir, winslash = "/", mustWork = TRUE)
        resolved <- normalizePath(file.path(base_dir, basename(file_id)), winslash = "/", mustWork = FALSE)
        if (startsWith(resolved, paste0(base_norm, "/"))) resolved else NULL
      }, error = function(e) NULL)

      if (is.null(safe_path)) {
        list(status = "failed", error = "Invalid file_id")
      } else {
        occ <- clean_occurrences(
          path = safe_path,
          min_source_records = input$min_source_records %||% 15L,
          merge_small_sources = input$merge_small_sources %||% TRUE,
          use_cc = input$use_cc %||% FALSE,
          cc_tests = input$cc_tests %||% "all",
          max_coordinate_uncertainty = input$max_coordinate_uncertainty %||% NULL,
          max_records = input$max_records %||% 200000L,
          log_fun = log_msg
        )

        cleaned_path <- file.path(
          app_dir, "data", "uploads",
          paste0("cleaned_", format(Sys.time(), "%Y%m%d_%H%M%S_"), basename(file_id))
        )
        utils::write.csv(occ$occ, cleaned_path, row.names = FALSE)
        encrypt_file(cleaned_path, paste0(cleaned_path, ".enc"))
        unlink(cleaned_path)
        cleaned_path <- paste0(cleaned_path, ".enc")

        species_counts <- if ("species" %in% names(occ$occ)) {
          as.list(sort(table(occ$occ$species), decreasing = TRUE))
        } else list()

        list(
          status = "completed",
          result = list(
            cleaned_id = file_id,
            cleaned_file_id = cleaned_path,
            valid_records = nrow(occ$occ),
            original_rows = occ$original_rows,
            removed_bad_coordinates = occ$removed_bad_coordinates,
            removed_duplicates = occ$removed_duplicates,
            n_absent_excluded = occ$n_absent_excluded,
            source_counts = as.list(occ$source_counts),
            species_counts = species_counts,
            cc_flagged = if ("cc_flag" %in% names(occ$occ)) sum(occ$occ$cc_flag, na.rm = TRUE) else 0L,
            cc_log = I(log_lines),
            cleaned_records = lapply(head(seq_len(nrow(occ$occ)), 100), function(i) as.list(occ$occ[i, ]))
          )
        )
      }
    },

    dwca = {
      file_id <- input$file_id
      safe_path <- tryCatch({
        base_dir <- file.path(app_dir, "data", "uploads")
        base_norm <- normalizePath(base_dir, winslash = "/", mustWork = TRUE)
        resolved <- normalizePath(file.path(base_dir, basename(file_id)), winslash = "/", mustWork = FALSE)
        if (startsWith(resolved, paste0(base_norm, "/"))) resolved else NULL
      }, error = function(e) NULL)

      if (is.null(safe_path)) {
        list(status = "failed", error = "Invalid file_id")
      } else {
        result_dwca <- read_dwca(
          dwca_path = safe_path,
          species_filter = input$species_filter %||% NULL,
          max_coord_uncertainty_m = suppressWarnings(as.numeric(input$max_coord_uncertainty_m)) %||% Inf,
          basis_of_record_filter = input$basis_of_record_filter %||% NULL,
          log_fun = log_msg
        )

        occ <- result_dwca$occurrences
        list(
          status = "completed",
          result = list(
            doi = result_dwca$doi,
            n_raw = result_dwca$n_raw,
            n_returned = result_dwca$n_returned,
            datasets = result_dwca$datasets,
            issues_flagged_count = if (!is.null(result_dwca$issues_flagged)) nrow(result_dwca$issues_flagged) else 0L,
            preview = head(lapply(seq_len(min(5, nrow(occ))), function(i) as.list(occ[i, ])), 5)
          )
        )
      }
    },

    gbif = {
      taxon <- input$taxon
      if (is.null(taxon) || !nzchar(taxon)) {
        list(status = "failed", error = "taxon is required")
      } else {
        # Check for authenticated download credentials
        use_auth <- isTRUE(input$use_auth)
        gbif_user <- if (use_auth) {
          input$gbif_user %||% Sys.getenv("GBIF_USER", unset = NA_character_)
        } else NA_character_
        gbif_pwd <- if (use_auth) {
          input$gbif_pwd %||% Sys.getenv("GBIF_PWD", unset = NA_character_)
        } else NA_character_
        gbif_email <- if (use_auth) {
          input$gbif_email %||% Sys.getenv("GBIF_EMAIL", unset = NA_character_)
        } else NA_character_

        if (use_auth && !is.na(gbif_user) && !is.na(gbif_pwd) && !is.na(gbif_email)) {
          dl <- read_gbif_download(
            taxon = taxon,
            country = input$country %||% NULL,
            gbif_user = gbif_user,
            gbif_pwd = gbif_pwd,
            email = gbif_email,
            max_records = input$max_records %||% 200000L,
            log_fun = log_msg
          )
          occ <- dl$occurrences
          doi <- dl$doi %||% NA_character_
          total_available <- nrow(occ)
        } else {
          occ <- read_gbif_records(
            taxon = taxon,
            country = input$country %||% NULL,
            max_records = input$max_records %||% 100L,
            log_fun = log_msg
          )
          doi <- if (!is.null(occ$gbif_doi[1]) && nzchar(occ$gbif_doi[1])) occ$gbif_doi[1] else NA_character_
          total_available <- attr(occ, "gbif_total_available", exact = TRUE) %||% nrow(occ)
        }

        upload_dir <- file.path(app_dir, "data", "uploads")
        dir.create(upload_dir, recursive = TRUE, showWarnings = FALSE)
        safe_name <- gsub("[^a-zA-Z0-9._-]", "_", taxon)
        ts <- format(Sys.time(), "%Y%m%d_%H%M%S")
        csv_path <- file.path(upload_dir, paste0(ts, "_gbif_", safe_name, ".csv"))
        utils::write.csv(occ, csv_path, row.names = FALSE)

        list(
          status = "completed",
          result = list(
            taxon = taxon,
            country = input$country %||% NULL,
            n_records = nrow(occ),
            max_records = input$max_records %||% 100L,
            total_available = total_available,
            doi = doi,
            file_path = csv_path,
            preview = head(lapply(seq_len(min(5, nrow(occ))), function(i) as.list(occ[i, ])), 5)
          )
        )
      }
    },

    ala = {
      taxon <- input$taxon
      if (is.null(taxon) || !nzchar(taxon)) {
        list(status = "failed", error = "taxon is required")
      } else {
        api_key <- input$api_key %||% NA_character_

        occ <- read_ala_records(
          taxon = taxon,
          country = input$country %||% NULL,
          max_records = input$max_records %||% 100L,
          api_key = if (nzchar(api_key %||% "")) api_key else NULL,
          log_fun = log_msg
        )

        upload_dir <- file.path(app_dir, "data", "uploads")
        dir.create(upload_dir, recursive = TRUE, showWarnings = FALSE)
        safe_name <- gsub("[^a-zA-Z0-9._-]", "_", taxon)
        ts <- format(Sys.time(), "%Y%m%d_%H%M%S")
        csv_path <- file.path(upload_dir, paste0(ts, "_ala_", safe_name, ".csv"))
        utils::write.csv(occ, csv_path, row.names = FALSE)

        list(
          status = "completed",
          result = list(
            taxon = taxon,
            country = input$country %||% NULL,
            n_records = nrow(occ),
            max_records = input$max_records %||% 100L,
            total_available = attr(occ, "ala_total_available", exact = TRUE) %||% nrow(occ),
            limit = attr(occ, "ala_limit_applied", exact = TRUE) %||% nrow(occ),
            doi = NA_character_,
            file_path = csv_path,
            preview = head(lapply(seq_len(min(5, nrow(occ))), function(i) as.list(occ[i, ])), 5)
          )
        )
      }
    },

    niche_overlap = {
      run_id_1 <- input$run_id_1
      run_id_2 <- input$run_id_2

      job_dir_1 <- file.path(app_dir, "outputs", "jobs", basename(run_id_1))
      job_dir_2 <- file.path(app_dir, "outputs", "jobs", basename(run_id_2))
      meta_file_1 <- file.path(job_dir_1, "meta.json")
      meta_file_2 <- file.path(job_dir_2, "meta.json")

      if (!file.exists(meta_file_1) || !file.exists(meta_file_2)) {
        list(status = "failed", error = "One or both runs not found")
      } else {
        meta_1 <- jsonlite::fromJSON(meta_file_1, simplifyVector = FALSE)
        meta_2 <- jsonlite::fromJSON(meta_file_2, simplifyVector = FALSE)
        occ_file_1 <- meta_1$config$occurrence_file
        occ_file_2 <- meta_2$config$occurrence_file

        if (!file.exists(occ_file_1) || !file.exists(occ_file_2)) {
          list(status = "failed", error = "Occurrence files not found")
        } else {
          env_dir <- meta_1$config$worldclim_dir %||% sdm_default_worldclim_dir
          biovars <- as.integer(unlist(strsplit(as.character(meta_1$config$biovars %||% "1,4,6,12,15,18"), ",")))
          tif_pattern <- paste0("(", paste0("bio", biovars, collapse = "|"), ")\\.tif$")
          tif_files <- list.files(env_dir, pattern = tif_pattern, full.names = TRUE, recursive = TRUE)

          if (length(tif_files) == 0) {
            list(status = "failed", error = "No climate TIFF files found")
          } else {
            env <- terra::rast(tif_files[1])
            if (length(tif_files) > 1) env <- terra::rast(tif_files)

            source(sdm_resolve_module("niche_overlap.R"), local = TRUE)
            overlap <- compute_niche_overlap(
              read_occurrence_file(occ_file_1, log_fun = log_msg),
              read_occurrence_file(occ_file_2, log_fun = log_msg),
              env, n_boot = input$n_boot %||% 100, log_fun = log_msg
            )

            list(
              status = "completed",
              result = list(
                run_id_1 = run_id_1,
                run_id_2 = run_id_2,
                species_1 = meta_1$config$species,
                species_2 = meta_2$config$species,
                D = overlap$D,
                I = overlap$I,
                stability = overlap$stability,
                unfilling = overlap$unfilling,
                expansion = overlap$expansion,
                centroid_distance = overlap$centroid_distance,
                n_native = overlap$n_native,
                n_introduced = overlap$n_introduced
              )
            )
          }
        }
      }
    },

    {
      list(status = "failed", error = paste("Unknown job type:", job_type))
    }
  )
}, error = function(e) {
  list(status = "failed", error = conditionMessage(e))
})

log_msg("Async job ", job_type, " completed with status: ", result$status)
writeLines(jsonlite::toJSON(result, auto_unbox = TRUE, pretty = TRUE), result_file)
