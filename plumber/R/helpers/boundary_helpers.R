sdm_boundary_internal_only <- function(req, res) {
  if (identical(req$auth_source %||% "", "hono_internal")) return(NULL)
  res$status <- 403L
  list(error = sdm_error_code_direct("ACCESS_DENIED", "Canonical boundary operations require the API gateway"))
}

handle_boundary_default <- function(req, res, app_dir, resolution = NULL, type = NULL, country = NULL, file_path = NULL) {
  dataset_type <- type %||% "admin0"
  scale <- resolution %||% "110m"
  country_val <- country %||% "all"

  boundary_path <- if (dataset_type == "custom" && !is.null(file_path) && nzchar(file_path)) {
    denied <- sdm_boundary_internal_only(req, res)
    if (!is.null(denied)) return(denied)
    custom_dir <- tryCatch(normalizePath(file.path(app_dir, "data", "uploads", "boundaries"), winslash = "/"), error = function(e) NULL)
    resolved_path <- tryCatch(normalizePath(file_path, winslash = "/", mustWork = FALSE), error = function(e) NULL)
    if (is.null(resolved_path) || is.null(custom_dir) || !startsWith(resolved_path, paste0(custom_dir, "/"))) {
      res$status <- 403L
      return(list(error = "Invalid boundary file path"))
    }
    resolved_path
  } else if (dataset_type %in% c("admin0", "land")) {
    tryCatch(
      resolve_mask_file(dataset_type, scale, country_val, raster_res = NULL, default_file = NULL),
      error = function(e) NULL
    )
  } else {
    NULL
  }

  if (!is.null(boundary_path) && !file.exists(boundary_path)) {
    abs_path <- file.path(app_dir, boundary_path)
    if (file.exists(abs_path)) boundary_path <- abs_path
  }
  if (identical(dataset_type, "custom") && (is.null(boundary_path) || !file.exists(boundary_path))) {
    res$status <- 404L
    return(list(error = "Boundary file not found"))
  }
  if (is.null(boundary_path) || !file.exists(boundary_path)) {
    fallback <- sdm_default_mask_file
    if (!file.exists(fallback)) fallback <- file.path(app_dir, fallback)
    boundary_path <- fallback
  }
  if (!file.exists(boundary_path)) {
    res$status <- 404L
    return(list(error = "Boundary file not found"))
  }

  geojson <- jsonlite::fromJSON(boundary_path, simplifyVector = FALSE)
  geojson
}

handle_boundary_upload <- function(req, res, app_dir) {
  denied <- sdm_boundary_internal_only(req, res)
  if (!is.null(denied)) return(denied)
  file_name <- req$args$file_name
  file_content <- req$args$file_content
  if (is.null(file_name) || is.null(file_content) || !nzchar(file_content)) {
    res$status <- 400L
    return(list(error = "No file uploaded"))
  }
  ext <- tolower(tools::file_ext(file_name))
  if (!ext %in% c("geojson", "json", "kml", "gpkg", "zip")) {
    res$status <- 400L
    return(list(error = "Only .geojson, .json, .kml, .gpkg, or .zip files accepted. For shapefiles, zip the .shp + .shx + .dbf + .prj together."))
  }
  tmp <- tempfile(fileext = paste0(".", ext))
  on.exit(unlink(tmp), add = TRUE)
  writeBin(jsonlite::base64_dec(file_content), tmp)

  boundary_dir <- file.path(app_dir, "data", "uploads", "boundaries")
  dir.create(boundary_dir, recursive = TRUE, showWarnings = FALSE)
  uuid_base <- paste0(format(Sys.time(), "%Y%m%d_%H%M%S"), "_", gsub("-", "", uuid::UUIDgenerate()))

  needs_conversion <- !ext %in% c("geojson", "json")
  src <- tmp
  if (needs_conversion) {
    if (ext == "zip") {
      zip_dir <- tempfile()
      dir.create(zip_dir, showWarnings = FALSE)
      on.exit(unlink(zip_dir, recursive = TRUE), add = TRUE)
      zip_entries <- tryCatch(utils::unzip(src, list = TRUE)$Name,
                              error = function(e) character(0))
      for (entry in zip_entries) {
        normalized <- gsub("\\\\", "/", entry)
        if (grepl("^/|^[A-Za-z]:", normalized) ||
            grepl("\\.\\./", normalized) ||
            grepl("/\\.\\.", normalized) ||
            substr(normalized, nchar(normalized) - 1L, nchar(normalized)) == "..") {
          res$status <- 400L
          return(list(error = "ZIP archive contains unsafe paths; refusing to extract"))
        }
      }
      utils::unzip(src, exdir = zip_dir)
      src <- list.files(zip_dir, pattern = "\\.(shp|kml|gpkg|geojson|json)$", full.names = TRUE, recursive = TRUE)[1]
      if (is.na(src) || !file.exists(src)) {
        res$status <- 400L
        return(list(error = "ZIP archive does not contain a valid vector file (.shp, .kml, .gpkg, .geojson)"))
      }
    }
    dest <- file.path(boundary_dir, paste0(uuid_base, ".geojson"))
    tryCatch({
      vec <- sf::st_read(src, quiet = TRUE)
      sf::st_write(vec, dest, delete_dsn = TRUE, quiet = TRUE)
    }, error = function(e) {
      res$status <- 400L
      stop("Failed to convert boundary file: ", conditionMessage(e))
    })
  } else {
    dest <- file.path(boundary_dir, paste0(uuid_base, ".geojson"))
    file.copy(src, dest, overwrite = TRUE)
  }
  list(
    file_path = normalizePath(dest, winslash = "/"),
    file_name = file_name,
    file_size = file.size(dest)
  )
}

handle_boundary_list <- function(req, res, app_dir) {
  denied <- sdm_boundary_internal_only(req, res)
  if (!is.null(denied)) return(denied)
  custom_dir <- file.path(app_dir, "data", "uploads", "boundaries")
  if (!dir.exists(custom_dir)) {
    return(list(boundaries = list()))
  }
  user_id <- req$user_id %||% NULL
  is_admin <- isTRUE(req$user_role == "admin")
  files <- list.files(custom_dir, pattern = "\\.geojson$", full.names = TRUE)
  boundaries <- lapply(files, function(f) {
    if (!is.null(user_id) && !is_admin && !sdm_boundary_owned_by(f, user_id)) return(NULL)
    list(
      file_path = normalizePath(f, winslash = "/"),
      file_name = basename(f),
      file_size = file.size(f),
      modified_at = format(file.mtime(f), "%Y-%m-%dT%H:%M:%SZ")
    )
  })
  boundaries <- Filter(Negate(is.null), boundaries)
  list(boundaries = boundaries)
}

handle_boundary_delete <- function(req, res, app_dir) {
  denied <- sdm_boundary_internal_only(req, res)
  if (!is.null(denied)) return(denied)
  file_path <- req$args$file_path
  if (is.null(file_path) || !nzchar(file_path)) {
    res$status <- 400L
    return(list(error = "File path required"))
  }
  custom_dir <- tryCatch(normalizePath(file.path(app_dir, "data", "uploads", "boundaries"), winslash = "/"), error = function(e) NULL)
  resolved_path <- tryCatch(normalizePath(file_path, winslash = "/", mustWork = FALSE), error = function(e) NULL)
  if (is.null(resolved_path) || is.null(custom_dir) || !startsWith(resolved_path, paste0(custom_dir, "/"))) {
    res$status <- 403L
    return(list(error = "Invalid file path"))
  }
  if (!file.exists(resolved_path)) {
    res$status <- 404L
    return(list(error = "File not found"))
  }
  if (!isTRUE(file.remove(resolved_path))) stop("Boundary file deletion failed", call. = FALSE)
  sidecar <- paste0(resolved_path, ".owner")
  if (file.exists(sidecar)) file.remove(sidecar)
  list(ok = TRUE)
}

sdm_write_boundary_owner <- function(boundary_path, user_id) {
  sidecar <- paste0(boundary_path, ".owner")
  tryCatch(writeLines(user_id, sidecar), error = function(e) NULL)
}

sdm_boundary_owned_by <- function(boundary_path, user_id) {
  sidecar <- paste0(boundary_path, ".owner")
  if (!file.exists(sidecar)) return(FALSE)
  owner <- tryCatch(readLines(sidecar, warn = FALSE)[1], error = function(e) NULL)
  !is.null(owner) && nzchar(owner) && owner == user_id
}

handle_boundary_countries <- function(res, app_dir) {
  boundary_path <- file.path(app_dir, "data", "boundaries", "ne", "110m", "ne_10m_admin_0_countries.geojson")
  if (!file.exists(boundary_path)) {
    res$status <- 404L
    return(list(error = "Admin 0 boundary not found — download NE data first"))
  }
  geojson <- jsonlite::fromJSON(boundary_path, simplifyVector = FALSE)
  feats <- geojson$features %||% list()
  countries <- unique(vapply(feats, function(f) {
    props <- f$properties %||% list()
    props$ADMIN %||% props$NAME %||% props$name %||% "Unknown"
  }, character(1)))
  countries <- sort(countries[!is.na(countries) & countries != ""])
  list(countries = countries)
}

handle_boundary_extent <- function(req, res, app_dir, file_path = NULL, type = NULL, resolution = NULL, country = NULL, buffer_deg = 2) {
  if (!is.null(file_path) || identical(type, "custom")) {
    denied <- sdm_boundary_internal_only(req, res)
    if (!is.null(denied)) return(denied)
    custom_dir <- tryCatch(normalizePath(file.path(app_dir, "data", "uploads", "boundaries"), winslash = "/"), error = function(e) NULL)
    resolved_path <- tryCatch(normalizePath(file_path %||% "", winslash = "/", mustWork = FALSE), error = function(e) NULL)
    if (is.null(resolved_path) || is.null(custom_dir) || !startsWith(resolved_path, paste0(custom_dir, "/"))) {
      res$status <- 403L
      return(list(error = "Invalid boundary file path"))
    }
    file_path <- resolved_path
  }
  if (is.null(file_path) || !file.exists(file_path)) {
    if (!is.null(type)) {
      res_type <- type %||% "admin0"
      res_scale <- resolution %||% "110m"
      if (identical(res_scale, "auto")) res_scale <- ne_boundary_infer_scale(NULL)
      if (res_type %in% c("admin0", "land")) {
        file_path <- get_ne_boundary_path(res_scale, res_type)
        if (!file.exists(file_path)) {
          file_path <- download_ne_boundary(res_scale, res_type)
        }
        if (res_type == "admin0" && !is.null(country) && nzchar(country) && tolower(country) != "all") {
          file_path <- filter_admin0_to_country(file_path, country)
        }
      }
    }
  }
  if (is.null(file_path) || !file.exists(file_path)) {
    res$status <- 404L
    return(list(error = "Boundary file not found"))
  }
  tryCatch({
    vec <- terra::vect(file_path)
    e <- terra::ext(vec)
    xmin <- e[1]; xmax <- e[2]; ymin <- e[3]; ymax <- e[4]
    buf <- as.numeric(buffer_deg) %||% 2
    list(xmin = xmin - buf, xmax = xmax + buf, ymin = ymin - buf, ymax = ymax + buf)
  }, error = function(e) {
    res$status <- 500L
    list(error = paste("Failed to compute extent:", conditionMessage(e)))
  })
}

handle_boundary_download <- function(res, app_dir, type = "admin0", resolution = "110m", country = "all") {
  tryCatch({
    scale <- resolution %||% "110m"
    country_val <- country %||% "all"

    boundary_path <- tryCatch(
      resolve_mask_file(type, scale, country_val, raster_res = NULL, default_file = NULL),
      error = function(e) NULL
    )

    if (!is.null(boundary_path) && !file.exists(boundary_path)) {
      abs_path <- file.path(app_dir, boundary_path)
      if (file.exists(abs_path)) boundary_path <- abs_path
    }

    if (is.null(boundary_path) || !file.exists(boundary_path)) {
      fallback <- sdm_default_mask_file
      if (!file.exists(fallback)) fallback <- file.path(app_dir, fallback)
      if (file.exists(fallback)) {
        boundary_path <- fallback
      } else {
        return(list(status = "error", message = "Boundary not available via Natural Earth download"))
      }
    }

    list(
      status = "success",
      message = paste("Downloaded", type, "boundary at", scale, "resolution")
    )
  }, error = function(e) {
    list(status = "error", message = conditionMessage(e))
  })
}
