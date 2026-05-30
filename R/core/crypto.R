# Encryption helpers for occurrence data at rest.
# Uses AES-256-GCM via the openssl package.
# Key is read from the SDM_ENCRYPTION_KEY environment variable.
# If the key is unset (local dev), files pass through unencrypted.

encrypt_file <- function(input_path, output_path, key = NULL) {
  if (is.null(key)) key <- Sys.getenv("SDM_ENCRYPTION_KEY", unset = NA_character_)
  if (is.na(key) || !nzchar(key)) {
    if (input_path != output_path) file.copy(input_path, output_path, overwrite = TRUE)
    return(invisible(TRUE))
  }
  if (!requireNamespace("openssl", quietly = TRUE)) {
    stop("openssl package required for file encryption. Install with install.packages('openssl')")
  }
  data <- readBin(input_path, "raw", file.info(input_path)$size)
  encrypted <- openssl::encrypt(data, key = charToRaw(key))
  writeBin(encrypted, output_path)
  invisible(TRUE)
}

decrypt_file <- function(input_path, output_path, key = NULL) {
  if (is.null(key)) key <- Sys.getenv("SDM_ENCRYPTION_KEY", unset = NA_character_)
  if (is.na(key) || !nzchar(key)) {
    if (input_path != output_path) file.copy(input_path, output_path, overwrite = TRUE)
    return(invisible(TRUE))
  }
  if (!requireNamespace("openssl", quietly = TRUE)) {
    stop("openssl package required for file encryption. Install with install.packages('openssl')")
  }
  encrypted <- readBin(input_path, "raw", file.info(input_path)$size)
  data <- openssl::decrypt(encrypted, key = charToRaw(key))
  writeBin(data, output_path)
  invisible(TRUE)
}
