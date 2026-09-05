# match_climate_layers.R
#
# Single source of truth for matching on-disk climate GeoTIFF files to requested
# biovar numbers. Used by:
#   - find_worldclim_files           (R/covariates/covariates_climate.R)
#   - verify_worldclim_cache         (R/covariates/verify_cache.R)
#   - handle_climate_check           (plumber/R/helpers/climate_helpers.R)
#   - preflight_climate_download     (plumber/R/helpers/climate_helpers.R)
#
# All matchers return a list with two slots:
#   $biovars  : integer vector of biovar numbers that have at least one valid
#               file match.
#   $files    : named character vector of file paths (names are biovar numbers
#               as strings) for every matched biovar. Multiple matches per
#               biovar are preserved so callers can pick by size etc.
#
# This is the "single source of truth" — handle_climate_check, find_worldclim_files
# and verify_worldclim_cache all build on these helpers, eliminating the
# three different matchers that previously drifted out of sync.

empty_match_result <- function() list(biovars = integer(0), files = character(0))

match_worldclim_biovars <- function(all_tifs, requested, res_label = NULL) {
  if (is.null(requested) || length(requested) == 0) return(empty_match_result())
  if (is.null(all_tifs) || length(all_tifs) == 0)    return(empty_match_result())
  requested <- as.integer(requested)
  hit_int <- integer(0)
  hit_files <- character(0)
  hit_names <- character(0)
  for (bv in requested) {
    nm1 <- paste0("bio", bv)
    nm2 <- if (bv < 10) paste0("bio0", bv) else paste0("bio", bv)
    pat1 <- paste0("_(", nm1, ")($|[^0-9])")
    pat2 <- paste0("_(", nm2, ")($|[^0-9])")
    pat3 <- paste0("bio_", bv, "($|[^0-9])")
    matched <- unique(c(
      all_tifs[grepl(pat1, basename(all_tifs), perl = TRUE)],
      all_tifs[grepl(pat2, basename(all_tifs), perl = TRUE)],
      all_tifs[grepl(pat3, basename(all_tifs), perl = TRUE)]
    ))
    if (length(matched) > 0 && !is.null(res_label) && nzchar(res_label)) {
      res_keep <- grepl(paste0("wc2[.]1_", res_label, "[/_.]"),
                        basename(matched), perl = TRUE)
      matched <- matched[res_keep]
    }
    if (length(matched) > 0 && exists("validate_geotiff", inherits = TRUE)) {
      matched <- matched[vapply(matched, validate_geotiff, logical(1))]
    }
    if (length(matched) > 0) {
      hit_int  <- c(hit_int, bv)
      hit_files <- c(hit_files, as.character(matched))
      hit_names <- c(hit_names, rep(as.character(bv), length(matched)))
    }
  }
  if (length(hit_files) == 0) return(empty_match_result())
  names(hit_files) <- hit_names
  list(biovars = hit_int, files = hit_files)
}

match_chelsa_biovars <- function(all_tifs, requested) {
  if (is.null(requested) || length(requested) == 0) return(empty_match_result())
  if (is.null(all_tifs) || length(all_tifs) == 0)    return(empty_match_result())
  requested <- as.integer(requested)
  hit_int <- integer(0)
  hit_files <- character(0)
  hit_names <- character(0)
  for (bv in requested) {
    p1 <- if (bv < 10) sprintf("CHELSA_bio0%d_", bv) else sprintf("CHELSA_bio%d_", bv)
    p2 <- if (bv < 10) sprintf("CHELSA_bio%d_", bv)  else NULL
    matched <- all_tifs[grepl(p1, basename(all_tifs), fixed = TRUE)]
    if (length(matched) == 0 && !is.null(p2)) {
      matched <- all_tifs[grepl(p2, basename(all_tifs), fixed = TRUE)]
    }
    if (length(matched) > 0 && exists("validate_geotiff", inherits = TRUE)) {
      matched <- matched[vapply(matched, validate_geotiff, logical(1))]
    }
    if (length(matched) > 0) {
      hit_int  <- c(hit_int, bv)
      hit_files <- c(hit_files, as.character(matched))
      hit_names <- c(hit_names, rep(as.character(bv), length(matched)))
    }
  }
  if (length(hit_files) == 0) return(empty_match_result())
  names(hit_files) <- hit_names
  list(biovars = hit_int, files = hit_files)
}

match_cmip6_biovars <- function(all_tifs, requested) {
  if (is.null(requested) || length(requested) == 0) return(empty_match_result())
  if (is.null(all_tifs) || length(all_tifs) == 0)    return(empty_match_result())
  requested <- as.integer(requested)
  hit_int <- integer(0)
  hit_files <- character(0)
  hit_names <- character(0)
  for (bv in requested) {
    pat <- sprintf("wc2[.]1_.*bioc_%d[.]tif$", bv)
    matched <- all_tifs[grepl(pat, basename(all_tifs), perl = TRUE)]
    if (length(matched) > 0 && exists("validate_geotiff", inherits = TRUE)) {
      matched <- matched[vapply(matched, validate_geotiff, logical(1))]
    }
    if (length(matched) > 0) {
      hit_int  <- c(hit_int, bv)
      hit_files <- c(hit_files, as.character(matched))
      hit_names <- c(hit_names, rep(as.character(bv), length(matched)))
    }
  }
  if (length(hit_files) == 0) return(empty_match_result())
  names(hit_files) <- hit_names
  list(biovars = hit_int, files = hit_files)
}

# CHELSA extras (gdd5, gsl, fcf, npp, scd, etc.) are non-numbered vars stored as
# CHELSA_<var>_1981-2010_V.2.1.tif. Matching is requested-by-name. Returns a
# character vector of the unique vars found.
match_chelsa_extras <- function(all_tifs, requested_vars) {
  if (is.null(requested_vars) || length(requested_vars) == 0) return(character(0))
  if (is.null(all_tifs) || length(all_tifs) == 0)             return(character(0))
  hit <- character(0)
  for (var in requested_vars) {
    pat <- sprintf("CHELSA_%s_1981[--]2010_V[.]2[.]1[.]tif$", var)
    matched <- all_tifs[grepl(pat, basename(all_tifs), perl = TRUE)]
    if (length(matched) > 0 && exists("validate_geotiff", inherits = TRUE)) {
      matched <- matched[vapply(matched, validate_geotiff, logical(1))]
    }
    if (length(matched) > 0) hit <- unique(c(hit, var))
  }
  hit
}
