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
    if (!is.character(sha) || length(sha) != 1L || is.na(sha) ||
        !grepl("^[[:xdigit:]]{64}$", sha)) next
    entries$files[[basename(f)]] <- list(
      path   = f,
      size   = sz,
      mtime  = as.numeric(file.info(f)$mtime %||% NA_real_),
      sha256 = sha,
      valid  = valid,
      url    = urls[[basename(f)]] %||% NA_character_
    )
  }

  # Downloads may be written one biovar at a time. Retain only compatible old
  # records whose recorded path, size and digest still match the current bytes.
  existing <- read_cache_manifest(dir)
  if (is.list(existing) && identical(existing$version, 1L) &&
      identical(existing$source, source) && identical(as.character(existing$res), as.character(res)) &&
      is.list(existing$files)) {
    root <- tryCatch(normalizePath(dir, winslash = "/", mustWork = TRUE), error = function(e) NULL)
    if (!is.null(root)) for (name in setdiff(names(existing$files), names(entries$files))) {
      entry <- existing$files[[name]]
      if (!is.list(entry) || !isTRUE(entry$valid) || is.null(entry$path) ||
          length(entry$path) != 1L || !is.character(entry$path) || !nzchar(entry$path) ||
          is.null(entry$size) || length(entry$size) != 1L || !is.numeric(entry$size) ||
          !is.finite(entry$size) || is.null(entry$sha256) || length(entry$sha256) != 1L ||
          !is.character(entry$sha256) || !grepl("^[[:xdigit:]]{64}$", entry$sha256)) next
      recorded <- tryCatch(normalizePath(entry$path, winslash = "/", mustWork = TRUE), error = function(e) NULL)
      if (is.null(recorded) || !startsWith(recorded, paste0(root, "/")) ||
          !identical(basename(recorded), name) || dir.exists(recorded)) next
      sz <- tryCatch(as.numeric(file.info(recorded)$size), error = function(e) NA_real_)
      sha <- tryCatch(digest::digest(file = recorded, algo = "sha256"), error = function(e) NA_character_)
      if (!is.na(sz) && isTRUE(all.equal(sz, as.numeric(entry$size))) &&
          !is.na(sha) && identical(tolower(sha), tolower(entry$sha256))) {
        entries$files[[name]] <- entry
      }
    }
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

# Returns TRUE for requested biovars whose manifest identity and on-disk content
# both verify. Returns NULL only when no manifest exists (legacy filename-only
# compatibility); a present but unreadable or malformed manifest fails closed.
check_manifest_for_biovars <- function(dir, source, requested_biovars,
                                       names_fn = NULL, actual_files = NULL, expected_res = NULL) {
  if (is.null(requested_biovars) || length(requested_biovars) == 0) {
    return(integer(0))
  }
  if (is.null(dir) || !nzchar(dir) || !dir.exists(dir)) return(NULL)
  manifest_path <- file.path(dir, SDM_CLIMATE_MANIFEST_NAME)
  if (!file.exists(manifest_path)) return(NULL)
  m <- read_cache_manifest(dir)
  if (is.null(m) || !is.list(m$files) || !identical(m$version, 1L) ||
      !identical(m$source, source)) return(integer(0))
  if (!is.null(expected_res) &&
      !identical(m$res, as.character(expected_res))) return(integer(0))

  names_for <- if (is.function(names_fn)) {
    names_fn
  } else function(bv) basename(paste0("bio", bv, ".tif"))

  ok <- integer(0)
  for (bv in requested_biovars) {
    matched_paths <- if (!is.null(actual_files)) {
      if (is.null(names(actual_files))) character(0) else {
        keys <- names(actual_files)
        unname(actual_files[keys %in% c(as.character(bv), paste0("bio", bv))])
      }
    } else {
      fname <- tryCatch(names_for(bv), error = function(e) NA_character_)
      if (length(fname) != 1L || is.na(fname)) character(0) else file.path(dir, fname)
    }
    if (length(matched_paths) == 0L || anyNA(matched_paths) || any(!nzchar(matched_paths))) next
    root <- tryCatch(normalizePath(dir, winslash = "/", mustWork = TRUE), error = function(e) NULL)
    verified <- vapply(matched_paths, function(matched_path) {
      selected <- tryCatch(normalizePath(matched_path, winslash = "/", mustWork = TRUE), error = function(e) NULL)
      if (is.null(root) || is.null(selected) || !startsWith(selected, paste0(root, "/"))) return(FALSE)
      fname <- basename(matched_path)
      entry <- m$files[[fname]]
      if (!is.list(entry) || !isTRUE(entry$valid)) return(FALSE)
      if (is.null(entry$path) || length(entry$path) != 1L || !nzchar(entry$path) ||
          is.null(entry$size) || length(entry$size) != 1L || !is.finite(entry$size) ||
          is.null(entry$sha256) || length(entry$sha256) != 1L ||
          !is.character(entry$sha256) || !grepl("^[[:xdigit:]]{64}$", entry$sha256)) return(FALSE)
      recorded <- tryCatch(normalizePath(entry$path, winslash = "/", mustWork = TRUE), error = function(e) NULL)
      if (is.null(recorded) || !identical(recorded, selected) || !file.exists(selected) || dir.exists(selected)) return(FALSE)
      sz_now <- tryCatch(as.numeric(file.info(selected)$size), error = function(e) NA_real_)
      if (is.na(sz_now) || !isTRUE(all.equal(sz_now, as.numeric(entry$size)))) return(FALSE)
      sha_now <- tryCatch(digest::digest(file = selected, algo = "sha256"), error = function(e) NA_character_)
      !is.na(sha_now) && identical(tolower(sha_now), tolower(entry$sha256))
    }, logical(1))
    if (length(verified) == 1L && isTRUE(verified)) ok <- c(ok, bv)
  }
  ok
}
