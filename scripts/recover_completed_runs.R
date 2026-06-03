#!/usr/bin/env Rscript
# Recover model runs that completed in Plumber but are marked failed/running in the DB.
# Happens when plumber-sync status probe got a transient 500 during Plumber auth-crash window.
#
# Usage:
#   ./scripts/recover_completed_runs.R            # real run (inside plumber container)
#   ./scripts/recover_completed_runs.R --dry-run   # preview only
#
# Must run inside the Plumber container where jsonlite is available, OR
# pass JOBS_DIR=/path/to/jobs and DATABASE_URL to run from host.

dry_run <- "--dry-run" %in% commandArgs(TRUE)

# --- Determine execution mode ---
IN_CONTAINER <- dir.exists("/app/R")
if (IN_CONTAINER) {
  jobs_dir <- "/app/outputs/jobs"
  psql_cmd <- function(sql) {
    system2("psql", c("-U", "sdm", "-d", "sdm_platform", "-c", sql),
      stdout = TRUE, stderr = TRUE)
  }
  # jsonlite IS available inside the container
  library(jsonlite)
  parse_json <- function(path) {
    fromJSON(path, simplifyVector = FALSE)
  }
  to_json <- function(x) {
    toJSON(x, auto_unbox = TRUE, null = "null")
  }
} else {
  jobs_dir <- Sys.getenv("JOBS_DIR", file.path("outputs", "jobs"))
  psql_cmd <- function(sql) {
    system2("docker", c(
      "exec", "-i", "sdm-dashboard-main-postgres-1",
      "psql", "-U", "sdm", "-d", "sdm_platform",
      "-c", sql
    ), stdout = TRUE, stderr = TRUE)
  }
  # Use python3 for JSON (no jsonlite dependency on host)
  parse_json <- function(path) {
    json_str <- system2("python3", c("-c", sprintf(
      "import json,sys; print(json.dumps(json.load(open('%s'))))", path
    )), stdout = TRUE, stderr = FALSE)
    if (length(json_str) == 0) return(NULL)
    jsonlite::fromJSON(json_str, simplifyVector = FALSE)
  }
  to_json <- function(x) {
    json_str <- system2("python3", c("-c", sprintf(
      "import json,sys; print(json.dumps(%s))",
      deparse(x)
    )), stdout = TRUE, stderr = FALSE)
    json_str
  }
  # Fallback: try loading jsonlite anyway
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    # Use a minimal R-native replacement
    parse_json <- function(path) {
      raw <- readLines(path, warn = FALSE)
      if (length(raw) == 0) return(NULL)
      # crude list-of-lists only; works for our simple meta.json structure
      eval(parse(text = paste0("list(", gsub('"', "'", paste(raw, collapse = "\n")), ")")))
    }
    to_json <- function(x) {
      jsonlite::toJSON(x, auto_unbox = TRUE, null = "null")
    }
  } else {
    library(jsonlite)
    parse_json <- function(path) fromJSON(path, simplifyVector = FALSE)
    to_json <- function(x) toJSON(x, auto_unbox = TRUE, null = "null")
  }
}

if (!dir.exists(jobs_dir)) stop("jobs dir not found: ", jobs_dir, call. = FALSE)

job_dirs <- list.dirs(jobs_dir, full.names = TRUE, recursive = FALSE)
cat(sprintf("Scanning %d job directories...\n", length(job_dirs)))

recovered <- 0L
skipped <- 0L

for (jd in job_dirs) {
  meta_file <- file.path(jd, "meta.json")
  if (!file.exists(meta_file)) {
    skipped <- skipped + 1L
    next
  }

  meta <- tryCatch(parse_json(meta_file), error = function(e) NULL)
  if (is.null(meta)) {
    skipped <- skipped + 1L
    next
  }

  if (!identical(meta$status, "completed")) next

  # Plumber writes config.runId matching the DB runs.id
  run_id <- meta$config$runId
  if (is.null(run_id) || !nchar(as.character(run_id))) {
    skipped <- skipped + 1L
    next
  }

  cat(sprintf("\n  Job: %s  RunId: %s  Completed: %s\n",
    basename(jd), run_id,
    sub("T", " ", meta$completed_at %||% "?")))

  if (dry_run) {
    cat("    DRY RUN — would update DB\n")
    next
  }

  # Build metrics/output_files as JSON strings for psql
  metrics_json <- if (!is.null(meta$metrics)) {
    gsub("'", "''", to_json(meta$metrics))
  } else "NULL"

  output_files_json <- if (!is.null(meta$output_files)) {
    gsub("'", "''", to_json(meta$output_files))
  } else "NULL"

  completed_at <- sub("T", " ", meta$completed_at %||% Sys.time())

  sql <- sprintf(
    "UPDATE runs SET status = 'completed', error = NULL, error_code = NULL, error_hint = NULL, metrics = '%s'::jsonb, output_files = '%s'::jsonb, completed_at = '%s'::timestamp WHERE id = '%s' AND status IN ('failed', 'running');",
    metrics_json, output_files_json, completed_at, run_id
  )

  result <- psql_cmd(sql)

  if (any(grepl("UPDATE 1", result))) {
    cat("    RECOVERED — DB updated to completed\n")
    recovered <- recovered + 1L
  } else if (any(grepl("UPDATE 0", result))) {
    cat("    SKIPPED — run not in failed/running state, or id not found\n")
  } else {
    cat("    ERROR —", paste(result, collapse = "\n"), "\n")
  }
}

cat(sprintf("\nDone. Recovered: %d  Skipped/irrelevant: %d\n", recovered, skipped))
