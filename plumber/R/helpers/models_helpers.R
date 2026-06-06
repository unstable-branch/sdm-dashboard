sdm_process_registry <- new.env(parent = emptyenv())

handle_model_run <- function(req, app_dir) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody),
    error = function(e) {
      cat("JSON parse error:", conditionMessage(e), "\n")
      NULL
    }
  )
  if (is.null(body)) return(sdm_error_code(req, "INVALID_INPUT", "Request body is empty or not valid JSON"))

  required <- c("species", "model_id", "occurrence_file")
  missing <- setdiff(required, names(body))
  if (length(missing) > 0) {
    return(sdm_error_code(req, "INVALID_INPUT", paste("Missing required fields:", paste(missing, collapse = ", "))))
  }

  biovars <- as.integer(unlist(strsplit(as.character(body$biovars %||% "1,4,6,12,15,18"), ",")))
  projection_extent <- as.numeric(unlist(strsplit(as.character(body$projection_extent %||% "112,154,-44,-10"), ",")))
  if (length(projection_extent) != 4 || any(!is.finite(projection_extent))) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent must have 4 numeric values: xmin,xmax,ymin,ymax"))
  }
  if (projection_extent[1] >= projection_extent[2] || projection_extent[3] >= projection_extent[4]) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent has invalid ordering: xmin must be < xmax, ymin must be < ymax"))
  }
  if (projection_extent[1] < -180 || projection_extent[2] > 180 || projection_extent[3] < -90 || projection_extent[4] > 90) {
    return(sdm_error_code(req, "INVALID_INPUT", "projection_extent is outside valid coordinate bounds (\u00b1180, \u00b190)"))
  }

  tryCatch({
    mem_info <- terra::mem_info()
    if (is.list(mem_info) && is.numeric(mem_info$memavail) && is.finite(mem_info$memavail)) {
      if (mem_info$memavail < 1.0) {
        return(sdm_error_code(req, "INTERNAL_ERROR", paste0(
          "Server memory critically low (", sprintf("%.1f", mem_info$memavail),
          " GB available). Wait for other runs to complete or restart the container."
        )))
      }
    }
  }, error = function(e) NULL)

  active <- sdm_count_active_runs()
  if (active >= SDM_MAX_CONCURRENT_RUNS) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste0(
      "Server busy: ", active, " model run(s) in progress (max ", SDM_MAX_CONCURRENT_RUNS,
      "). Please wait and retry."
    )))
  }

  job_id <- paste0("run-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  script_path <- file.path(app_dir, "plumber", "R", "run_model_background.R")
  if (!file.exists(script_path)) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste("Model run script not found at:", script_path)))
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  cmdargs = c("--no-save", "--no-restore", "--no-init-file"),
  env = c(
    HOME = "/app",
    OMP_THREAD_LIMIT = as.character(getOption("sdm.omp_thread_limit", "1")),
    R_MAX_VSIZE = sdm_detect_vsize()
  ))
  sdm_process_registry[[job_id]] <- proc

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "pending",
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config = as.list(body),
    output_dir = job_dir,
    process_pid = proc$get_pid()
  )
  job_meta_file <- file.path(job_dir, "meta.json")
  sdm_write_json(job_meta, job_meta_file)

  progress_log <- file.path(job_dir, "progress.log")

  list(
    job_id = job_id,
    status = "running",
    message = "Model run started in background"
  )
}

handle_targets_run <- function(req, app_dir) {
  body <- tryCatch(
    jsonlite::fromJSON(req$postBody),
    error = function(e) NULL
  )
  if (is.null(body) || is.null(body$configs) || length(body$configs) == 0) {
    return(sdm_error_code(req, "INVALID_INPUT", "Request body must contain a non-empty 'configs' array"))
  }

  job_id <- paste0("targets-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
  job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
  dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

  user_id <- if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) req$user_id else "anonymous"

  configs <- body$configs
  csv_rows <- lapply(seq_along(configs), function(i) {
    c <- configs[[i]]
    data.frame(
      species = c$species %||% "",
      species_filter = c$species_filter %||% c$species %||% "",
      occurrences_csv = c$cleaned_file_id %||% c$occurrence_file %||% "",
      model_id = c$model_id %||% "glm",
      biovars = paste(c$biovars %||% "1,4,6,12,15,18", collapse = ","),
      projection_extent = paste(c$projection_extent %||% "112,154,-44,-10", collapse = ","),
      background_n = as.character(c$background_n %||% 10000),
      cv_folds = as.character(c$cv_folds %||% 5),
      threshold = as.character(c$threshold %||% 0.5),
      stringsAsFactors = FALSE
    )
  })
  config_df <- do.call(rbind, csv_rows)
  config_csv <- file.path(job_dir, "config.csv")
  write.csv(config_df, config_csv, row.names = FALSE)

  job_meta <- list(
    id = job_id,
    user_id = user_id,
    status = "queued",
    type = "targets",
    n_species = length(configs),
    started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    config_csv = config_csv
  )
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"))

  script_path <- file.path(app_dir, "plumber", "R", "targets_dispatcher.R")
  if (!file.exists(script_path)) {
    return(sdm_error_code(req, "INTERNAL_ERROR", paste("Targets dispatcher not found at:", script_path)))
  }

  proc <- callr::r_bg(function(script, job_dir, app_dir) {
    source(script, local = TRUE)
  }, args = list(script_path, job_dir, app_dir),
  stdout = file.path(job_dir, "stdout.log"),
  stderr = file.path(job_dir, "stderr.log"),
  cmdargs = c("--no-save", "--no-restore", "--no-init-file"),
  env = c(HOME = "/app"))
  sdm_process_registry[[job_id]] <- proc

  job_meta$process_pid <- proc$get_pid()
  job_meta$status <- "running"
  sdm_write_json(job_meta, file.path(job_dir, "meta.json"))

  list(
    job_id = job_id,
    status = "running",
    n_species = length(configs),
    message = paste0("Targets pipeline started with ", length(configs), " species")
  )
}

handle_targets_status <- function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      res$status <- 500L
      return(list(error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)

  if (identical(meta$status, "running")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({ process_alive <- tools::pskill(pid, signal = 0) }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed"
      meta$error_code <- "PROCESS_CRASH"
      meta$error_hint <- "The process was terminated by the OS, likely due to insufficient memory. Reduce covariates, use coarser resolution, or increase available memory."
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
    }
  }

  store_path <- file.path(job_dir, "_targets")
  targets_progress <- NULL
  if (dir.exists(store_path)) {
    tryCatch({
      tm <- targets::tar_meta(store = store_path)
      if (is.data.frame(tm) && nrow(tm) > 0) {
        targets_progress <- list(
          total_targets = nrow(tm),
          completed = sum(tm$status == "completed", na.rm = TRUE),
          errored = sum(tm$status == "errored", na.rm = TRUE),
          running = sum(tm$status == "running", na.rm = TRUE)
        )
        targets_progress$targets <- lapply(seq_len(nrow(tm)), function(i) {
          list(
            name = tm$name[i],
            type = tm$type[i] %||% "stem",
            status = tm$status[i] %||% "unknown",
            seconds = if (!is.null(tm$seconds[i]) && is.finite(tm$seconds[i])) tm$seconds[i] else NULL,
            error = if (!is.null(tm$error[i]) && nzchar(tm$error[i] %||% "")) tm$error[i] else NULL
          )
        })
      }
    }, error = function(e) NULL)
  }

  progress_log <- character(0)
  progress_file <- file.path(job_dir, "progress.log")
  if (file.exists(progress_file)) {
    progress_log <- readLines(progress_file, warn = FALSE)
  }

  list(
    id = meta$id,
    status = meta$status,
    n_species = meta$n_species %||% 0,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    targets_progress = targets_progress,
    progress_log = progress_log
  )
}

handle_targets_results <- function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  store_path <- file.path(job_dir, "_targets")

  results <- list()
  if (dir.exists(store_path)) {
    tryCatch({
      tm <- targets::tar_meta(store = store_path)
      if (is.data.frame(tm) && nrow(tm) > 0) {
        post_rows <- tm[tm$name %in% grep("^post_", tm$name, value = TRUE), , drop = FALSE]
        for (i in seq_len(nrow(post_rows))) {
          pr <- post_rows[i, , drop = FALSE]
          species_name <- gsub("^post_", "", pr$name)
          result_path <- file.path(job_dir, pr$data[[1]]$path %||% "")
          species_result <- NULL
          if (file.exists(result_path) && grepl("\\.rds$", result_path)) {
            safe_rds <- sdm_safe_path(result_path, job_dir)
            if (!is.null(safe_rds)) {
              species_result <- tryCatch(readRDS(safe_rds), error = function(e) NULL)
            }
          }
          row <- list(
            name = species_name,
            status = pr$status %||% "unknown",
            error = if (!is.null(pr$error) && nzchar(pr$error[1] %||% "")) pr$error[1] else NULL,
            metrics = tryCatch({
              if (!is.null(species_result)) {
                list(
                  auc_mean = species_result$cv$auc_mean %||% NA_real_,
                  auc_sd = species_result$cv$auc_sd %||% NA_real_,
                  tss_mean = species_result$cv$tss_mean %||% NA_real_,
                  tss_sd = species_result$cv$tss_sd %||% NA_real_,
                  cbi = species_result$metrics$cbi %||% NA_real_,
                  presence_records = species_result$metrics$presence_records %||% NA_integer_,
                  elapsed_seconds = species_result$metrics$elapsed_seconds %||% NA_real_
                )
              } else NULL
            }, error = function(e) NULL)
          )
          results[[species_name]] <- row
        }
      }
    }, error = function(e) NULL)
  }

  config_csv <- file.path(job_dir, "config.csv")
  species_list <- character(0)
  if (file.exists(config_csv)) {
    tryCatch({
      df <- read.csv(config_csv, stringsAsFactors = FALSE)
      species_list <- df$species
    }, error = function(e) NULL)
  }

  list(
    id = meta$id,
    status = meta$status,
    n_species = meta$n_species %||% length(species_list),
    species = species_list,
    results = results
  )
}

handle_model_logs <- function(res, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }

  read_safe <- function(path, max_lines = 500) {
    if (!file.exists(path)) return("")
    tryCatch({
      lines <- readLines(path, warn = FALSE)
      if (length(lines) > max_lines) {
        lines <- tail(lines, max_lines)
      }
      paste(lines, collapse = "\n")
    }, error = function(e) "")
  }

  list(
    id = job_id,
    stderr = read_safe(file.path(job_dir, "stderr.log")),
    stdout = read_safe(file.path(job_dir, "stdout.log")),
    progress_log = read_safe(file.path(job_dir, "progress.log"))
  )
}

handle_model_status <- function(res, job_id) {
  job_dir <- tryCatch(sdm_safe_job_dir(job_id), error = function(e) { NULL })
  if (is.null(job_dir)) {
    res$status <- 404L; return(list(error = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")
  progress_file <- file.path(job_dir, "progress.log")
  progress_json_file <- file.path(job_dir, "progress.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      res$status <- 500L
      return(list(error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)

  if (identical(meta$status, "running")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({
        process_alive <- proc$is_alive()
      }, error = function(e) {
        process_alive <<- FALSE
      })
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) {
          process_alive <<- FALSE
        })
      }
    }
    if (process_alive || is.null(proc)) {
      heartbeat_file <- file.path(job_dir, "heartbeat.log")
      if (file.exists(heartbeat_file)) {
        last_line <- tryCatch(tail(readLines(heartbeat_file, warn = FALSE), 1), error = function(e) NULL)
        if (!is.null(last_line) && length(last_line) > 0 && nchar(last_line) > 0) {
          hb_ts <- tryCatch(as.POSIXct(sub("\\|.*", "", last_line), format = "%Y-%m-%dT%H:%M:%S"), error = function(e) NULL)
          if (!is.null(hb_ts) && !is.na(hb_ts)) {
            if (difftime(Sys.time(), hb_ts, units = "secs") > 1800) {
              process_alive <- FALSE
            }
          }
        }
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed (OOM, segfault, or external signal)"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  if (identical(meta$status, "loading")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) NULL)
      }
    }
    if (is.null(proc) || !process_alive) {
      heartbeat_file <- file.path(job_dir, "heartbeat.log")
      if (file.exists(heartbeat_file)) {
        last_line <- tryCatch(tail(readLines(heartbeat_file, warn = FALSE), 1), error = function(e) NULL)
        if (!is.null(last_line) && length(last_line) > 0 && nchar(last_line) > 0) {
          hb_ts <- tryCatch(as.POSIXct(sub("\\|.*", "", last_line), format = "%Y-%m-%dT%H:%M:%S"), error = function(e) NULL)
          if (!is.null(hb_ts) && !is.na(hb_ts)) {
            if (difftime(Sys.time(), hb_ts, units = "secs") > 90) {
              process_alive <- FALSE
            }
          }
        }
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died while loading modules: ", stderr_content)
      } else {
        meta$error <- "R process died while loading modules \u2014 no stderr output available"
      }
      meta$error_code <- "RUNNER_LOAD_FAILED"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  if (identical(meta$status, "pending")) {
    proc <- sdm_process_registry[[job_id]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          process_alive <- tools::pskill(pid, signal = 0)
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died: ", stderr_content)
      } else {
        meta$error <- "R process died before loading modules \u2014 no stderr output available"
      }
      meta$error_code <- "RUNNER_START_FAILED"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[job_id]] <- NULL
      sdm_redis_progress_clear(job_id)
      sdm_redis_cancel_clear(job_id)
    }
  }

  if (identical(meta$status, "running") && sdm_redis_cancel_check(job_id)) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[job_id]] <- NULL
    sdm_redis_progress_clear(job_id)
    sdm_redis_cancel_clear(job_id)
  }

  if (identical(meta$status, "completed") || identical(meta$status, "failed") || identical(meta$status, "cancelled")) {
    sdm_process_registry[[job_id]] <- NULL
    sdm_redis_progress_clear(job_id)
    sdm_redis_cancel_clear(job_id)
  }

  progress_lines <- character(0)
  last_stage <- NULL
  if (file.exists(progress_file)) {
    progress_lines <- tail(readLines(progress_file, warn = FALSE), 200)
    for (line in rev(progress_lines)) {
      stage <- gsub("^\\d{2}:\\d{2}:\\d{2}\\s*(\\[\\d+%\\]\\s*)?", "", line)
      stage <- trimws(stage)
      if (nchar(stage) >= 3) {
        last_stage <- stage
        break
      }
    }
  }

  progress_json <- NULL
  if (file.exists(progress_json_file)) {
    progress_json <- tryCatch({
      lines <- readLines(progress_json_file, warn = FALSE)
      entries <- lapply(lines[nzchar(lines)], function(l) jsonlite::fromJSON(l, simplifyVector = FALSE))
      if (length(entries) > 0) entries else NULL
    }, error = function(e) NULL)
  }

  result <- list(
    id = meta$id,
    status = meta$status,
    started_at = meta$started_at,
    completed_at = meta$completed_at %||% NULL,
    error = meta$error %||% NULL,
    error_code = meta$error_code %||% NULL,
    error_hint = meta$error_hint %||% NULL,
    metrics = meta$metrics %||% NULL,
    output_files = meta$output_files %||% NULL,
    progress_log = progress_lines,
    last_stage = last_stage,
    progress_json = progress_json
  )
  if (identical(Sys.getenv("PLUMBER_AUTH_DISABLED"), "true") && !is.null(meta$error_traceback)) {
    result$error_traceback <- meta$error_traceback
  }
  result
}

handle_model_cancel <- function(req, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    return(list(ok = FALSE, message = "Invalid job ID"))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to cancel this run"))
      }
    }
  }

  proc <- sdm_process_registry[[job_id]]
  killed <- FALSE

  if (!is.null(proc) && inherits(proc, "Process")) {
    if (proc$is_alive()) {
      proc$kill()
      killed <- TRUE
    }
    rm(list = job_id, envir = sdm_process_registry)
  }

  progress_log <- file.path(job_dir, "progress.log")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

    if (!killed && !is.null(meta$process_pid)) {
      tryCatch({
        tools::pskill(meta$process_pid, signal = 9)
        killed <- TRUE
      }, error = function(e) NULL)
    }

    meta$status <- "cancelled"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    meta$error <- "Cancelled by user"
    sdm_write_json(meta, meta_file)
    sdm_redis_cancel_set(job_id)
  }

  if (killed) {
    log_line <- paste0(format(Sys.time(), "%H:%M:%S"), " [CANCELLED] Process killed for job ", job_id)
    cat(log_line, "\n")
    if (file.exists(progress_log)) {
      cat(log_line, "\n", file = progress_log, append = TRUE)
    }
  }

  list(ok = TRUE, message = if (killed) "Run cancelled and process terminated" else "Run cancelled (process not found)")
}

handle_model_delete <- function(req, job_id) {
  job_dir <- sdm_safe_job_dir(job_id)
  if (is.null(job_dir)) {
    return(list(ok = TRUE, message = "Invalid job ID", deleted = FALSE))
  }
  meta_file <- file.path(job_dir, "meta.json")

  if (file.exists(meta_file)) {
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (!is.null(meta$user_id) && !is.null(req$user_id) && nzchar(req$user_id %||% "")) {
      if (as.character(meta$user_id) != as.character(req$user_id)) {
        return(sdm_error_code(req, "ACCESS_DENIED", "You do not have permission to delete this run"))
      }
    }
  }

  if (!dir.exists(job_dir)) {
    return(list(ok = TRUE, message = "Run directory not found (already deleted)", deleted = FALSE))
  }

  tryCatch({
    unlink(job_dir, recursive = TRUE, force = TRUE)
    list(ok = TRUE, message = "Run output files deleted", deleted = TRUE)
  }, error = function(e) {
    list(ok = FALSE, message = paste("Failed to delete:", conditionMessage(e)), deleted = FALSE)
  })
}

handle_models_runs <- function(req, app_dir) {
  jobs_dir <- file.path(app_dir, "outputs", "jobs")
  if (!dir.exists(jobs_dir)) return(list())

  job_dirs <- list.dirs(jobs_dir, recursive = FALSE, full.names = FALSE)
  runs <- lapply(job_dirs, function(jd) {
    meta_file <- file.path(jobs_dir, jd, "meta.json")
    if (file.exists(meta_file)) {
      meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)

      if (!is.null(req$user_id) && nzchar(req$user_id %||% "")) {
        if (is.null(meta$user_id) || as.character(meta$user_id) != as.character(req$user_id)) {
          return(NULL)
        }
      }

      list(
        id = meta$id,
        species = meta$config$species,
        model_id = meta$config$model_id,
        status = meta$status,
        started_at = meta$started_at,
        completed_at = meta$completed_at %||% NULL,
        metrics = meta$metrics %||% NULL,
        r_cpu_time_ms = meta$r_cpu_time_ms %||% NULL,
        r_peak_memory_mb = meta$r_peak_memory_mb %||% NULL
      )
    } else NULL
  })
  Filter(Negate(is.null), runs)
}

sdm_submit_async_job <- function(req, app_dir, job_type, params, user_id = "anonymous") {
  tryCatch({
    job_id <- paste0("data-", format(Sys.time(), "%Y%m%d%H%M%S"), "-", sprintf("%04d", sample(9999, 1)))
    job_dir <- file.path(app_dir, "outputs", "jobs", job_id)
    dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

    meta <- list(
      id = job_id,
      user_id = user_id,
      type = job_type,
      status = "running",
      started_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      params = params
    )
    sdm_write_json(meta, file.path(job_dir, "meta.json"))

    input <- params
    input$type <- job_type
    input <- input[!sapply(input, is.null)]
    writeLines(jsonlite::toJSON(input, auto_unbox = TRUE, pretty = TRUE), file.path(job_dir, "input.json"))

    dispatcher_path <- file.path(app_dir, "plumber", "R", "async_dispatcher.R")
    proc <- processx::process$new(
      "Rscript",
      c("--no-save", "--no-restore", "--no-init-file", dispatcher_path, app_dir, job_dir),
      stdout = file.path(job_dir, "stdout.log"),
      stderr = file.path(job_dir, "stderr.log"),
      env = c(HOME = "/app")
    )

    sdm_process_registry[[job_id]] <- proc
    meta$process_pid <- proc$get_pid()
    sdm_write_json(meta, file.path(job_dir, "meta.json"))

    job_id
  }, error = function(e) {
    cat(sprintf("[sdm_async_submit] ERROR: %s\n", conditionMessage(e)), stderr())
    NULL
  })
}

handle_async_status <- function(res, job_id, app_dir) {
  job_dir <- file.path(app_dir, "outputs", "jobs", basename(job_id))
  meta_file <- file.path(job_dir, "meta.json")
  result_file <- file.path(job_dir, "result.json")
  progress_file <- file.path(job_dir, "progress.log")

  if (!file.exists(meta_file)) {
    return(list(available = FALSE, error = "Job not found"))
  }

  meta <- tryCatch(
    jsonlite::fromJSON(meta_file, simplifyVector = FALSE),
    error = function(e) {
      return(list(available = FALSE, error = paste0("Corrupted meta.json: ", conditionMessage(e))))
    }
  )
  if (is.list(meta) && !is.null(meta$error)) return(meta)
  result <- NULL
  if (file.exists(result_file)) {
    result <- jsonlite::fromJSON(result_file, simplifyVector = FALSE)
  }

  if (identical(meta$status, "cancelled")) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "cancelled", error = meta$error %||% "Cancelled by user",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }
  if (identical(meta$status, "completed") && is.null(result)) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "completed",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }
  if (identical(meta$status, "failed") && is.null(result)) {
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "failed", error = meta$error %||% "Unknown error",
                error_code = meta$error_code %||% NULL, error_hint = meta$error_hint %||% NULL))
  }

  if (identical(meta$status, "running") && is.null(result)) {
    proc <- sdm_process_registry[[basename(job_id)]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          ps_info <- tools::ps()
          process_alive <- pid %in% ps_info$PID
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      meta$error <- "Process crashed or was killed (OOM, segfault, or external signal)"
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = "Process crashed or was killed (OOM, segfault, or external signal)",
                  error_code = "PROCESS_CRASH", error_hint = "The R process was terminated by the OS. Check system memory, reduce raster resolution, or run with fewer covariates."))
    }
  }

  if (identical(meta$status, "loading")) {
    proc <- sdm_process_registry[[basename(job_id)]]
    process_alive <- FALSE
    if (!is.null(proc)) {
      tryCatch({ process_alive <- proc$is_alive() }, error = function(e) NULL)
    }
    if (!process_alive && !is.null(meta$process_pid)) {
      pid <- as.integer(meta$process_pid)
      if (is.finite(pid)) {
        tryCatch({
          ps_info <- tools::ps()
          process_alive <- pid %in% ps_info$PID
        }, error = function(e) NULL)
      }
    }
    if (!process_alive) {
      meta$status <- "failed"
      stderr_content <- tryCatch({
        lines <- readLines(file.path(job_dir, "stderr.log"), warn = FALSE)
        paste(tail(lines, 15), collapse = "\n")
      }, error = function(e) NULL)
      if (!is.null(stderr_content) && nzchar(stderr_content)) {
        meta$error <- paste0("R process died while loading modules: ", stderr_content)
      } else {
        meta$error <- "R process died while loading modules \u2014 no stderr output available"
      }
      meta$error_code <- "RUNNER_LOAD_FAILED"
      sdm_write_json(meta, meta_file)
      sdm_process_registry[[basename(job_id)]] <- NULL
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = meta$error,
                  error_code = "RUNNER_LOAD_FAILED", error_hint = "The R process was killed while loading SDM modules. Check container memory limits, reduce covariates, or increase memory allocation."))
    }
  }

  if (identical(meta$status, "running") && is.null(result) && sdm_redis_cancel_check(basename(job_id))) {
    meta$status <- "cancelled"
    meta$error <- "Cancelled by user"
    meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
    sdm_write_json(meta, meta_file)
    sdm_process_registry[[basename(job_id)]] <- NULL
    sdm_redis_progress_clear(basename(job_id))
    sdm_redis_cancel_clear(basename(job_id))
    return(list(available = TRUE, status = "cancelled", error = "Cancelled by user",
                error_code = NULL, error_hint = NULL))
  }

  error_code <- meta$error_code %||% NULL
  error_hint <- meta$error_hint %||% NULL

  if (!is.null(result)) {
    if (identical(result$status, "completed")) {
      sdm_process_registry[[basename(job_id)]] <- NULL
      meta$status <- "completed"
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      meta$result <- result$result
      sdm_write_json(meta, meta_file)
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "completed", result = result$result, error_code = error_code, error_hint = error_hint))
    } else if (identical(result$status, "failed")) {
      sdm_process_registry[[basename(job_id)]] <- NULL
      meta$status <- "failed"
      meta$error <- result$error
      meta$completed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
      sdm_write_json(meta, meta_file)
      sdm_redis_progress_clear(basename(job_id))
      sdm_redis_cancel_clear(basename(job_id))
      return(list(available = TRUE, status = "failed", error = result$error, error_code = error_code, error_hint = error_hint))
    }
  }

  if (identical(meta$status, "loading")) {
    return(list(available = TRUE, status = "loading", progress_log = character(0),
                error_code = NULL, error_hint = NULL))
  }

  redis_progress <- sdm_redis_progress_get(basename(job_id), 20)
  if (!is.null(redis_progress) && length(redis_progress) > 0) {
    progress_lines <- redis_progress
  } else {
    progress_lines <- character(0)
    if (file.exists(progress_file)) {
      progress_lines <- tail(readLines(progress_file, warn = FALSE), 20)
    }
  }

  list(available = TRUE, status = "running", progress_log = progress_lines, error_code = error_code, error_hint = error_hint)
}
