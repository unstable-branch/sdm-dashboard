# Parallel batch SDM runner using future/future.apply.
#
# Design:
#   - Wraps run_fast_sdm() directly — all 40+ parameters overridable per-species.
#   - Parses a list of species configs (each a named list) into run_fast_sdm() calls.
#   - Uses future::plan(multisession) for cross-platform-safe parallelism.
#   - Each species run is independent — no shared state, minimal serialization overhead.
#   - Per-species results saved to disk as {slug}_{timestamp}.rds.
#   - Errors in one species are logged and return NULL; they do not stop the batch.
#
# CSV format (species_configs as data.frame rows):
#   species,occurrences_csv,model_id,biovars,use_elevation,elevation_demtype,
#   use_soil,soil_vars,soil_depths,use_uv,uv_vars,use_vegetation,veg_year,
#   veg_products,use_lulc,lulc_year,use_hfp,hfp_year,use_bioclim_season,
#   use_drought,drought_periods,worldclim_dir,projection_extent,background_n,
#   include_quadratic,threshold,cv_folds,aggregation_factor,vif_reduction,
#   bias_method,future_projection,future_worldclim_dir,seed
#
# Comma-separated list columns (biovars, soil_vars, etc.) are parsed automatically.

#' Parse a comma-separated string of integers.
#' @param x character vector, possibly with whitespace around values.
#' @return integer vector, or integer(0) if empty/NA.
parse_comma_ints <- function(x) {
  if (is.null(x) || is.na(x) || !nzchar(trimws(x))) return(integer(0))
  as.integer(unlist(strsplit(trimws(x), "\\s*,\\s*")))
}

#' Parse a comma-separated string of non-integer values (soil vars, veg products, etc.).
#' @param x character vector.
#' @return character vector, or character(0) if empty/NA.
parse_comma_strings <- function(x) {
  if (is.null(x) || is.na(x) || !nzchar(trimws(x))) return(character(0))
  trimws(unlist(strsplit(trimws(x), ",\\s*")))
}

#' Parse a logical value from a string ("TRUE", "FALSE", "true", "false", "1", "0").
#' @param x character or logical.
#' @return logical.
parse_logical <- function(x) {
  if (is.null(x) || is.na(x)) return(FALSE)
  if (is.logical(x)) return(x)
  x <- trimws(as.character(x))
  if (x == "") return(FALSE)
  tolower(x) %in% c("true", "1", "yes", "on")
}

#' Build a run_fast_sdm argument list from a config row (named list or data.frame row).
#' Only fields present in the config row are included in the returned list;
#' run_fast_sdm applies its own defaults for any missing parameters.
#' @param row named list with config fields (CSV column names as keys).
#' @return named list ready for do.call(run_fast_sdm, ...).
build_run_args <- function(row) {
  args <- list()

  if (nzchar(row$species %||% "")) args$species <- row$species
  if (nzchar(row$occurrences_csv %||% "")) args$occurrence_file <- row$occurrences_csv
  if (nzchar(row$worldclim_dir %||% "")) args$worldclim_dir <- row$worldclim_dir
  if (nzchar(row$biovars %||% "")) args$selected_biovars <- parse_comma_ints(row$biovars)
  if (nzchar(row$model_id %||% "")) args$model_id <- row$model_id

  bg <- suppressWarnings(as.integer(row$background_n %||% NA_integer_))
  if (!is.na(bg)) args$background_n <- bg

  mi <- suppressWarnings(as.integer(row$min_source_records %||% NA_integer_))
  if (!is.na(mi)) args$min_source_records <- mi

  args$include_quadratic <- parse_logical(row$include_quadratic %||% "TRUE")

  th <- suppressWarnings(as.numeric(row$threshold %||% NA_real_))
  if (!is.na(th)) args$threshold <- th

  af <- suppressWarnings(as.integer(row$aggregation_factor %||% NA_integer_))
  if (!is.na(af)) args$aggregation_factor <- af

  cv <- suppressWarnings(as.integer(row$cv_folds %||% NA_integer_))
  if (!is.na(cv)) args$cv_folds <- cv

  if (nzchar(row$elevation_demtype %||% "")) args$elevation_demtype <- row$elevation_demtype

  args$use_elevation <- parse_logical(row$use_elevation)
  args$use_soil <- parse_logical(row$use_soil)
  if (nzchar(row$soil_vars %||% "")) args$selected_soil_vars <- parse_comma_strings(row$soil_vars)
  if (nzchar(row$soil_depths %||% "")) args$selected_soil_depths <- parse_comma_strings(row$soil_depths)

  args$use_uv <- parse_logical(row$use_uv)
  if (nzchar(row$uv_vars %||% "")) args$selected_uv_vars <- parse_comma_strings(row$uv_vars)

  args$use_vegetation <- parse_logical(row$use_vegetation)
  vy <- suppressWarnings(as.integer(row$veg_year %||% NA_integer_))
  if (!is.na(vy)) args$veg_year <- vy
  if (nzchar(row$veg_products %||% "")) args$veg_products <- parse_comma_strings(row$veg_products)

  args$use_lulc <- parse_logical(row$use_lulc)
  ly <- suppressWarnings(as.integer(row$lulc_year %||% NA_integer_))
  if (!is.na(ly)) args$lulc_year <- ly

  args$use_hfp <- parse_logical(row$use_hfp)
  hy <- suppressWarnings(as.integer(row$hfp_year %||% NA_integer_))
  if (!is.na(hy)) args$hfp_year <- hy

  args$use_bioclim_season <- parse_logical(row$use_bioclim_season)
  args$use_drought <- parse_logical(row$use_drought)
  if (nzchar(row$drought_periods %||% "")) args$selected_drought_periods <- parse_comma_strings(row$drought_periods)

  args$vif_reduction <- parse_logical(row$vif_reduction)

  if (nzchar(row$bias_method %||% "")) args$bias_method <- row$bias_method

  args$future_projection <- parse_logical(row$future_projection)
  if (nzchar(row$future_worldclim_dir %||% "")) args$future_worldclim_dir <- row$future_worldclim_dir

  sd <- suppressWarnings(as.integer(row$seed %||% NA_integer_))
  if (!is.na(sd)) args$seed <- sd

  args$use_cc <- FALSE
  args$cleaned_occurrence <- NULL
  args$log_fun <- NULL
  args$progress_fun <- NULL

  args
}

if (!exists("normalize_core_count", envir = globalenv())) {
  normalize_core_count <- function(n_cores = NULL, reserve_one = FALSE) {
    if (is.null(n_cores)) {
      n <- parallel::detectCores()
      if (is.na(n)) n <- 2L
      if (reserve_one) n <- max(1, n - 1)
      return(as.integer(n))
    }
    n <- as.integer(n_cores[1])
    if (is.na(n) || n < 1) n <- 1
    n
  }
}

write_batch_summary_csv <- function(results, output_dir) {
  summary_rows <- lapply(results, function(r) {
    if (is.null(r)) {
      data.frame(
        species = NA_character_,
        status = "error",
        auc_mean = NA_real_,
        tss_mean = NA_real_,
        cbi = NA_real_,
        elapsed_seconds = NA_real_,
        stringsAsFactors = FALSE
      )
    } else {
      sp <- r$config$species %||% NA_character_
      auc <- tryCatch(r$cv$auc_mean %||% NA_real_, error = function(e) NA_real_)
      tss <- tryCatch(r$cv$tss_mean %||% NA_real_, error = function(e) NA_real_)
      cbi_val <- tryCatch(r$cv$cbi %||% NA_real_, error = function(e) NA_real_)
      elapsed <- tryCatch(r$metrics$elapsed_seconds %||% NA_real_, error = function(e) NA_real_)
      data.frame(
        species = sp,
        status = "success",
        auc_mean = auc,
        tss_mean = tss,
        cbi = cbi_val,
        elapsed_seconds = elapsed,
        stringsAsFactors = FALSE
      )
    }
  })
  df <- do.call(rbind, summary_rows)
  out_path <- file.path(output_dir, "batch_summary.csv")
  write.csv(df, out_path, row.names = FALSE)
  message("[batch] Wrote summary: ", out_path)
}

#' Run multiple species SDM models in parallel.
#'
#' @param species_configs list of named lists, each containing per-species configuration.
#'        Required fields per entry: \code{species} and \code{occurrences_csv}.
#'        All other run_fast_sdm parameters can be set per-entry; defaults used if missing.
#' @param n_cores integer; number of parallel workers. \code{NULL} auto-detects via
#'        \code{normalize_core_count()} (defaults to detectCores() - 1).
#' @param output_dir character; directory for per-species .rds output files.
#'        Created if it does not exist. Default: "batch_results/".
#' @param progress_fun function(amount, detail); called for each progress step.
#'        Default NULL suppresses sub-progress in parallel workers.
#' @param seed integer for reproducibility (passed to \code{future.seed} on
#'        \code{future_lapply}). Default 42L.
#'
#' @return invisibly a list of result objects (one per species). Each element is
#'         the return value of \code{run_fast_sdm()}, or \code{NULL} if that species
#'         errored. Results are also saved individually to \file{{species_slug}.rds}
#'         in \code{output_dir}.
#'
#' @examples
#' configs <- list(
#'   list(species = "Acacia mearnsii",
#'        occurrences_csv = "data/acacia.csv",
#'        model_id = "glm",
#'        biovars = "1,4,6,12,15,18"),
#'   list(species = "Opuntia stricta",
#'        occurrences_csv = "data/opuntia.csv",
#'        model_id = "glm",
#'        biovars = "1,4,6,12,15,18")
#' )
#' batch_run_parallel(configs, n_cores = 2, output_dir = "results/")
batch_run_parallel <- function(species_configs,
                                n_cores = NULL,
                                output_dir = "batch_results/",
                                progress_fun = NULL,
                                seed = 42L) {

  if (!is.list(species_configs) || length(species_configs) == 0) {
    stop("species_configs must be a non-empty list", call. = FALSE)
  }

  n_cores <- normalize_core_count(n_cores, reserve_one = is.null(n_cores))
  if (n_cores < 1) {
    warning("n_cores < 1; forcing to 1 (serial execution)")
    n_cores <- 1
  }

  dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

  if (n_cores == 1) {
    future::plan(future::sequential, .skip = TRUE)
    message("[batch] Using sequential execution (n_cores = 1)")
  } else {
    future::plan(future::multisession, workers = n_cores, .skip = TRUE)
    message("[batch] Using parallel execution with ", n_cores, " workers")
  }

  p <- function(...) {
    msg <- paste(..., collapse = "")
    message(msg)
    if (is.function(progress_fun)) progress_fun(msg)
  }

  p("[batch] Starting batch run: ", length(species_configs), " species")

  results <- future.apply::future_lapply(
    seq_along(species_configs),
    FUN = function(i) {
      cfg <- species_configs[[i]]
      sp_name <- cfg$species %||% "unknown_species"
      slug <- safe_slug(sp_name)

      tryCatch({
        call_args <- build_run_args(cfg)
        call_args$output_dir <- output_dir

        message("[", i, "/", length(species_configs), "] Starting: ", sp_name)
        result <- do.call(run_fast_sdm, call_args)

        output_path <- file.path(output_dir, paste0(slug, "_result.rds"))
        saveRDS(result, output_path)
        message("[", i, "/", length(species_configs), "] Done: ", sp_name,
                " -> ", basename(output_path))

        result
      },
      error = function(e) {
        err_path <- file.path(output_dir, paste0(slug, "_ERROR.log"))
        writeLines(c(
          format(Sys.time()),
          paste0("Species: ", sp_name),
          paste0("Error: ", conditionMessage(e)),
          paste0("Call: ", conditionCall(e), collapse = "\n")
        ), con = err_path)
        message("[", i, "/", length(species_configs), "] ERROR: ", sp_name,
                " — see ", err_path)
        NULL
      })
    },
    future.seed = seed
  )

  future::plan(future::sequential, .skip = TRUE)

  n_success <- sum(!sapply(results, is.null))
  n_error <- length(results) - n_success
  p("\n=== BATCH COMPLETE ===")
  p("Successful: ", n_success, " / ", length(results))
  if (n_error > 0) {
    p("Errors (see *_ERROR.log): ", n_error)
  }

  write_batch_summary_csv(results, output_dir)

  invisible(results)
}

#' Parse a batch config CSV into a list of species configs.
#'
#' @param config_csv path to CSV file with one row per species.
#' @return list of named lists, one per row, suitable for \code{batch_run_parallel()}.
#'
#' @examples
#' configs <- parse_batch_config("species_batch.csv")
#' batch_run_parallel(configs, n_cores = 4)
parse_batch_config <- function(config_csv) {
  if (!file.exists(config_csv)) {
    stop("Batch config CSV not found: ", config_csv, call. = FALSE)
  }
  df <- read.csv(config_csv, stringsAsFactors = FALSE, header = TRUE,
                check.names = FALSE)
  if (nrow(df) == 0) {
    stop("Batch config CSV is empty: ", config_csv, call. = FALSE)
  }

  lapply(seq_len(nrow(df)), function(i) {
    as.list(df[i, ])
  })
}
