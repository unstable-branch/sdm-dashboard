# Encryption helpers for occurrence data at rest.
# Uses AES-256-GCM via the openssl package.
# Key is read from DATA_ENCRYPTION_KEY (preferred) or SDM_ENCRYPTION_KEY (deprecated).
# If the key is unset (local dev), files pass through unencrypted.

SDM_ENCRYPTION_MAGIC <- charToRaw("SDMENC1\n")

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
  if (is.null(key)) {
    key <- Sys.getenv("DATA_ENCRYPTION_KEY", unset = NA_character_)
    if (is.na(key) || !nzchar(key)) {
      key <- Sys.getenv("SDM_ENCRYPTION_KEY", unset = NA_character_)
      if (!is.na(key) && nzchar(key)) {
        warning("SDM_ENCRYPTION_KEY is deprecated — use DATA_ENCRYPTION_KEY instead",
          call. = FALSE, immediate. = TRUE)
      }
    }
  }
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
  writeBin(c(SDM_ENCRYPTION_MAGIC, iv, encrypted), output_path)
  invisible(TRUE)
}

decrypt_file <- function(input_path, output_path, key = NULL) {
  if (is.null(key)) {
    key <- Sys.getenv("DATA_ENCRYPTION_KEY", unset = NA_character_)
    if (is.na(key) || !nzchar(key)) {
      key <- Sys.getenv("SDM_ENCRYPTION_KEY", unset = NA_character_)
      if (!is.na(key) && nzchar(key)) {
        warning("SDM_ENCRYPTION_KEY is deprecated — use DATA_ENCRYPTION_KEY instead",
          call. = FALSE, immediate. = TRUE)
      }
    }
  }
  if (is.na(key) || !nzchar(key)) {
    if (input_path != output_path) file.copy(input_path, output_path, overwrite = TRUE)
    return(invisible(TRUE))
  }
  if (!requireNamespace("openssl", quietly = TRUE)) {
    stop("openssl package required for file encryption. Install with install.packages('openssl')")
  }
  encrypted <- readBin(input_path, "raw", file.info(input_path)$size)
  magic_len <- length(SDM_ENCRYPTION_MAGIC)
  if (length(encrypted) < magic_len + 13L ||
      !identical(encrypted[seq_len(magic_len)], SDM_ENCRYPTION_MAGIC)) {
    stop("File is not an SDM encrypted file", call. = FALSE)
  }
  payload <- encrypted[-seq_len(magic_len)]
  iv <- payload[seq_len(12)]
  data <- openssl::aes_gcm_decrypt(payload[-seq_len(12)], key = sdm_encryption_key_raw(key), iv = iv)
  writeBin(data, output_path)
  invisible(TRUE)
}
