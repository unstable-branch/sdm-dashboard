`%||%` <- function(a, b) if (!is.null(a)) a else b

sdm_boundary_storage_root <- function(app_dir, configured_root = Sys.getenv("SDM_INPUT_ASSET_BOUNDARY_ROOT", unset = "")) {
  root <- if (!is.null(configured_root) && nzchar(configured_root)) configured_root else file.path(app_dir, "data", "boundaries")
  root <- path.expand(root)
  root <- gsub("\\\\", "/", root, fixed = TRUE)
  if (!startsWith(root, "/")) root <- file.path(getwd(), root)
  if (!identical(root, "/")) root <- sub("/$", "", root)
  root
}

sdm_boundary_path_has_parent_segment <- function(path) {
  normalized <- gsub("\\\\", "/", path, fixed = TRUE)
  grepl("(^|/)\\.\\.(/|$)", normalized, perl = TRUE)
}

sdm_boundary_path_has_symlink <- function(path, root) {
  candidates <- unique(c(root, path))
  for (candidate in candidates) {
    candidate <- gsub("\\\\", "/", candidate, fixed = TRUE)
    current <- if (startsWith(candidate, "/")) "/" else ""
    for (segment in strsplit(candidate, "/", fixed = TRUE)[[1]]) {
      if (!nzchar(segment)) next
      current <- file.path(current, segment)
      link_target <- Sys.readlink(current)
      if (length(link_target) > 0L && !is.na(link_target) && nzchar(link_target)) return(TRUE)
    }
  }
  FALSE
}

sdm_boundary_root_is_safe <- function(root) {
  !sdm_boundary_path_has_symlink(root, root)
}

sdm_resolve_boundary_path <- function(path, root = NULL, app_dir = NULL) {
  if (is.null(path) || length(path) != 1L || is.na(path) || !nzchar(path) || !startsWith(path, "/")) return(NULL)
  if (grepl("[[:cntrl:]]", path) || sdm_boundary_path_has_parent_segment(path)) return(NULL)
  root_path <- if (is.null(root)) {
    sdm_boundary_storage_root(app_dir %||% getwd())
  } else {
    sdm_boundary_storage_root(getwd(), root)
  }
  candidate <- normalizePath(path, winslash = "/", mustWork = FALSE)
  if (!(identical(candidate, root_path) || startsWith(candidate, paste0(root_path, "/")))) return(NULL)
  if (!file.exists(candidate) || dir.exists(candidate) || sdm_boundary_path_has_symlink(path, root_path)) return(NULL)
  candidate
}

handle_boundary_default <- function(res, app_dir, resolution = NULL, type = NULL, country = NULL, file_path = NULL) {
  boundary_root <- sdm_boundary_storage_root(app_dir)
  if (!sdm_boundary_root_is_safe(boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary storage root is unsafe"))
  }
  dataset_type <- type %||% "admin0"
  scale <- resolution %||% "110m"
  country_val <- country %||% "all"

  boundary_path <- if (dataset_type == "custom") {
    resolved_path <- sdm_resolve_boundary_path(file_path, sdm_boundary_storage_root(app_dir))
    if (is.null(resolved_path)) {
      res$status <- 403L
      return(list(error = "Invalid server-owned boundary file"))
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

  if (dataset_type != "custom" && !is.null(boundary_path) && !file.exists(boundary_path)) {
    abs_path <- file.path(app_dir, boundary_path)
    if (file.exists(abs_path)) boundary_path <- abs_path
  }
  if (is.null(boundary_path) || !file.exists(boundary_path)) {
    if (dataset_type == "custom") {
      res$status <- 404L
      return(list(error = "Boundary file not found"))
    }
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

  boundary_root <- sdm_boundary_storage_root(app_dir)
  if (!sdm_boundary_root_is_safe(boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary storage root is unsafe"))
  }
  boundary_dir <- file.path(boundary_root, "custom")
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

handle_boundary_countries <- function(res, app_dir) {
  boundary_root <- sdm_boundary_storage_root(app_dir)
  if (!sdm_boundary_root_is_safe(boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary storage root is unsafe"))
  }
  boundary_path <- file.path(boundary_root, "ne", "110m", "ne_10m_admin_0_countries.geojson")
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
  boundary_root <- sdm_boundary_storage_root(app_dir)
  if (!sdm_boundary_root_is_safe(boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary storage root is unsafe"))
  }
  if (!is.null(file_path)) {
    file_path <- sdm_resolve_boundary_path(file_path, boundary_root)
    if (is.null(file_path)) {
      res$status <- 403L
      return(list(error = "Invalid server-owned boundary file"))
    }
  } else if (!is.null(type)) {
    res_type <- type %||% "admin0"
    res_scale <- resolution %||% "110m"
    if (identical(res_scale, "auto")) res_scale <- ne_boundary_infer_scale(NULL)
    if (res_type == "custom") {
      res$status <- 400L
      return(list(error = "Custom boundaries require a server-owned file"))
    }
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

sdm_boundary_download_filename <- function(type, resolution, country) {
  label <- if (!identical(country, "all")) gsub("[^a-zA-Z0-9_-]", "_", tolower(country)) else type
  token <- gsub("[^A-Za-z0-9]", "", basename(tempfile("boundary-")))
  sprintf("ne_%s_%s_%s_%s.geojson", resolution, type, label, token)
}

handle_boundary_download <- function(res, app_dir, type = "admin0", resolution = "110m", country = "all") {
  tryCatch({
    boundary_root <- sdm_boundary_storage_root(app_dir)
    if (!sdm_boundary_root_is_safe(boundary_root)) {
      res$status <- 500L
      return(list(status = "error", message = "Boundary storage root is unsafe"))
    }
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

    custom_dir <- file.path(boundary_root, "custom")
    dir.create(custom_dir, recursive = TRUE, showWarnings = FALSE)
    saved_name <- sdm_boundary_download_filename(type, scale, country_val)
    saved_path <- file.path(custom_dir, saved_name)

    if (!isTRUE(file.copy(boundary_path, saved_path, overwrite = TRUE))) {
      return(list(status = "error", message = "Failed to save downloaded boundary"))
    }

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
