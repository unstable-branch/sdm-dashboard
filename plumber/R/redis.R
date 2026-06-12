# Redis helper for Plumber — progress reporting and cancellation
# Uses redux::hiredis() for Redis connectivity
# All functions are no-ops if Redis is unavailable

SDM_REDIS_KEY_PREFIX <- "sdm"
SDM_REDIS_PROGRESS_HKEY <- "progress"
SDM_REDIS_CANCEL_KEY_SUFFIX <- "cancel"
SDM_REDIS_JOB_STATUS_KEY_SUFFIX <- "job_status"

.redis_conn <- NULL

sdm_redis_url <- function() {
  url <- Sys.getenv("REDIS_URL", "")
  if (nzchar(url)) return(url)
  host <- Sys.getenv("REDIS_HOST", "localhost")
  port <- Sys.getenv("REDIS_PORT", "6379")
  paste0("redis://", host, ":", port)
}

sdm_redis_connect <- function() {
  if (!is.null(.redis_conn) && inherits(.redis_conn, "redis_api")) {
    tryCatch({
      .redis_conn$PING()
      return(.redis_conn)
    }, error = function(e) {
      .redis_conn <<- NULL
    })
  }
  if (!requireNamespace("redux", quietly = TRUE)) {
    return(NULL)
  }
  tryCatch({
    url <- sdm_redis_url()
    .redis_conn <<- redux::hiredis(url = url)
    .redis_conn
  }, error = function(e) {
    NULL
  })
}

sdm_redis_close <- function() {
  if (!is.null(.redis_conn) && inherits(.redis_conn, "redis_api")) {
    tryCatch(.redis_conn$close(), error = function(e) NULL)
    .redis_conn <<- NULL
  }
}

.progress_key <- function(job_id) {
  paste(SDM_REDIS_KEY_PREFIX, SDM_REDIS_PROGRESS_HKEY, job_id, sep = ":")
}

.cancel_key <- function(job_id) {
  paste(SDM_REDIS_KEY_PREFIX, job_id, SDM_REDIS_CANCEL_KEY_SUFFIX, sep = ":")
}

.job_status_key <- function(job_id) {
  paste(SDM_REDIS_KEY_PREFIX, job_id, SDM_REDIS_JOB_STATUS_KEY_SUFFIX, sep = ":")
}

.redis_cmd <- function(fn, ...) {
  conn <- sdm_redis_connect()
  if (is.null(conn)) return(NULL)
  tryCatch(fn(conn, ...), error = function(e) NULL)
}

sdm_redis_progress_set <- function(job_id, entry_json) {
  key <- .progress_key(job_id)
  .redis_cmd(function(conn) conn$RPUSH(key, entry_json))
}

sdm_redis_progress_get <- function(job_id, n = 20) {
  key <- .progress_key(job_id)
  .redis_cmd(function(conn) {
    len <- conn$LLEN(key)
    if (is.null(len) || len == 0) return(NULL)
    start <- max(0, len - n)
    conn$LRANGE(key, start, -1)
  })
}

sdm_redis_progress_clear <- function(job_id) {
  key <- .progress_key(job_id)
  .redis_cmd(function(conn) conn$DEL(key))
}

sdm_redis_cancel_set <- function(job_id) {
  key <- .cancel_key(job_id)
  .redis_cmd(function(conn) conn$SET(key, "1"))
}

sdm_redis_cancel_check <- function(job_id) {
  key <- .cancel_key(job_id)
  result <- .redis_cmd(function(conn) conn$EXISTS(key))
  identical(result, 1L) || identical(result, "1") || identical(result, TRUE)
}

sdm_redis_cancel_clear <- function(job_id) {
  key <- .cancel_key(job_id)
  .redis_cmd(function(conn) conn$DEL(key))
}

sdm_redis_status_set <- function(job_id, status) {
  key <- .job_status_key(job_id)
  .redis_cmd(function(conn) conn$SET(key, status))
}

sdm_redis_status_get <- function(job_id) {
  key <- .job_status_key(job_id)
  .redis_cmd(function(conn) conn$GET(key))
}
