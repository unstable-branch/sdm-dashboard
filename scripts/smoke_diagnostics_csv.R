#!/usr/bin/env Rscript
#
# scripts/smoke_diagnostics_csv.R
#
# Smoke test for handle_diagnostics_data() — the /api/v1/diagnostics/data/<run>/<type>
# CSV endpoint handler.
#
# Run locally:
#   Rscript scripts/smoke_diagnostics_csv.R
#
# Prerequisites: jsonlite
#
# This test calls handle_diagnostics_data() directly in-process, bypassing the full
# Plumber server boot (which requires a PostgreSQL DB). The handler's:
#   - Return type (character, not NULL)
#   - Content-Type header (text/csv; charset=utf-8)
#   - Body content (valid CSV, not "{}")
#   - HTTP status (200 for valid type, 404 for unknown type)
# are all verified.
#
# The actual endpoint is exercised end-to-end in CI via Docker integration tests
# in platform-ci.yml (docker build + compose up + curl).

suppressPackageStartupMessages({
  stopifnot(requireNamespace("jsonlite", quietly = TRUE))
})

cat("[smoke] Starting diagnostics CSV smoke test...\n")

# ── 1. Bootstrap minimal environment ────────────────────────────────────────────
cat("[smoke] (1/5) Bootstrapping minimal SDM environment...\n")

project_root <- getwd()
Sys.setenv(
  SDM_PROJECT_ROOT      = project_root,
  DATABASE_URL          = "",   # skip DB pool
  PLUMBER_AUTH_DISABLED = "true"
)

# Create child environment and source helpers into it (same pattern as
# test-suitability-value-serializer.R)
env <- new.env(parent = .GlobalEnv)

source(file.path(project_root, "plumber/R/auth.R"),              local = env)
source(file.path(project_root, "plumber/R/helpers/plumber_helpers.R"), local = env)
source(file.path(project_root, "plumber/R/error_codes.R"),        local = env)
source(file.path(project_root, "plumber/R/helpers/diagnostics_helpers.R"), local = env)

cat("[smoke]   Helpers sourced OK\n")

# ── 2. Stub auth + create fake run files ─────────────────────────────────────────
cat("[smoke] (2/5) Creating fake completed run directory...\n")

run_id  <- "smoke-test-run"
app_dir <- normalizePath(project_root, winslash = "/", mustWork = TRUE)

# Note: req$user_id = NULL below means the handler's
#   if (!is.null(req$user_id)) { sdm_verify_run_owner(...) }
# gate short-circuits and skips ownership verification entirely.
# No stubbing needed.

# Ensure app_dir is set in the env so sdm_safe_job_dir resolves correctly
assign("app_dir", app_dir, envir = env)

# Create job directory at the path sdm_safe_job_dir() will resolve to
job_dir <- file.path(app_dir, "outputs", "jobs", basename(run_id))
dir.create(job_dir, recursive = TRUE, showWarnings = FALSE)

meta <- list(
  status   = "completed",
  user_id  = "smoke-test",
  species  = "Testus species",
  output_files = list(
    result_rds = file.path(job_dir, "result.rds")
  )
)
jsonlite::write_json(meta, file.path(job_dir, "meta.json"), auto_unbox = TRUE)

result <- list(
  variable_importance = data.frame(
    variable   = c("bio1", "bio5", "bio12"),
    importance = c(0.40,  0.35,  0.25),
    stringsAsFactors = FALSE
  )
)
saveRDS(result, file.path(job_dir, "result.rds"))

cat("[smoke]   job_dir  :", job_dir, "\n")
stopifnot(file.exists(file.path(job_dir, "meta.json")))
stopifnot(file.exists(file.path(job_dir, "result.rds")))
cat("[smoke]   Fake run files created: OK\n")

# ── 3. Build mock req/res ───────────────────────────────────────────────────────
cat("[smoke] (3/5) Building mock req/res objects...\n")

mock_req <- list(
  user_id   = NULL,   # NULL bypasses sdm_verify_run_owner ownership check
  user_role = NULL
)

mock_res <- new.env()
mock_res$status <- 200L
mock_res$headers <- list()

cat("[smoke]   req$user_id:", mock_req$user_id, "\n")
cat("[smoke]   res$status (initial):", mock_res$status, "\n")

# ── 4. Call handle_diagnostics_data ─────────────────────────────────────────────
cat("[smoke] (4/5) Calling handle_diagnostics_data('importance')...\n")

raw_result <- env$handle_diagnostics_data(mock_req, mock_res, run_id, "importance", app_dir)

cat("[smoke]   Handler returned type:", typeof(raw_result), "\n")
cat("[smoke]   Handler returned length:", length(raw_result), "\n")
cat("[smoke]   res$status (after call):", mock_res$status, "\n")
cat("[smoke]   Content-Type header:", mock_res$headers$`Content-Type`, "\n")

# ── 5. Assertions ───────────────────────────────────────────────────────────────
cat("[smoke] (5/5) Running assertions...\n")
errors <- character(0)

# 5a. Handler returned a character vector (not NULL)
if (is.null(raw_result)) {
  errors <- c(errors, "handle_diagnostics_data returned NULL (should return CSV string)")
} else if (!is.character(raw_result)) {
  errors <- c(errors, paste0("handle_diagnostics_data returned ", typeof(raw_result),
                              " (should return character)"))
} else if (length(raw_result) == 0) {
  errors <- c(errors, "handle_diagnostics_data returned empty character vector")
} else {
  cat("[smoke]   Returns character vector: OK\n")
}

# 5b. Content-Type is text/csv; charset=utf-8
ct <- mock_res$headers$`Content-Type`
if (is.null(ct)) {
  errors <- c(errors, "Content-Type header not set")
} else if (!grepl("text/csv", ct, fixed = TRUE)) {
  errors <- c(errors, paste0("Content-Type is '", ct, "' (expected text/csv)"))
} else {
  cat("[smoke]   Content-Type text/csv: OK\n")
}

# 5c. Body is not "{}" (the NULL→JSON-null bug)
if (length(raw_result) > 0 && identical(raw_result[[1]], "{}")) {
  errors <- c(errors, "Body is '{}' — write.csv returned NULL (regression for the CSV bug)")
} else if (length(raw_result) > 0) {
  cat("[smoke]   Body is not '{}': OK\n")
  cat("[smoke]   Body preview (first 80 chars): ", substr(raw_result[[1]], 1, 80), "\n", sep = "")
}

# 5d. CSV parses to data.frame with expected columns
if (length(raw_result) > 0 && !identical(raw_result[[1]], "{}")) {
  parsed <- tryCatch(
    read.csv(text = raw_result[[1]], stringsAsFactors = FALSE),
    error = function(e) {
      errors <<- c(errors, paste0("CSV parse error: ", e$message))
      NULL
    }
  )
  if (!is.null(parsed)) {
    if (!"variable" %in% names(parsed)) {
      errors <- c(errors, paste0("CSV columns: ", paste(names(parsed), collapse = ", "),
                                  " (expected 'variable')"))
    } else {
      cat("[smoke]   CSV has 'variable' column: OK\n")
    }
    if (!"importance" %in% names(parsed)) {
      errors <- c(errors, "CSV missing 'importance' column")
    } else {
      cat("[smoke]   CSV has 'importance' column: OK\n")
    }
    if (nrow(parsed) != 3) {
      errors <- c(errors, paste0("CSV row count: ", nrow(parsed), " (expected 3)"))
    } else {
      cat("[smoke]   CSV has 3 rows: OK\n")
    }
  }
}

# 5e. 404 for unknown type
cat("[smoke] (5/5b) Testing 404 for unknown type...\n")
mock_res_404 <- new.env()
mock_res_404$status <- 200L
mock_res_404$headers <- list()
result_404 <- env$handle_diagnostics_data(mock_req, mock_res_404, run_id, "nonexistent-type", app_dir)
if (mock_res_404$status != 404L) {
  errors <- c(errors, paste0("Expected status 404 for unknown type, got ", mock_res_404$status))
} else {
  cat("[smoke]   HTTP 404 for unknown type: OK\n")
}

# ── Cleanup ─────────────────────────────────────────────────────────────────────
cat("[smoke] Cleaning up...\n")
unlink(job_dir, recursive = TRUE)

# ── Report ──────────────────────────────────────────────────────────────────────
cat("[smoke]\n")
if (length(errors) == 0) {
  cat("[smoke] ==========================================\n")
  cat("[smoke] ALL ASSERTIONS PASSED\n")
  cat("[smoke] diagnostics CSV handler is healthy.\n")
  cat("[smoke] ==========================================\n")
  quit(status = 0)
} else {
  cat("[smoke] FAILURES:\n")
  for (e in errors) cat("  ERROR: ", e, "\n", sep = "")
  cat("[smoke] Smoke test FAILED.\n")
  quit(status = 1)
}
