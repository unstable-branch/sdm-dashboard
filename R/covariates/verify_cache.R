# Cache verification helpers for the SDM Dashboard "Get Data" tab.
# Each verify_* function returns a named list:
#   available  - character vector of available items
#   missing    - character vector of missing items
#   status     - "ok" | "warn" | "error"
#   detail     - human-readable summary string
#   size_mb    - total size of cached files in MB (NA if not computed)

# ---------------------------------------------------------------------------
# Climate: WorldClim / CHELSA
# ---------------------------------------------------------------------------

verify_worldclim_cache <- function(worldclim_dir = sdm_default_worldclim_dir, source = "worldclim",
                                   selected_biovars = 1:19) {
  source <- match.arg(source, c("worldclim", "chelsa"))
  worldclim_dir <- normalizePath(worldclim_dir, winslash = "/", mustWork = FALSE)

  if (!dir.exists(worldclim_dir)) {
    return(list(
      available = character(),
      missing = paste0("bio", selected_biovars),
      status = "error",
      detail = paste("WorldClim directory not found:", worldclim_dir),
      size_mb = NA_real_
    ))
  }

  all_files <- list.files(worldclim_dir,
    pattern = "\\.tif$", full.names = TRUE,
    recursive = TRUE, ignore.case = TRUE
  )

  present <- character()
  for (bio in selected_biovars) {
    nm1 <- paste0("bio", bio)
    nm2 <- if (bio < 10) paste0("bio0", bio) else paste0("bio", bio)
    pat1 <- paste0("_(", nm1, ")[^0-9]")
    pat2 <- paste0("_(", nm2, ")[^0-9]")
    pat3 <- paste0("bio_", bio, "($|[^0-9])")
    matched <- c(
      all_files[grepl(pat1, basename(all_files), ignore.case = TRUE)],
      all_files[grepl(pat2, basename(all_files), ignore.case = TRUE)],
      all_files[grepl(pat3, basename(all_files), ignore.case = TRUE)]
    )
    if (length(matched) > 0) present <- c(present, paste0("bio", bio))
  }

  present <- unique(present)
  missing <- paste0("bio", selected_biovars)[!paste0("bio", selected_biovars) %in% present]
  size_mb <- sum(file.size(all_files), na.rm = TRUE) / 1e6

  if (length(missing) == 0) {
    status <- "ok"
    detail <- paste(length(present), "of", length(selected_biovars), "BIO layers present — all available")
  } else if (length(missing) <= 3) {
    status <- "warn"
    detail <- paste(
      length(present), "of", length(selected_biovars),
      "BIO layers present — missing:", paste(missing, collapse = ", ")
    )
  } else {
    status <- "warn"
    detail <- paste(
      length(present), "of", length(selected_biovars),
      "BIO layers present —", length(missing), "missing"
    )
  }
  list(
    available = present, missing = missing, status = status,
    detail = detail, size_mb = size_mb
  )
}

verify_chelsa_extras_cache <- function(chelsa_dir = sdm_default_chelsa_extras_dir,
                                       selected_extras = c("gdd5", "gdd10", "gsl", "fcf", "npp", "scd")) {
  chelsa_dir <- normalizePath(chelsa_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(chelsa_dir)) {
    return(list(
      available = character(), missing = selected_extras,
      status = "error", detail = "CHELSA directory not found",
      size_mb = NA_real_
    ))
  }
  all_files <- list.files(chelsa_dir,
    pattern = "\\.tif$", full.names = TRUE,
    recursive = TRUE, ignore.case = TRUE
  )
  present <- character()
  for (ex in selected_extras) {
    pat <- paste0("CHELSA_", ex, "_")
    if (any(grepl(pat, all_files, ignore.case = TRUE))) present <- c(present, ex)
  }
  missing <- setdiff(selected_extras, present)
  all_extras <- c(all_files[grepl("CHELSA_(gdd5|gdd10|gsl|fcf|npp|scd)_", all_files, ignore.case = TRUE)], character())
  size_mb <- sum(file.size(all_extras), na.rm = TRUE) / 1e6
  if (length(missing) == 0) {
    status <- "ok"
    detail <- "All CHELSA extra layers present"
  } else {
    status <- "warn"
    detail <- paste("CHELSA extras missing:", paste(missing, collapse = ", "))
  }
  list(
    available = present, missing = missing, status = status,
    detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# Climate: Future CMIP6
# ---------------------------------------------------------------------------

verify_future_cache <- function(future_dir = "Worldclim_future") {
  future_dir <- normalizePath(future_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(future_dir)) {
    return(list(
      scenarios = data.frame(
        GCM = character(), SSP = character(),
        Period = character(), Files = integer(), SizeMB = numeric()
      ),
      status = "error", detail = "Future climate directory not found",
      total_size_mb = NA_real_
    ))
  }
  subdirs <- list.dirs(future_dir, recursive = FALSE)
  subdirs <- subdirs[!grepl("^wc2\\.", basename(subdirs))]
  # Derive GCM names from directory structure instead of hardcoded map
  gcm_dirs <- list.dirs(future_dir, recursive = FALSE, full.names = FALSE)
  gcm_dirs <- gcm_dirs[!grepl("^wc2\\.", gcm_dirs)]  # exclude WorldClim current
  gcm_map <- setNames(gcm_dirs, gcm_dirs)  # identity map; display = directory name
  # Known GCMs get cleaner labels
  known_gcms <- c(
    "UKESM1-0-LL" = "UKESM1-0-LL", "MPI-ESM1-2-HR" = "MPI-ESM1-2-HR",
    "IPSL-CM6A-LR" = "IPSL-CM6A-LR", "MRI-ESM2-0" = "MRI-ESM2-0",
    "GFDL-ESM4" = "GFDL-ESM4"
  )
  for (gcm in names(known_gcms)) {
    if (gcm %in% gcm_dirs) gcm_map[[gcm]] <- known_gcms[[gcm]]
  }
  ssp_labels <- c("SSP1-2.6", "SSP2-4.5", "SSP3-7.0", "SSP5-8.5")
  ssp_codes <- c("126", "245", "370", "585")
  rows <- list()
  for (d in subdirs) {
    bn <- basename(d)
    if (grepl("^averaged_", bn)) {
      parts <- strsplit(bn, "_")[[1]]
      ssp_code_idx <- which(grepl("^SSP[0-9]", parts))[1]
      if (!is.na(ssp_code_idx) && ssp_code_idx > 2) {
        gcms <- paste(parts[2:(ssp_code_idx - 1)], collapse = "_")
        gcm_display <- paste(parts[2:(ssp_code_idx - 1)], collapse = " + ")
        ssp_code <- gsub("^SSP", "", parts[ssp_code_idx])
        period <- parts[ssp_code_idx + 1]
      } else {
        gcms <- bn
        gcm_display <- bn
        ssp_code <- NA
        period <- NA
      }
      tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
      size_mb <- sum(file.size(tifs), na.rm = TRUE) / 1e6
      ssp_display <- if (!is.na(ssp_code)) {
        names(ssp_codes)[ssp_codes == ssp_code][1] %||% paste0("SSP", ssp_code)
      } else {
        NA
      }
      rows <- c(rows, list(data.frame(
        GCM = paste0("Ensemble (", gcm_display, ")"),
        SSP = ssp_display,
        Period = period,
        Files = length(tifs),
        SizeMB = round(size_mb, 1),
        dir = basename(d),
        stringsAsFactors = FALSE
      )))
    } else {
      ssp_pos <- regexpr("SSP[0-9]{1,3}(-[0-9])?", bn)[1]
      if (ssp_pos > 1) {
        gcm <- substr(bn, 1, ssp_pos - 2)
        rest <- substr(bn, ssp_pos, nchar(bn))
        rest_parts <- strsplit(rest, "_")[[1]]
        ssp_label <- rest_parts[1]
        period <- rest_parts[2]
      } else {
        gcm <- bn
        ssp_label <- NA
        period <- NA
      }
      gcm_display <- names(gcm_map)[grepl(gsub("-", ".", gcm), gcm_map, ignore.case = TRUE)][1] %||% gcm
      ssp_display <- if (!is.na(ssp_label) && ssp_label %in% ssp_labels) ssp_label else if (!is.na(ssp_label)) ssp_label else NA
      tifs <- list.files(d, pattern = "\\.tif$", full.names = TRUE, recursive = TRUE)
      size_mb <- sum(file.size(tifs), na.rm = TRUE) / 1e6
      rows <- c(rows, list(data.frame(
        GCM = gcm_display, SSP = ssp_display,
        Period = period, Files = length(tifs),
        SizeMB = round(size_mb, 1),
        dir = basename(d),
        stringsAsFactors = FALSE
      )))
    }
  }
  scenarios <- if (length(rows) > 0) {
    do.call(rbind, rows)
  } else {
    data.frame(
      GCM = character(), SSP = character(), Period = character(),
      Files = integer(), SizeMB = numeric()
    )
  }
  scenarios <- scenarios[!is.na(scenarios$GCM) & scenarios$Files > 0, , drop = FALSE]
  total_size_mb <- sum(scenarios$SizeMB, na.rm = TRUE)
  if (nrow(scenarios) == 0) {
    status <- "warn"
    detail <- "No CMIP6 scenarios downloaded yet"
  } else {
    status <- "ok"
    detail <- paste(
      nrow(scenarios), "scenario(s) available —",
      round(total_size_mb, 0), "MB total"
    )
  }
  list(
    scenarios = scenarios, status = status, detail = detail,
    total_size_mb = total_size_mb
  )
}

# ---------------------------------------------------------------------------
# Elevation: OpenTopography
# ---------------------------------------------------------------------------

verify_elevation_cache <- function(cache_dir = "covariates/opentopo") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available = character(), dem_types = character(),
      status = "error", detail = "Elevation cache directory not found",
      size_mb = NA_real_
    ))
  }
  tifs <- list.files(cache_dir, pattern = "\\.tif$", full.names = TRUE)
  dem_types <- unique(sub("_[^_]+$", "", basename(tifs)))
  dem_types <- dem_types[nzchar(dem_types)]
  size_mb <- sum(file.size(tifs), na.rm = TRUE) / 1e6
  if (length(tifs) == 0) {
    status <- "warn"
    detail <- "No elevation tiles cached — download required"
  } else {
    status <- "ok"
    detail <- paste(
      length(tifs), "tile(s) cached —",
      paste(dem_types, collapse = ", ")
    )
  }
  list(
    available = basename(tifs), dem_types = dem_types, status = status,
    detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# Soil: SoilGrids
# ---------------------------------------------------------------------------

verify_soil_cache <- function(cache_dir = "covariates/soilgrids") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available = character(), missing = "all",
      status = "error", detail = "SoilGrids cache directory not found",
      size_mb = NA_real_
    ))
  }
  vars <- c("bdod", "cfvo", "clay", "nitrogen", "soc", "phh2o", "sand", "silt", "cec")
  depths <- c("5", "15", "30", "60", "100", "200")
  tifs <- list.files(cache_dir, pattern = "\\.tif$", full.names = TRUE)
  present <- character()
  for (f in basename(tifs)) {
    m <- regexpr("sg_(.+)_d(\\d+)", f, ignore.case = TRUE)
    if (m > 0) {
      var <- regmatches(f, m, invert = FALSE)[[1]][2]
      dep <- regmatches(f, m)[[1]][3]
      present <- c(present, paste0(var, "_d", dep))
    }
  }
  all <- paste0(rep(vars, each = length(depths)), "_d", rep(depths, times = length(vars)))
  present <- unique(present)
  missing <- setdiff(all, present)
  size_mb <- sum(file.size(tifs), na.rm = TRUE) / 1e6
  n_total <- length(all)
  n_present <- length(present)
  if (n_present == 0) {
    status <- "warn"
    detail <- "No SoilGrids layers cached"
  } else if (length(missing) == 0) {
    status <- "ok"
    detail <- "All soil layers present"
  } else {
    status <- "warn"
    detail <- paste(
      n_present, "of", n_total, "soil layers cached —",
      length(missing), "missing"
    )
  }
  list(
    available = present, missing = missing, status = status,
    detail = detail, size_mb = size_mb,
    vars = vars, depths = depths
  )
}

# ---------------------------------------------------------------------------
# UV-B: glUV
# ---------------------------------------------------------------------------

verify_uv_cache <- function(cache_dir = "covariates/gluv") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available = character(), missing = "all",
      status = "error", detail = "UV-B cache directory not found",
      size_mb = NA_real_
    ))
  }
  files <- list.files(cache_dir,
    pattern = "\\.(tif|asc)$", full.names = TRUE,
    ignore.case = TRUE
  )
  annual_vars <- c("gluv_UVB1", "gluv_UVB2", "gluv_UVB3", "gluv_UVB4", "gluv_UVB5", "gluv_UVB6")
  monthly_vars <- paste0("gluv_monthly_", sprintf("%02d", 1:12))
  present <- character()
  for (f in basename(files)) {
    for (av in annual_vars) {
      if (grepl(gsub("gluv_", "gluv_", av), f, ignore.case = TRUE)) present <- c(present, av)
    }
    for (mv in monthly_vars) {
      if (grepl(mv, f, ignore.case = TRUE)) present <- c(present, mv)
    }
  }
  present <- unique(present)
  all_vars <- c(annual_vars, monthly_vars)
  missing <- setdiff(all_vars, present)
  size_mb <- sum(file.size(files), na.rm = TRUE) / 1e6
  if (length(missing) == 0 && length(present) > 0) {
    status <- "ok"
    detail <- "All UV-B layers present"
  } else {
    status <- "warn"
    detail <- paste(
      length(present), "of", length(all_vars),
      "UV-B layers cached"
    )
  }
  list(
    available = present, missing = missing, status = status,
    detail = detail, size_mb = size_mb, annual_vars = annual_vars,
    monthly_vars = monthly_vars
  )
}

# ---------------------------------------------------------------------------
# Vegetation: GIMMS NDVI/EVI + GEE LAI/GPP
# ---------------------------------------------------------------------------

verify_vegetation_cache <- function(cache_dir = "covariates/vegetation") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      gimms_ndvi = character(), gimms_evi = FALSE,
      gee_auth = FALSE, status = "error",
      detail = "Vegetation cache directory not found",
      size_mb = NA_real_
    ))
  }
  files <- list.files(cache_dir,
    pattern = "\\.tif$", full.names = TRUE,
    ignore.case = TRUE
  )
  ndvi_files <- files[grepl("gimms_ndvi", files, ignore.case = TRUE)]
  evi_file <- files[grepl("gimms_evi", files, ignore.case = TRUE)]
  gee_auth <- requireNamespace("rgee", quietly = TRUE) &&
    tryCatch(rgee::ee_check(), error = function(e) FALSE)
  gimms_ndvi <- basename(ndvi_files)
  gimms_evi <- length(evi_file) > 0
  size_mb <- sum(file.size(c(ndvi_files, evi_file)), na.rm = TRUE) / 1e6
  if (length(ndvi_files) == 0 && !gimms_evi) {
    status <- "warn"
    detail <- "No vegetation data cached"
  } else {
    parts <- c(
      paste(length(ndvi_files), "GIMMS NDVI file(s)"),
      if (gimms_evi) "GIMMS EVI" else character()
    )
    detail <- paste(parts, collapse = " — ")
    status <- "ok"
  }
  if (!requireNamespace("rgee", quietly = TRUE)) {
    detail <- paste0(detail, " | GEE: rgee not installed")
  } else if (!gee_auth) {
    detail <- paste0(detail, " | GEE: not initialized (run rgee::ee_initialize())")
  } else {
    detail <- paste0(detail, " | GEE: authenticated")
  }
  list(
    gimms_ndvi = gimms_ndvi, gimms_evi = gimms_evi, gee_auth = gee_auth,
    status = status, detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# LULC: MODIS MCD12Q1
# ---------------------------------------------------------------------------

verify_lulc_cache <- function(cache_dir = "covariates/lulc") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available_years = integer(), missing_years = 2001:2023,
      status = "error", detail = "LULC cache directory not found",
      size_mb = NA_real_
    ))
  }
  files <- list.files(cache_dir,
    pattern = "\\.tif$", full.names = TRUE,
    ignore.case = TRUE
  )
  year_matches <- regmatches(basename(files), gregexpr("lulc_frac_(\\d{4})", basename(files), perl = TRUE))
  avail_years <- sort(unique(as.integer(gsub("lulc_frac_", "", unlist(year_matches)))))
  all_years <- 2001:2023
  missing_years <- setdiff(all_years, avail_years)
  size_mb <- sum(file.size(files), na.rm = TRUE) / 1e6
  if (length(avail_years) == 0) {
    status <- "warn"
    detail <- "No LULC data cached"
  } else {
    status <- "ok"
    detail <- paste(
      length(avail_years), "LULC year(s) cached —",
      paste(range(avail_years), collapse = "-")
    )
  }
  list(
    available_years = avail_years, missing_years = missing_years,
    status = status, detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# Human Footprint
# ---------------------------------------------------------------------------

verify_hfp_cache <- function(cache_dir = "covariates/human_footprint") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available_years = integer(), missing_years = 2001:2020,
      status = "error", detail = "HFP cache directory not found",
      size_mb = NA_real_
    ))
  }
  files <- list.files(cache_dir,
    pattern = "\\.tif$", full.names = TRUE,
    ignore.case = TRUE
  )
  avail_years <- integer()
  if (length(files) > 0) {
    m <- regexpr("hfp_(\\d{4})", basename(files), perl = TRUE)
    avail_years <- sort(unique(as.integer(regmatches(basename(files), m, invert = FALSE)[[1]])))
  }
  all_years <- 2001:2020
  missing_years <- setdiff(all_years, avail_years)
  size_mb <- sum(file.size(files), na.rm = TRUE) / 1e6
  if (length(avail_years) == 0) {
    status <- "warn"
    detail <- "No HFP data cached"
  } else {
    status <- "ok"
    detail <- paste(
      length(avail_years), "HFP year(s) cached —",
      paste(range(avail_years), collapse = "-")
    )
  }
  list(
    available_years = avail_years, missing_years = missing_years,
    status = status, detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# Drought: CRU scPDSI
# ---------------------------------------------------------------------------

verify_drought_cache <- function(cache_dir = "covariates/drought") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available = character(), missing = c("annual_mean", "wet_season", "dry_season"),
      status = "error", detail = "Drought cache directory not found",
      size_mb = NA_real_
    ))
  }
  files <- list.files(cache_dir,
    pattern = "\\.tif$", full.names = TRUE,
    ignore.case = TRUE
  )
  periods <- c("annual_mean", "wet_season", "dry_season")
  present <- character()
  for (p in periods) {
    pat <- paste0("scpdsi_", p)
    if (any(grepl(pat, basename(files), ignore.case = TRUE))) present <- c(present, p)
  }
  missing <- setdiff(periods, present)
  size_mb <- sum(file.size(files), na.rm = TRUE) / 1e6
  if (length(missing) == 0 && length(present) > 0) {
    status <- "ok"
    detail <- "All drought periods cached"
  } else {
    status <- "warn"
    detail <- paste(
      length(present), "of", length(periods),
      "drought periods cached"
    )
  }
  list(
    available = present, missing = missing, status = status,
    detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# Bioclimatic Seasonality: GDD / Moisture Index
# ---------------------------------------------------------------------------

verify_bioclim_season_cache <- function(cache_dir = "covariates/bioclim_season") {
  cache_dir <- normalizePath(cache_dir, winslash = "/", mustWork = FALSE)
  if (!dir.exists(cache_dir)) {
    return(list(
      available = character(), missing = c("gdd5", "gdd10", "mi", "p_seasonality"),
      status = "error", detail = "Bioclim season cache directory not found",
      size_mb = NA_real_
    ))
  }
  files <- list.files(cache_dir,
    pattern = "\\.tif$", full.names = TRUE,
    ignore.case = TRUE
  )
  vars <- c("gdd5", "gdd10", "mi", "p_seasonality")
  present <- character()
  for (v in vars) {
    pat <- paste0("bioclim_season.*", v)
    if (any(grepl(pat, basename(files), ignore.case = TRUE))) present <- c(present, v)
  }
  missing <- setdiff(vars, present)
  size_mb <- sum(file.size(files), na.rm = TRUE) / 1e6
  if (length(missing) == 0 && length(present) > 0) {
    status <- "ok"
    detail <- "All bioclim season layers present"
  } else {
    status <- "warn"
    detail <- paste(
      length(present), "of", length(vars),
      "bioclim season layers cached"
    )
  }
  list(
    available = present, missing = missing, status = status,
    detail = detail, size_mb = size_mb
  )
}

# ---------------------------------------------------------------------------
# Overall summary (for Quick Actions section)
# ---------------------------------------------------------------------------

get_data_summary <- function() {
  wc <- verify_worldclim_cache()
  ch <- verify_chelsa_extras_cache()
  fu <- verify_future_cache()
  el <- verify_elevation_cache()
  so <- verify_soil_cache()
  uv <- verify_uv_cache()
  ve <- verify_vegetation_cache()
  lu <- verify_lulc_cache()
  hf <- verify_hfp_cache()
  dr <- verify_drought_cache()
  bi <- verify_bioclim_season_cache()

  total_mb <- sum(c(
    wc$size_mb, ch$size_mb, fu$total_size_mb, el$size_mb,
    so$size_mb, uv$size_mb, ve$size_mb, lu$size_mb,
    hf$size_mb, dr$size_mb, bi$size_mb
  ), na.rm = TRUE)

  list(
    worldclim = wc,
    chelsa_extras = ch,
    future = fu,
    elevation = el,
    soil = so,
    uv = uv,
    vegetation = ve,
    lulc = lu,
    hfp = hf,
    drought = dr,
    bioclim_season = bi,
    total_covariates_mb = round(total_mb, 1)
  )
}
