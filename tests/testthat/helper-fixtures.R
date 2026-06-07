# Shared test fixtures and helpers for smoke tests and testthat suite.

make_synthetic_occurrence <- function(path = NULL, n_pres = 24, seed = 42L) {
  set.seed(seed)
  occ <- data.frame(
    species = "Synthetic species",
    decimalLongitude = seq(140.15, 141.85, length.out = n_pres),
    decimalLatitude = seq(-23.85, -22.15, length.out = n_pres),
    institutionCode = rep(c("Museum A", "Museum B"), each = n_pres / 2),
    countryCode = "AU",
    stringsAsFactors = FALSE
  )
  if (!is.null(path)) utils::write.csv(occ, path, row.names = FALSE)
  occ
}

make_test_raster <- function(xmin = 140, xmax = 142, ymin = -24, ymax = -22,
                             nrows = 20, ncols = 20, n_layers = 2,
                             layer_names = NULL, seed = 42L) {
  set.seed(seed)
  if (is.null(layer_names))
    layer_names <- paste0("bio", c(1, 12, 4, 7, 15, 19)[seq_len(n_layers)])
  rasters <- lapply(seq_len(n_layers), function(i) {
    r <- terra::rast(nrows = nrows, ncols = ncols,
                     xmin = xmin, xmax = xmax, ymin = ymin, ymax = ymax)
    terra::values(r) <- runif(terra::ncell(r), 0, 1)
    r
  })
  stack <- do.call(c, rasters)
  names(stack) <- layer_names
  stack
}

make_mock_fit <- function(model_id = "glm", env_train = NULL,
                          n_pres = 24, n_bg = 100) {
  covariates <- if (!is.null(env_train)) names(env_train) else c("bio1", "bio12")
  list(
    model_id = model_id, model_label = paste(model_id, "test"),
    model_method = "test", model = list(coef = rep(0.1, length(covariates))),
    covariates = covariates,
    cv = list(auc_mean = 0.75, tss_mean = 0.45, auc_sd = 0.05),
    occurrence_used = data.frame(
      longitude = runif(n_pres, 140, 142), latitude = runif(n_pres, -24, -22),
      presence = 1),
    background_xy = cbind(runif(n_bg, 140, 142), runif(n_bg, -24, -22))
  )
}

make_test_fit <- function(occ, env, seed = 42L) {
  if (!requireNamespace("terra", quietly = TRUE)) return(NULL)
  set.seed(seed)
  tryCatch(
    fit_sdm_model("glm", occ, env, background_n = 80, include_quadratic = FALSE,
                  cv_folds = 2, seed = seed, n_cores = 1),
    error = function(e) NULL)
}

make_multi_species_occurrence <- function(path = NULL, n_per_species = 20, seed = 42L) {
  set.seed(seed)
  ranges <- list(
    Species_North = list(lon = c(145, 153), lat = c(-24, -16)),
    Species_East  = list(lon = c(145, 153), lat = c(-38, -25)),
    Species_West  = list(lon = c(113, 120), lat = c(-35, -22))
  )
  dfs <- lapply(names(ranges), function(sp) {
    r <- ranges[[sp]]
    data.frame(
      species = sp,
      longitude = stats::runif(n_per_species, r$lon[1], r$lon[2]),
      latitude = stats::runif(n_per_species, r$lat[1], r$lat[2]),
      source = paste0("Synthetic_", sp),
      countryCode = "AU",
      stringsAsFactors = FALSE
    )
  })
  occ <- do.call(rbind, dfs)
  rownames(occ) <- NULL
  if (!is.null(path)) utils::write.csv(occ, path, row.names = FALSE)
  occ
}

make_land_occurrence <- function(lon_range, lat_range, n = 25, seed = 42L,
                                  wc_dir = "Worldclim") {
  set.seed(seed)
  bio1_path <- list.files(wc_dir, pattern = "wc2.1_10m_bio_1\\.tif$",
    full.names = TRUE)
  if (length(bio1_path) == 0) stop("WorldClim bio1 not found in ", wc_dir)
  bio1 <- terra::rast(bio1_path[1])

  on_land <- 0
  attempts <- 0
  result <- data.frame()
  while (on_land < n && attempts < 50) {
    attempts <- attempts + 1
    pts <- data.frame(
      longitude = stats::runif(n * 2, lon_range[1], lon_range[2]),
      latitude  = stats::runif(n * 2, lat_range[1], lat_range[2]),
      stringsAsFactors = FALSE
    )
    vals <- terra::extract(bio1, pts)
    pts <- pts[!is.na(vals[, 2]), , drop = FALSE]
    pts <- pts[!duplicated(paste(pts$longitude, pts$latitude)), , drop = FALSE]
    result <- rbind(result, pts[seq_len(min(nrow(pts), n - on_land)), ])
    on_land <- nrow(result)
  }
  if (nrow(result) < n) {
    stop("Only found ", nrow(result), " on-land points in [",
      paste(lon_range, collapse = ","), "] x [", paste(lat_range, collapse = ","),
      "] after 50 attempts; needed ", n, ". Try a larger or more land-rich extent.",
      call. = FALSE)
  }
  result[seq_len(n), , drop = FALSE]
}

make_on_land_multi_species_occurrence <- function(path = NULL, n_per_species = 25,
                                                    wc_dir = "Worldclim",
                                                    seed = 42L) {
  set.seed(seed)
  ranges <- list(
    Species_East = list(lon = c(144, 151), lat = c(-36, -26)),
    Species_West = list(lon = c(114, 122), lat = c(-34, -22))
  )
  dfs <- lapply(names(ranges), function(sp) {
    r <- ranges[[sp]]
    pts <- make_land_occurrence(r$lon, r$lat, n = n_per_species,
      wc_dir = wc_dir, seed = seed)
    data.frame(
      species = sp,
      longitude = pts$longitude,
      latitude = pts$latitude,
      source = paste0("Museum_", sp),
      countryCode = "AU",
      stringsAsFactors = FALSE
    )
  })
  occ <- do.call(rbind, dfs)
  rownames(occ) <- NULL
  if (!is.null(path)) utils::write.csv(occ, path, row.names = FALSE)
  occ
}
