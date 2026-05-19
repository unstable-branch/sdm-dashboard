# blockCV variogram-based spatial cross-validation.
# Replaces custom spatial blocks with blockCV::cv_spatial() when available.
# Reference: Valavi et al. 2019, Methods in Ecology and Evolution 10:1185-1193

#' Create spatial CV folds using blockCV variogram-based blocks.
#'
#' @param model_data data.frame with .x, .y, presence columns
#' @param k number of folds
#' @param seed random seed
#' @param cv_block_size_km block size in km (NULL = auto from variogram)
#' @param log_fun optional log function
#' @return list with fold_id, block_id, block_size_km, block_size_mode
make_cv_folds_blockcv <- function(model_data, k = 5, seed = 42,
                                   cv_block_size_km = NULL, log_fun = NULL) {
  if (!requireNamespace("blockCV", quietly = TRUE)) {
    log_message(log_fun, "blockCV not available; falling back to custom spatial blocks")
    return(make_cv_folds_spatial_blocks(model_data$.x, model_data$.y, model_data$presence,
      k = k, block_size_km = cv_block_size_km %||% 100, seed = seed))
  }

  if (!requireNamespace("sf", quietly = TRUE)) {
    log_message(log_fun, "sf not available; falling back to custom spatial blocks")
    return(make_cv_folds_spatial_blocks(model_data$.x, model_data$.y, model_data$presence,
      k = k, block_size_km = cv_block_size_km %||% 100, seed = seed))
  }

  log_message(log_fun, "Creating spatial CV folds via blockCV::cv_spatial()")

  # Create sf point objects
  pts <- sf::st_as_sf(model_data, coords = c(".x", ".y"), crs = 4326)

  # Presence/absence response
  r <- model_data$presence

  tryCatch({
    # Auto-detect block size from variogram if not specified
    if (is.null(cv_block_size_km) || !is.finite(cv_block_size_km)) {
      log_message(log_fun, "  Auto-detecting block size from spatial autocorrelation variogram")
    }

    blk <- blockCV::cv_spatial(
      x = pts,
      column = "presence",
      k = k,
      size = if (!is.null(cv_block_size_km) && is.finite(cv_block_size_km))
        cv_block_size_km * 1000 else NULL,  # blockCV uses metres
      seed = seed,
      progress = FALSE
    )

    # Extract fold assignments
    fold_id <- blk$folds_ids
    block_id <- blk$blocks$id

    log_message(log_fun, "  blockCV: ", length(unique(fold_id)), " folds, ",
      "block_size = ", if (!is.null(blk$size)) sprintf("%.0f m", blk$size) else "auto")

    list(
      fold_id = fold_id,
      block_id = block_id,
      block_size_km = if (!is.null(blk$size)) blk$size / 1000 else NA_real_,
      block_size_mode = "blockcv_variogram"
    )
  }, error = function(e) {
    log_message(log_fun, "  blockCV failed: ", conditionMessage(e), "; falling back to custom blocks")
    make_cv_folds_spatial_blocks(model_data$.x, model_data$.y, model_data$presence,
      k = k, block_size_km = cv_block_size_km %||% 100, seed = seed)
  })
}
