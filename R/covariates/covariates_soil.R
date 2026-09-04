# Cache: <covariate_cache_dir>/soilgrids/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: geodata::soil_world (native 250m) resampled via bilinear; aggregate_factor alignment in load
# API keys: none
# SoilGrids covariate loading via geodata package.

soilgrids_vars <- c(
  "bdod" = "Bulk density (fine earth fraction)",
  "cfvo" = "Coarse fragments volumetric",
  "clay" = "Clay content (fine earth fraction)",
  "nitrogen" = "Total nitrogen",
  "soc" = "Soil organic carbon content",
  "phh2o" = "Soil pH (water)",
  "sand" = "Sand content (fine earth fraction)",
  "silt" = "Silt content (fine earth fraction)",
  "cec" = "Cation exchange capacity"
)

soilgrids_depths <- c(
  "0-5cm" = 5,
  "5-15cm" = 15,
  "15-30cm" = 30,
  "30-60cm" = 60,
  "60-100cm" = 100,
  "100-200cm" = 200
)

soilgrids_stat <- "mean"

if (!exists("sdm_default_soil_vars", inherits = TRUE)) {
  sdm_default_soil_vars <- c("sand", "clay", "phh2o")
}
if (!exists("sdm_default_soil_depths", inherits = TRUE)) {
  sdm_default_soil_depths <- c("0-5cm", "30-60cm")
}

soil_output_name <- function(var, depth) {
  paste0("soil_", var, "_", names(soilgrids_depths)[soilgrids_depths == depth])
}

# Internal: download a single SoilGrids layer with retry + exponential backoff.
# Tries geodata::soil_world up to max_retries times; on exhaustion falls back to
# direct ISRIC WCS download via download.file with an explicit timeout.
# Returns a SpatRaster or NULL on final failure.
.download_soilgrids_layer <- function(var, depth, stat, cache_dir,
                                        max_retries = 3L, base_delay_s = 10,
                                        timeout_s = 300, log_fun = NULL) {
  depth_label <- names(soilgrids_depths)[soilgrids_depths == depth]
  layer_name <- paste0("soil_", var, "_", depth_label)
  out_file <- file.path(cache_dir, paste0("sg_", var, "_d", depth, ".tif"))

  for (attempt in 1:max_retries) {
    log_message(log_fun, "[SoilGrids attempt ", attempt, "/", max_retries,
                "] ", layer_name)
    r <- tryCatch(
      geodata::soil_world(var = var, depth = depth, stat = stat, path = cache_dir),
      error = function(e) {
        log_message(log_fun, "[SoilGrids attempt ", attempt, " failed] ", var,
                    " depth ", depth_label, ": ", conditionMessage(e))
        NULL
      }
    )
    if (!is.null(r) && inherits(r, "SpatRaster")) {
      terra::writeRaster(r, out_file, overwrite = TRUE)
      log_message(log_fun, "[SoilGrids success] ", layer_name, " (attempt ", attempt, ")")
      return(r)
    }
    if (attempt < max_retries) {
      delay_s <- base_delay_s * (2 ^ (attempt - 1))
      log_message(log_fun, "[SoilGrids retry ", attempt, "/", max_retries,
                  "] sleeping ", delay_s, "s before next attempt for ", layer_name)
      Sys.sleep(delay_s)
    }
  }

  log_message(log_fun, "[SoilGrids exhausted retries] falling back to WCS for ",
              layer_name)
  wcs_url <- sprintf(
    paste0(
      "https://maps.isric.org/mapserv?map=/map/%s.map",
      "&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage",
      "&COVERAGEID=%s_%dcm_%s&FORMAT=GeoTIFF",
      "&SUBSAMPLING=1,1&"
    ),
    var, var, depth, stat
  )
  tmp_file <- tempfile(fileext = ".tif")
  download_succeeded <- tryCatch({
    old_timeout <- getOption("timeout")
    options(timeout = timeout_s)
    on.exit(options(timeout = old_timeout), add = TRUE)
    download.file(wcs_url, tmp_file, quiet = TRUE, mode = "wb")
    TRUE
  }, error = function(e) {
    log_message(log_fun, "[SoilGrids WCS fallback failed] ", layer_name, ": ",
                conditionMessage(e))
    if (file.exists(tmp_file)) unlink(tmp_file)
    FALSE
  })
  if (download_succeeded && file.exists(tmp_file)) {
    r <- tryCatch(terra::rast(tmp_file), error = function(e) NULL)
    if (!is.null(r) && inherits(r, "SpatRaster")) {
      terra::writeRaster(r, out_file, overwrite = TRUE)
      unlink(tmp_file)
      log_message(log_fun, "[SoilGrids WCS fallback success] ", layer_name)
      return(r)
    }
    unlink(tmp_file)
  }
  log_message(log_fun, "[SoilGrids all methods failed] ", layer_name)
  NULL
}

load_soil_covariate <- function(soil_path = NULL,
                                selected_soil_vars = sdm_default_soil_vars,
                                selected_soil_depths = sdm_default_soil_depths,
                                covariate_cache_dir = sdm_default_covariate_cache_dir,
                                allow_download = TRUE,
                                log_fun = NULL) {
  selected_soil_vars <- unique(as.character(selected_soil_vars))
  selected_soil_vars <- selected_soil_vars[nzchar(selected_soil_vars)]
  selected_soil_depths <- unique(as.character(selected_soil_depths))
  selected_soil_depths <- selected_soil_depths[nzchar(selected_soil_depths)]

  if (length(selected_soil_vars) == 0) {
    log_message(log_fun, "Soil covariates selected, but no SoilGrids variables were chosen.")
    return(NULL)
  }

  invalid_vars <- setdiff(selected_soil_vars, names(soilgrids_vars))
  if (length(invalid_vars) > 0) {
    log_message(log_fun, "Unknown SoilGrids variable(s): ", paste(invalid_vars, collapse = ", "), ". Available: ", paste(names(soilgrids_vars), collapse = ", "))
    selected_soil_vars <- setdiff(selected_soil_vars, invalid_vars)
  }
  if (length(selected_soil_vars) == 0) {
    log_message(log_fun, "No valid SoilGrids variables selected.")
    return(NULL)
  }

  invalid_depths <- setdiff(selected_soil_depths, names(soilgrids_depths))
  if (length(invalid_depths) > 0) {
    log_message(log_fun, "Unknown SoilGrids depth(s): ", paste(invalid_depths, collapse = ", "), ". Available: ", paste(names(soilgrids_depths), collapse = ", "))
    selected_soil_depths <- intersect(selected_soil_depths, names(soilgrids_depths))
  }
  if (length(selected_soil_depths) == 0) {
    selected_soil_depths <- names(soilgrids_depths)[1]
  }

  cache_dir <- file.path(covariate_cache_dir, "soilgrids")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  if (isTRUE(allow_download) && !requireNamespace("geodata", quietly = TRUE)) {
    log_message(log_fun, "SoilGrids download requires the 'geodata' package, which is not installed. ",
      "Run install.packages('geodata') or rebuild the Plumber Docker image to enable SoilGrids downloads.")
    allow_download <- FALSE
  }

  layers <- list()
  files <- character(0)
  loaded_vars <- character(0)

  for (var in selected_soil_vars) {
    for (depth_label in selected_soil_depths) {
      depth <- soilgrids_depths[[depth_label]]
      layer_name <- soil_output_name(var, depth)
      cached_file <- file.path(cache_dir, paste0("sg_", var, "_d", depth, ".tif"))

      if (file.exists(cached_file)) {
        log_message(log_fun, "Using cached SoilGrids layer: ", layer_name)
        r <- terra::rast(cached_file)
      } else if (isTRUE(allow_download)) {
        r <- .download_soilgrids_layer(
          var = var, depth = depth, stat = soilgrids_stat,
          cache_dir = cache_dir, log_fun = log_fun
        )
        if (!is.null(r) && inherits(r, "SpatRaster")) {
          files <- c(files, cached_file)
        }
      } else {
        log_message(log_fun, "SoilGrids layer not cached and downloads disabled: ", layer_name)
        r <- NULL
      }

      if (!is.null(r) && inherits(r, "SpatRaster")) {
        names(r) <- layer_name
        layers[[layer_name]] <- r
        loaded_vars <- c(loaded_vars, var)
      }
    }
  }

  if (length(layers) == 0) {
    log_message(log_fun, "No SoilGrids layers could be loaded.")
    return(NULL)
  }

  soil_raster <- do.call(c, layers)
  methods <- rep("bilinear", terra::nlyr(soil_raster))
  names(methods) <- names(soil_raster)

  log_message(log_fun, "Loaded ", terra::nlyr(soil_raster), " SoilGrids layer(s): ", paste(names(soil_raster), collapse = ", "))
  list(
    raster = soil_raster,
    files = files,
    source = "SoilGrids (ISRIC) via geodata",
    variables = unique(loaded_vars),
    methods = methods
  )
}
