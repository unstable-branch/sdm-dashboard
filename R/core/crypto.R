# Encryption helpers for occurrence data at rest.
# Uses AES-256-GCM via the openssl package.
# Key is read from the SDM_ENCRYPTION_KEY environment variable.
# If the key is unset (local dev), files pass through unencrypted.

sdm_encryption_key_raw <- function(key) {
  if (grepl("^[0-9A-Fa-f]{64}$", key)) {
    key_bytes <- strtoi(substring(key, seq(1, 63, 2), seq(2, 64, 2)), base = 16)
    return(as.raw(key_bytes))
  }
  key_raw <- charToRaw(key)
  if (length(key_raw) != 32L) {
    stop("SDM_ENCRYPTION_KEY must be 64 hex characters or 32 raw bytes", call. = FALSE)
  }
  key_raw
}

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
  iv <- openssl::rand_bytes(12)
  encrypted <- openssl::aes_gcm_encrypt(data, key = sdm_encryption_key_raw(key), iv = iv)
  writeBin(c(iv, encrypted), output_path)
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
  if (length(encrypted) < 13L) {
    stop("Encrypted file is too short or corrupt", call. = FALSE)
  }
  iv <- encrypted[seq_len(12)]
  data <- openssl::aes_gcm_decrypt(encrypted[-seq_len(12)], key = sdm_encryption_key_raw(key), iv = iv)
  writeBin(data, output_path)
  invisible(TRUE)
}
