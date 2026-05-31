# Cross-validation fold assignment helpers.

make_cv_folds_random <- function(y, k = sdm_default_cv_folds, seed = sdm_default_seed) {
  y <- as.integer(y)
  k <- as.integer(k)
  if (is.na(k) || k < 2) {
    return(rep(0L, length(y)))
  }
  set.seed(seed)
  fold_id <- integer(length(y))
  for (class_value in sort(unique(y))) {
    idx <- which(y == class_value)
    if (length(idx) > 0) fold_id[idx] <- sample(rep(seq_len(k), length.out = length(idx)))
  }
  fold_id
}

lonlat_to_km <- function(x, y) {
  lat_rad <- y * pi / 180
  data.frame(
    x_km = x * 111.320 * max(abs(cos(lat_rad)), 0.01) * sign(cos(lat_rad)),
    y_km = y * 110.574,
    stringsAsFactors = FALSE
  )
}

estimate_cv_block_size_km <- function(x, y, k = sdm_default_cv_folds) {
  xy <- lonlat_to_km(x, y)
  width <- diff(range(xy$x_km, na.rm = TRUE))
  height <- diff(range(xy$y_km, na.rm = TRUE))
  span <- max(width, height, na.rm = TRUE)
  if (!is.finite(span) || span <= 0) {
    return(50)
  }
  max(10, span / max(2, sqrt(as.integer(k) * 4)))
}

make_cv_folds_spatial_blocks <- function(x, y, presence, k = sdm_default_cv_folds,
                                         block_size_km = NA_real_, seed = sdm_default_seed) {
  k <- as.integer(k)
  presence <- as.integer(presence)
  if (is.na(k) || k < 2) {
    return(list(fold_id = rep(0L, length(presence)), block_size_km = NA_real_, block_size_mode = "off", block_id = character(length(presence))))
  }
  unique_vals <- unique(presence)
  if (length(setdiff(unique_vals, 0:1)) > 0) {
    warning("make_cv_folds_spatial_blocks: 'presence' must be 0/1; falling back to random CV.", call. = FALSE)
    return(list(
      fold_id = make_cv_folds_random(presence, k = k, seed = seed),
      block_size_km = NA_real_, block_size_mode = "off+invalid-presence",
      block_id = character(length(presence))
    ))
  }
  if (!is.finite(block_size_km) || block_size_km <= 0) {
    block_size_km <- estimate_cv_block_size_km(x, y, k)
    block_size_mode <- "auto"
  } else {
    block_size_mode <- "manual"
  }
  xy <- lonlat_to_km(x, y)
  block_x <- floor(xy$x_km / block_size_km)
  block_y <- floor(xy$y_km / block_size_km)
  block_id <- paste(block_x, block_y, sep = ":")
  unique_blocks <- unique(block_id)
  if (length(unique_blocks) < k) {
    fold_id <- make_cv_folds_random(presence, k = k, seed = seed)
    warning("Spatial-block CV: only ", length(unique_blocks), " block(s) for ", k, " folds. Falling back to random CV.", call. = FALSE)
    return(list(fold_id = fold_id, block_size_km = block_size_km, block_size_mode = paste0(block_size_mode, "+random-fallback"), block_id = block_id))
  }
  set.seed(seed)
  blocks <- data.frame(block_id = unique_blocks, stringsAsFactors = FALSE)
  blocks$presence <- vapply(blocks$block_id, function(id) sum(presence[block_id == id] == 1), integer(1))
  blocks$background <- vapply(blocks$block_id, function(id) sum(presence[block_id == id] == 0), integer(1))
  blocks$total <- blocks$presence + blocks$background
  blocks <- blocks[sample(seq_len(nrow(blocks))), , drop = FALSE]
  fold_total <- rep(0L, k)
  fold_presence <- rep(0L, k)
  block_fold <- integer(nrow(blocks))
  global_prev <- sum(presence == 1) / length(presence)
  for (i in seq_len(nrow(blocks))) {
    scores <- vapply(seq_len(k), function(fold) {
      next_total <- fold_total[fold] + blocks$total[i]
      next_presence <- fold_presence[fold] + blocks$presence[i]
      prev_penalty <- if (next_total > 0) abs((next_presence / next_total) - global_prev) else 0
      fold_total[fold] + prev_penalty * max(1, mean(blocks$total))
    }, numeric(1))
    chosen <- which(scores == min(scores))[1]
    block_fold[i] <- chosen
    fold_total[chosen] <- fold_total[chosen] + blocks$total[i]
    fold_presence[chosen] <- fold_presence[chosen] + blocks$presence[i]
  }
  lookup <- stats::setNames(block_fold, blocks$block_id)
  list(fold_id = as.integer(lookup[block_id]), block_size_km = block_size_km, block_size_mode = block_size_mode, block_id = block_id)
}

summarise_cv_folds <- function(fold_id, presence, block_id = NULL) {
  folds <- sort(unique(fold_id[fold_id > 0]))
  data.frame(
    fold = folds,
    n_total = vapply(folds, function(fold) sum(fold_id == fold), integer(1)),
    n_presence = vapply(folds, function(fold) sum(fold_id == fold & presence == 1), integer(1)),
    n_background = vapply(folds, function(fold) sum(fold_id == fold & presence == 0), integer(1)),
    n_blocks = if (is.null(block_id)) NA_integer_ else vapply(folds, function(fold) length(unique(block_id[fold_id == fold])), integer(1)),
    stringsAsFactors = FALSE
  )
}
