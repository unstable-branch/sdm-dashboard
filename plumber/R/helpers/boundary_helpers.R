handle_boundary_default <- function(res, app_dir, resolution = NULL, type = NULL, country = NULL) {
  dataset_type <- type %||% "admin0"
  scale <- resolution %||% "110m"
  country_val <- country %||% "all"

  boundary_path <- if (dataset_type == "custom" && !is.null(country) && nzchar(country)) {
    custom_dir <- tryCatch(normalizePath(file.path(app_dir, "data", "boundaries"), winslash = "/"), error = function(e) NULL)
    resolved_path <- tryCatch(normalizePath(country, winslash = "/", mustWork = FALSE), error = function(e) NULL)
    if (is.null(resolved_path) || is.null(custom_dir) || !startsWith(resolved_path, custom_dir)) {
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

  boundary_dir <- file.path(app_dir, "data", "boundaries", "custom")
  dir.create(boundary_dir, recursive = TRUE, showWarnings = FALSE)
  uuid_base <- paste0(format(Sys.time(), "%Y%m%d_%H%M%S"), "_", gsub("-", "", uuid::UUIDgenerate()))

  needs_conversion <- !ext %in% c("geojson", "json")
  src <- tmp
  if (needs_conversion) {
    if (ext == "zip") {
      zip_dir <- tempfile()
      dir.create(zip_dir, showWarnings = FALSE)
      on.exit(unlink(zip_dir, recursive = TRUE), add = TRUE)
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

handle_boundary_list <- function(res, app_dir) {
  custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
  if (!dir.exists(custom_dir)) {
    return(list(boundaries = list()))
  }
  files <- list.files(custom_dir, pattern = "\\.geojson$", full.names = TRUE)
  boundaries <- lapply(files, function(f) {
    list(
      file_path = normalizePath(f, winslash = "/"),
      file_name = basename(f),
      file_size = file.size(f),
      modified_at = format(file.mtime(f), "%Y-%m-%dT%H:%M:%SZ")
    )
  })
  list(boundaries = boundaries)
}

handle_boundary_delete <- function(req, res, app_dir) {
  file_path <- req$args$file_path
  if (is.null(file_path) || !nzchar(file_path)) {
    res$status <- 400L
    return(list(error = "File path required"))
  }
  custom_dir <- tryCatch(normalizePath(file.path(app_dir, "data", "boundaries", "custom"), winslash = "/"), error = function(e) NULL)
  resolved_path <- tryCatch(normalizePath(file_path, winslash = "/", mustWork = FALSE), error = function(e) NULL)
  if (is.null(resolved_path) || is.null(custom_dir) || !startsWith(resolved_path, custom_dir)) {
    res$status <- 403L
    return(list(error = "Invalid file path"))
  }
  if (!file.exists(resolved_path)) {
    res$status <- 404L
    return(list(error = "File not found"))
  }
  file.remove(resolved_path)
  list(ok = TRUE)
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

handle_boundary_extent <- function(res, app_dir, file_path = NULL, type = NULL, resolution = NULL, country = NULL, buffer_deg = 2) {
  if (is.null(file_path) || !file.exists(file_path)) {
    if (!is.null(type)) {
      res_type <- type %||% "admin0"
      res_scale <- resolution %||% "110m"
      if (identical(res_scale, "auto")) res_scale <- ne_boundary_infer_scale(NULL)
      if (res_type == "custom" && !is.null(country) && nzchar(country)) {
        file_path <- country
      } else if (res_type %in% c("admin0", "land")) {
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

    custom_dir <- file.path(app_dir, "data", "boundaries", "custom")
    dir.create(custom_dir, recursive = TRUE, showWarnings = FALSE)
    label <- if (country_val != "all") gsub("[^a-zA-Z0-9_-]", "_", tolower(country_val)) else type
    saved_name <- sprintf("ne_%s_%s_%s.geojson", scale, type, label)
    saved_path <- file.path(custom_dir, saved_name)

    file.copy(boundary_path, saved_path, overwrite = TRUE)

    list(
      status = "success",
      message = paste("Downloaded", type, "boundary at", scale, "resolution"),
      file = list(
        file_path = normalizePath(saved_path, winslash = "/"),
        file_name = saved_name,
        file_size = file.size(saved_path)
      )
    )
  }, error = function(e) {
    list(status = "error", message = conditionMessage(e))
  })
}
