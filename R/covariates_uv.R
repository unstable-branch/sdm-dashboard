# Cache: <covariate_cache_dir>/gluv/
# CI strategy: allow_download=FALSE returns NULL on cache miss; no network calls made
# CRS: UFZ archive ASC files read with terra; bilinear resampling after cache load
# API keys: none
# glUV UV-B covariate loading via UFZ VSI archive.

uv_vars <- c(
  "UVB1" = "Annual Mean UV-B",
  "UVB2" = "UV-B Seasonality",
  "UVB3" = "Mean UV-B of Highest Month",
  "UVB4" = "Mean UV-B of Lowest Month",
  "UVB5" = "Sum UV-B during Highest Quarter",
  "UVB6" = "Sum UV-B during Lowest Quarter"
)

uv_months <- c(
  "January"   = "01",
  "February"  = "02",
  "March"     = "03",
  "April"     = "04",
  "May"       = "05",
  "June"      = "06",
  "July"      = "07",
  "August"    = "08",
  "September" = "09",
  "October"   = "10",
  "November"  = "11",
  "December"  = "12"
)

gluv_base_url <- "http://www.ufz.de/export/data/global/"

load_uv_covariate <- function(selected_uv_vars = names(uv_vars),
                               selected_uv_months = NULL,
                               covariate_cache_dir = sdm_default_covariate_cache_dir,
                               allow_download = TRUE,
                               log_fun = NULL) {
  if (!requireNamespace("curl", quietly = TRUE)) {
    stop("curl package required for UV downloads. Install with: install.packages('curl')")
  }
  selected_uv_vars <- unique(as.character(selected_uv_vars))
  selected_uv_vars <- selected_uv_vars[nzchar(selected_uv_vars)]
  selected_uv_months <- unique(as.character(selected_uv_months))
  selected_uv_months <- selected_uv_months[nzchar(selected_uv_months)]

  if (length(selected_uv_vars) == 0 && length(selected_uv_months) == 0) {
    log_message(log_fun, "UV covariates selected, but no UV variables were chosen.")
    return(NULL)
  }

  invalid_vars <- setdiff(selected_uv_vars, names(uv_vars))
  if (length(invalid_vars) > 0) {
    log_message(log_fun, "Unknown UV variable(s): ", paste(invalid_vars, collapse = ", "),
                ". Available: ", paste(names(uv_vars), collapse = ", "))
    selected_uv_vars <- setdiff(selected_uv_vars, invalid_vars)
  }

  invalid_months <- setdiff(selected_uv_months, names(uv_months))
  if (length(invalid_months) > 0) {
    log_message(log_fun, "Unknown UV month(s): ", paste(invalid_months, collapse = ", "),
                ". Available: ", paste(names(uv_months), collapse = ", "))
    selected_uv_months <- setdiff(selected_uv_months, invalid_months)
  }

  if (length(selected_uv_vars) == 0 && length(selected_uv_months) == 0) {
    log_message(log_fun, "No valid UV variables or months selected.")
    return(NULL)
  }

  cache_dir <- file.path(covariate_cache_dir, "gluv")
  if (!dir.exists(cache_dir)) dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

  layers <- list()
  files <- character(0)
  loaded <- character(0)

  for (var in selected_uv_vars) {
    layer_name <- paste0("uv_", var)
    cached_file <- file.path(cache_dir, paste0("gluv_", var, ".asc"))

    if (file.exists(cached_file)) {
      log_message(log_fun, "Using cached glUV layer: ", layer_name)
      r <- terra::rast(cached_file)
    } else if (isTRUE(allow_download)) {
      log_message(log_fun, "Downloading glUV ", var, " from UFZ archive")
      remote <- paste0(gluv_base_url, switch(var,
        "UVB1" = "56459_UVB1_Annual_Mean_UV-B.asc",
        "UVB2" = "56460_UVB2_UV-B_Seasonality.asc",
        "UVB3" = "56461_UVB3_Mean_UV-B_of_Highest_Month.asc",
        "UVB4" = "56462_UVB4_Mean_UV-B_of_Lowest_Month.asc",
        "UVB5" = "56463_UVB5_Sum_of_UV-B_Radiation_of_Highest_Quarter.asc",
        "UVB6" = "56464_UVB6_Sum_of_UV-B_Radiation_of_Lowest_Quarter.asc"
      ))
      r <- tryCatch({
        curl::curl_fetch_disk(remote, cached_file)
        terra::rast(cached_file)
      }, error = function(e) {
        log_message(log_fun, "Failed to download glUV ", var, ": ", conditionMessage(e))
        NULL
      })
      if (!is.null(r) && inherits(r, "SpatRaster")) {
        files <- c(files, cached_file)
      }
    } else {
      log_message(log_fun, "glUV layer not cached and downloads disabled: ", layer_name)
      r <- NULL
    }

    if (!is.null(r) && inherits(r, "SpatRaster")) {
      names(r) <- layer_name
      layers[[layer_name]] <- r
      loaded <- c(loaded, var)
    }
  }

  for (month_label in selected_uv_months) {
    month_code <- uv_months[[month_label]]
    layer_name <- paste0("uv_month_", month_code)
    cached_file <- file.path(cache_dir, paste0("gluv_monthly_", month_code, ".asc"))

    if (file.exists(cached_file)) {
      log_message(log_fun, "Using cached glUV layer: ", layer_name)
      r <- terra::rast(cached_file)
    } else if (isTRUE(allow_download)) {
      log_message(log_fun, "Downloading glUV monthly layer: ", month_label)
      remote <- paste0(gluv_base_url, switch(month_label,
        "January"   = "56465_glUV_January_monthly_mean.asc",
        "February"  = "56466_glUV_February_monthly_mean.asc",
        "March"     = "56467_glUV_March_monthly_mean.asc",
        "April"     = "56468_glUV_April_monthly_mean.asc",
        "May"       = "56469_glUV_May_monthly_mean.asc",
        "June"      = "56470_glUV_June_monthly_mean.asc",
        "July"      = "56471_glUV_July_monthly_mean.asc",
        "August"    = "56472_glUV_August_monthly_mean.asc",
        "September" = "56473_glUV_September_monthly_mean.asc",
        "October"   = "56474_glUV_October_monthly_means.asc",
        "November"  = "56475_glUV_November_monthly_means.asc",
        "December"  = "56476_glUV_December_monthly_means.asc"
      ))
      r <- tryCatch({
        curl::curl_fetch_disk(remote, cached_file)
        terra::rast(cached_file)
      }, error = function(e) {
        log_message(log_fun, "Failed to download glUV monthly layer ", month_label, ": ", conditionMessage(e))
        NULL
      })
      if (!is.null(r) && inherits(r, "SpatRaster")) {
        files <- c(files, cached_file)
      }
    } else {
      log_message(log_fun, "glUV monthly layer not cached and downloads disabled: ", layer_name)
      r <- NULL
    }

    if (!is.null(r) && inherits(r, "SpatRaster")) {
      names(r) <- layer_name
      layers[[layer_name]] <- r
      loaded <- c(loaded, paste0("month_", month_code))
    }
  }

  if (length(layers) == 0) {
    log_message(log_fun, "No glUV layers could be loaded.")
    return(NULL)
  }

  uv_raster <- do.call(c, layers)
  methods <- rep("bilinear", terra::nlyr(uv_raster))
  names(methods) <- names(uv_raster)

  log_message(log_fun, "Loaded ", terra::nlyr(uv_raster), " glUV layer(s): ", paste(names(uv_raster), collapse = ", "))
  list(
    raster = uv_raster,
    files = files,
    source = "glUV (UFZ) via VSI",
    variables = loaded,
    methods = methods
  )
}