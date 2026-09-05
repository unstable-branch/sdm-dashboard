# climate_cache_manifest.R
#
# Cache manifest for climate layers. Written after each successful download by
# download_worldclim_bio / download_chelsa_bio / fetch_cmip6_worldclim.
#
# Layout: <climate_dir>/.sdm-cache-manifest-v1.json
#
# Schema (v1):
# {
#   "version": 1,
#   "source": "worldclim" | "chelsa" | "cmip6",
#   "res": "10" | "5" | "2.5" | "30s",
#   "generated_at": "ISO-8601 string",
#   "files": {
#     "wc2.1_10m_bio_1.tif": {
#       "path": "/abs/path/wc2.1_10m_bio_1.tif",
#       "size": 3798907,
#       "mtime": 1716825...,
#       "sha256": "abc...",
#       "valid": true,
#       "url": "https://geodata.ucdavis.edu/..."
#     },
#     ...
#   }
# }
#
# On read, the consumer (handle_climate_check) compares size and validate_geotiff()
# against the manifest. Mismatch => biovar is in `missing` => forces surgical
# re-download of just that file.

SDM_CLIMATE_MANIFEST_NAME <- ".sdm-cache-manifest-v1.json"

write_cache_manifest <- function(dir, source, res, files, urls = NULL, log_fun = NULL) {
  if (is.null(dir) || !nzchar(dir) || is.null(files) || length(files) == 0) {
    return(invisible(NULL))
  }
  if (!dir.exists(dir)) return(invisible(NULL))

  log_message <- log_fun %||% function(...) invisible(NULL)
  entries <- list(
    version      = 1L,
    source       = source,
    res          = as.character(res),
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    files        = list()
  )
  for (f in files) {
    if (!file.exists(f)) next
    sz <- tryCatch(as.numeric(file.info(f)$size), error = function(e) NA_real_)
    if (is.na(sz) || sz <= 0) next
    valid <- if (exists("validate_geotiff", inherits = TRUE)) {
      tryCatch(isTRUE(validate_geotiff(f)), error = function(e) FALSE)
    } else TRUE
    sha <- tryCatch({
      if (requireNamespace("digest", quietly = TRUE)) {
        digest::digest(file = f, algo = "sha256")
      } else {
        NA_character_
      }
    }, error = function(e) NA_character_)
    entries$files[[basename(f)]] <- list(
      path   = f,
      size   = sz,
      mtime  = as.numeric(file.info(f)$mtime %||% NA_real_),
      sha256 = sha,
      valid  = valid,
      url    = urls[[basename(f)]] %||% NA_character_
    )
  }
  if (length(entries$files) == 0) return(invisible(NULL))

  manifest_path <- file.path(dir, SDM_CLIMATE_MANIFEST_NAME)
  payload <- tryCatch(
    jsonlite::toJSON(entries, auto_unbox = TRUE, null = "null", pretty = 2),
    error = function(e) NULL
  )
  if (is.null(payload)) {
    log_message("[cache-manifest] failed to serialise manifest for ", dir)
    return(invisible(NULL))
  }
  tmp <- tempfile(pattern = "manifest", tmpdir = dir)
  on.exit(if (file.exists(tmp)) unlink(tmp, force = TRUE), add = TRUE)
  writeLines(payload, tmp)
  ok <- tryCatch({
    if (exists("sdm_safe_rename", inherits = TRUE)) {
      sdm_safe_rename(tmp, manifest_path)
    } else {
      if (file.exists(manifest_path)) unlink(manifest_path, force = TRUE)
      file.rename(tmp, manifest_path)
    }
  }, error = function(e) FALSE, warning = function(w) FALSE)
  if (!isTRUE(ok)) {
    log_message("[cache-manifest] failed to write manifest at ", manifest_path)
    return(invisible(NULL))
  }
  invisible(manifest_path)
}

read_cache_manifest <- function(dir) {
  if (is.null(dir) || !nzchar(dir) || !dir.exists(dir)) return(NULL)
  manifest_path <- file.path(dir, SDM_CLIMATE_MANIFEST_NAME)
  if (!file.exists(manifest_path)) return(NULL)
  tryCatch(
    jsonlite::fromJSON(manifest_path, simplifyVector = FALSE),
    error = function(e) NULL,
    warning = function(w) NULL
  )
}

# Returns TRUE if every requested biovar has a manifest entry that still
# describes a valid, on-disk file at the expected size.
# Returns NULL when the manifest is missing or cannot be consulted, so the
# caller can fall back to filename matching.
check_manifest_for_biovars <- function(dir, source, requested_biovars,
                                       names_fn = NULL) {
  if (is.null(requested_biovars) || length(requested_biovars) == 0) {
    return(integer(0))
  }
  m <- read_cache_manifest(dir)
  if (is.null(m) || is.null(m$files)) return(NULL)
  if (!identical(m$source, source)) return(NULL)

  names_for <- if (is.function(names_fn)) {
    names_fn
  } else function(bv) basename(paste0("bio", bv, ".tif"))

  ok <- integer(0)
  for (bv in requested_biovars) {
    fname <- tryCatch(names_for(bv), error = function(e) NA_character_)
    if (is.na(fname)) next
    entry <- m$files[[fname]]
    if (is.null(entry) || !isTRUE(entry$valid)) next
    if (!file.exists(entry$path)) next
    sz_now <- tryCatch(as.numeric(file.info(entry$path)$size), error = function(e) NA_real_)
    if (is.na(sz_now) || !isTRUE(all.equal(sz_now, entry$size))) next
    ok <- c(ok, bv)
  }
  ok
}
