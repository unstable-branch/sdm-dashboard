# HWSD v2 soil covariate loading from a local/cached GeoTIFF.

hwsd_band_order <- c(
  "HWSD2_ID", "WISE30s_ID", "COVERAGE", "SHARE", "WRB4", "WRB_PHASES",
  "WRB2_CODE", "FAO90", "KOPPEN", "TEXTURE_USDA", "REF_BULK_DENSITY",
  "BULK_DENSITY", "DRAINAGE", "ROOT_DEPTH", "AWC", "PHASE1", "PHASE2",
  "ROOTS", "IL", "ADD_PROP"
)

hwsd_soil_choices <- c(
  "Texture class (USDA)" = "TEXTURE_USDA",
  "Reference bulk density" = "REF_BULK_DENSITY",
  "Bulk density" = "BULK_DENSITY",
  "Drainage" = "DRAINAGE",
  "Root depth" = "ROOT_DEPTH",
  "Available water capacity" = "AWC",
  "Root abundance" = "ROOTS"
)

if (!exists("sdm_default_soil_vars", inherits = TRUE)) {
  sdm_default_soil_vars <- c("BULK_DENSITY", "DRAINAGE", "ROOT_DEPTH", "AWC")
}
soil_categorical_vars <- c("TEXTURE_USDA", "DRAINAGE")

normalize_soil_layer_names <- function(r) {
  nm <- names(r)
  generic <- grepl("^(lyr|layer|band)", nm, ignore.case = TRUE) | nm == ""
  if (terra::nlyr(r) == length(hwsd_band_order) && any(generic)) {
    names(r) <- hwsd_band_order
  }
  r
}

soil_output_name <- function(var) paste0("soil_", tolower(var))

load_soil_covariate <- function(soil_path = sdm_default_soil_path,
                                selected_soil_vars = sdm_default_soil_vars,
                                log_fun = NULL) {
  selected_soil_vars <- unique(as.character(selected_soil_vars))
  selected_soil_vars <- selected_soil_vars[nzchar(selected_soil_vars)]
  if (length(selected_soil_vars) == 0) {
    log_message(log_fun, "Soil covariates selected, but no soil variables were chosen.")
    return(NULL)
  }
  if (is.null(soil_path) || !nzchar(soil_path) || !file.exists(soil_path)) {
    log_message(log_fun, "Soil covariates selected, but the HWSD GeoTIFF was not found: ", soil_path)
    return(NULL)
  }

  soil <- normalize_soil_layer_names(terra::rast(soil_path))
  available <- names(soil)
  selected_idx <- match(selected_soil_vars, available)
  missing <- selected_soil_vars[is.na(selected_idx)]
  selected_idx <- selected_idx[!is.na(selected_idx)]
  if (length(missing) > 0) {
    log_message(log_fun, "Skipping missing HWSD soil band(s): ", paste(missing, collapse = ", "))
  }
  if (length(selected_idx) == 0) {
    log_message(log_fun, "No requested HWSD soil bands were available in ", soil_path)
    return(NULL)
  }

  vars <- available[selected_idx]
  soil <- soil[[selected_idx]]
  names(soil) <- soil_output_name(vars)
  methods <- ifelse(vars %in% soil_categorical_vars, "near", "bilinear")
  names(methods) <- names(soil)
  log_message(log_fun, "Loaded ", terra::nlyr(soil), " HWSD soil layer(s) from ", normalizePath(soil_path, winslash = "/", mustWork = FALSE))
  list(raster = soil, files = soil_path, source = "HWSD v2 local GeoTIFF", variables = vars, methods = methods)
}
