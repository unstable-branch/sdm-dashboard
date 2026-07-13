# Resilient PostgreSQL pool bootstrap for Plumber.

sdm_create_db_pool <- function(db_url = Sys.getenv("DATABASE_URL", "")) {
  if (!nzchar(db_url)) return(NULL)
  candidate <- pool::dbPool(
    RPostgres::Postgres(),
    dbname = db_url,
    minSize = 1,
    maxSize = 5,
    idleTimeout = 60000
  )
  con <- NULL
  tryCatch({
    con <- pool::poolCheckout(candidate)
    DBI::dbGetQuery(con, "SELECT 1")
    pool::poolReturn(con)
    con <- NULL
    candidate
  }, error = function(e) {
    if (!is.null(con)) tryCatch(pool::poolReturn(con), error = function(return_error) NULL)
    tryCatch(pool::poolClose(candidate), error = function(close_error) NULL)
    stop(e)
  })
}

sdm_connect_db_pool <- function(
    attempts = as.integer(Sys.getenv("SDM_DB_POOL_STARTUP_ATTEMPTS", "30")),
    delay_seconds = as.numeric(Sys.getenv("SDM_DB_POOL_RETRY_DELAY_SECONDS", "2")),
    create_pool = sdm_create_db_pool,
    sleep = Sys.sleep,
    log = function(...) cat(..., "\n", sep = "")) {
  if (!nzchar(Sys.getenv("DATABASE_URL", ""))) return(NULL)
  if (!is.finite(attempts) || attempts < 1L) attempts <- 1L
  if (!is.finite(delay_seconds) || delay_seconds < 0) delay_seconds <- 2

  for (attempt in seq_len(attempts)) {
    candidate <- tryCatch(create_pool(), error = function(e) {
      log("DB pool connection attempt ", attempt, "/", attempts,
          " failed: ", conditionMessage(e))
      NULL
    })
    if (!is.null(candidate)) return(candidate)
    if (attempt < attempts) sleep(min(delay_seconds * attempt, 5))
  }
  NULL
}

.sdm_db_pool_last_retry <- 0

sdm_get_db_pool <- function(current_pool = NULL) {
  if (!is.null(current_pool) && inherits(current_pool, "Pool")) return(current_pool)
  now <- as.numeric(Sys.time())
  if (now - .sdm_db_pool_last_retry < 5) return(NULL)
  .sdm_db_pool_last_retry <<- now
  candidate <- sdm_connect_db_pool(attempts = 1L)
  if (!is.null(candidate)) assign("db_pool", candidate, envir = .GlobalEnv)
  candidate
}
