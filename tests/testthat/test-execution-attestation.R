testthat::test_that("canonical execution attestation rejects tampering, staleness, and replay", {
  candidates <- c(
    file.path("plumber", "R", "helpers", "models_helpers.R"),
    file.path("..", "..", "plumber", "R", "helpers", "models_helpers.R")
  )
  helper_path <- candidates[file.exists(candidates)][1]
  testthat::expect_true(!is.na(helper_path))

  helper_env <- new.env(parent = globalenv())
  helper_env$`%||%` <- function(left, right) if (is.null(left)) right else left
  helper_env$get_hdr <- function(req, name) {
    headers <- req$HEADERS
    matches <- names(headers)[tolower(names(headers)) == tolower(name)]
    if (length(matches) == 0L) NULL else headers[[matches[[1]]]]
  }
  sys.source(helper_path, envir = helper_env)

  old_key <- Sys.getenv("PLUMBER_EXECUTION_KEY", unset = NA_character_)
  old_nonce_dir <- Sys.getenv("SDM_EXECUTION_NONCE_DIR", unset = NA_character_)
  nonce_dir <- tempfile("sdm-execution-nonces-")
  on.exit({
    unlink(nonce_dir, recursive = TRUE, force = TRUE)
    if (is.na(old_key)) Sys.unsetenv("PLUMBER_EXECUTION_KEY") else Sys.setenv(PLUMBER_EXECUTION_KEY = old_key)
    if (is.na(old_nonce_dir)) Sys.unsetenv("SDM_EXECUTION_NONCE_DIR") else Sys.setenv(SDM_EXECUTION_NONCE_DIR = old_nonce_dir)
  }, add = TRUE)
  Sys.setenv(PLUMBER_EXECUTION_KEY = "execution-secret", SDM_EXECUTION_NONCE_DIR = nonce_dir)

  signed_request <- function(body = "{\"species\":\"test\"}", timestamp = as.character(floor(as.numeric(Sys.time()))),
                             nonce = "11111111-1111-4111-8111-111111111111") {
    principal <- "user-a"
    material <- paste(timestamp, nonce, principal, body, sep = "\n")
    signature <- digest::hmac("execution-secret", material, algo = "sha256", serialize = FALSE)
    list(
      user_id = principal,
      postBody = body,
      HEADERS = c(
        "X-SDM-Execution-Timestamp" = timestamp,
        "X-SDM-Execution-Nonce" = nonce,
        "X-SDM-Execution-Signature" = signature
      )
    )
  }

  valid <- signed_request()
  testthat::expect_true(helper_env$sdm_require_canonical_execution(valid))
  testthat::expect_false(helper_env$sdm_require_canonical_execution(valid))

  altered <- signed_request(nonce = "22222222-2222-4222-8222-222222222222")
  altered$postBody <- "{\"species\":\"tampered\"}"
  testthat::expect_false(helper_env$sdm_require_canonical_execution(altered))

  stale <- signed_request(
    timestamp = as.character(floor(as.numeric(Sys.time())) - 120),
    nonce = "33333333-3333-4333-8333-333333333333"
  )
  testthat::expect_false(helper_env$sdm_require_canonical_execution(stale))
})
