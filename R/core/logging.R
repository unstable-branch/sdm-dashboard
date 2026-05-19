# Logging, progress, and small string helpers.

`%||%` <- function(a, b) if (is.null(a)) b else a

log_message <- function(log_fun = NULL, ...) {
  msg <- paste(..., collapse = "")
  if (is.function(log_fun)) log_fun(msg) else message(msg)
  invisible(msg)
}

progress_step <- function(progress_fun = NULL, amount = 0, detail = NULL) {
  if (is.function(progress_fun)) {
    progress_fun(list(value = amount, detail = detail))
  }
  invisible(NULL)
}

safe_slug <- function(x) {
  x <- as.character(x)[1]
  if (is.na(x) || !nzchar(trimws(x))) {
    return("sdm")
  }
  x <- tolower(trimws(x))
  x <- gsub("[^a-z0-9]+", "_", x)
  x <- gsub("(^_+|_+$)", "", x)
  ifelse(nchar(x) == 0, "sdm", x)
}

extent_cache_key <- function(extent_vec, digits = 3) {
  vals <- sprintf(paste0("%.", digits, "f"), as.numeric(extent_vec))
  vals <- gsub("-", "m", vals, fixed = TRUE)
  vals <- gsub("\\.", "p", vals)
  paste(vals, collapse = "_")
}

combine_extents <- function(a, b) {
  c(min(a[1], b[1]), max(a[2], b[2]), min(a[3], b[3]), max(a[4], b[4]))
}
