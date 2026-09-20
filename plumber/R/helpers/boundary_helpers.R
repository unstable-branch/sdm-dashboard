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

sdm_boundary_destination_is_safe <- function(path, root) {
  !file.exists(path) && !dir.exists(path) && !sdm_boundary_path_has_symlink(path, root)
}

sdm_boundary_uuid_is_valid <- function(value) {
  is.character(value) && length(value) == 1L &&
    grepl("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value, ignore.case = TRUE)
}

sdm_boundary_with_database <- function(callback) {
  pool_obj <- tryCatch(get("db_pool", envir = .GlobalEnv), error = function(e) NULL)
  if (exists("sdm_get_db_pool", mode = "function", inherits = TRUE)) {
    pool_obj <- tryCatch(sdm_get_db_pool(pool_obj), error = function(e) NULL)
  }
  if (!is.null(pool_obj) && inherits(pool_obj, "Pool")) {
    con <- tryCatch(pool::poolCheckout(pool_obj), error = function(e) NULL)
    if (is.null(con)) return(NULL)
    on.exit(tryCatch(pool::poolReturn(con), error = function(e) NULL), add = TRUE)
    return(tryCatch(callback(con), error = function(e) NULL))
  }
  if (!exists("sdm_db_connect", mode = "function", inherits = TRUE)) return(NULL)
  con <- tryCatch(sdm_db_connect(), error = function(e) NULL)
  if (is.null(con)) return(NULL)
  on.exit(tryCatch(DBI::dbDisconnect(con), error = function(e) NULL), add = TRUE)
  tryCatch(callback(con), error = function(e) NULL)
}

sdm_boundary_asset_path <- function(req, boundary_asset_id, project_id = NULL, file_path = NULL,
                                    boundary_root) {
  user_id <- tryCatch(as.character(req$user_id %||% "")[1], error = function(e) "")
  user_role <- tryCatch(as.character(req$user_role %||% "")[1], error = function(e) "")
  if (!sdm_boundary_uuid_is_valid(boundary_asset_id) || !sdm_boundary_uuid_is_valid(user_id) ||
      !user_role %in% c("admin", "editor", "viewer")) return(NULL)
  if (!is.null(project_id) && !sdm_boundary_uuid_is_valid(project_id)) return(NULL)

  sdm_boundary_with_database(function(con) {
    assets <- DBI::dbGetQuery(con,
      "SELECT id, creator_user_id, scope, project_id, kind, state, storage_locator,
             content_sha256, content_size
         FROM input_assets
        WHERE id = $1 AND kind = 'custom_boundary' AND state = 'ready'
        LIMIT 1",
      params = list(boundary_asset_id)
    )
    if (nrow(assets) != 1L) return(NULL)
    asset <- assets[1, , drop = FALSE]
    asset_project_id <- if (is.na(asset$project_id[[1]])) "" else as.character(asset$project_id[[1]])
    asset_scope <- if (is.na(asset$scope[[1]])) "" else as.character(asset$scope[[1]])
    if (asset_scope == "private") {
      if (!identical(as.character(asset$creator_user_id[[1]]), user_id)) return(NULL)
    } else if (asset_scope == "project") {
      if (!sdm_boundary_uuid_is_valid(asset_project_id) ||
          (!is.null(project_id) && !identical(project_id, asset_project_id))) return(NULL)
      if (!identical(user_role, "admin")) {
        members <- DBI::dbGetQuery(con,
          "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1",
          params = list(asset_project_id, user_id)
        )
        if (nrow(members) != 1L || !as.character(members$role[[1]]) %in% c("admin", "editor", "viewer")) return(NULL)
      }
    } else {
      return(NULL)
    }
    locator <- if (is.na(asset$storage_locator[[1]])) "" else as.character(asset$storage_locator[[1]])
    parts <- strsplit(locator, "/", fixed = TRUE)[[1]]
    if (length(parts) < 2L || !identical(parts[[1]], "boundaries") ||
        any(!nzchar(parts[-1]) | parts[-1] %in% c(".", "..")) ||
        any(grepl("[[:cntrl:]\\\\:]", parts[-1]))) return(NULL)
    candidate <- file.path(boundary_root, paste(parts[-1], collapse = "/"))
    resolved <- sdm_resolve_boundary_path(candidate, boundary_root)
    if (is.null(resolved)) return(NULL)
    content_sha256 <- if (is.na(asset$content_sha256[[1]])) "" else tolower(as.character(asset$content_sha256[[1]]))
    content_size <- suppressWarnings(as.numeric(asset$content_size[[1]]))
    if (!grepl("^[0-9a-f]{64}$", content_sha256) || !is.finite(content_size) || content_size < 0) return(NULL)
    actual_size <- suppressWarnings(as.numeric(file.info(resolved)$size))
    actual_hash <- tryCatch(digest::digest(file = resolved, algo = "sha256", serialize = FALSE), error = function(e) NULL)
    if (!is.finite(actual_size) || actual_size != content_size || is.null(actual_hash) ||
        !identical(tolower(actual_hash), content_sha256)) return(NULL)
    if (!is.null(file_path)) {
      supplied <- tryCatch(normalizePath(file_path, winslash = "/", mustWork = FALSE), error = function(e) NULL)
      if (is.null(supplied) || !identical(supplied, resolved)) return(NULL)
    }
    resolved
  })
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

handle_boundary_default <- function(res, app_dir, resolution = NULL, type = NULL, country = NULL, file_path = NULL,
                                    boundary_asset_id = NULL, project_id = NULL, req = NULL) {
  boundary_root <- sdm_boundary_storage_root(app_dir)
  if (!sdm_boundary_root_is_safe(boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary storage root is unsafe"))
  }
  dataset_type <- type %||% "admin0"
  scale <- resolution %||% "110m"
  country_val <- country %||% "all"
  if (!is.character(dataset_type) || length(dataset_type) != 1L || !dataset_type %in% c("admin0", "land", "custom") ||
      !is.character(scale) || length(scale) != 1L || !scale %in% c("auto", "10m", "50m", "110m")) {
    res$status <- 400L
    return(list(error = "Invalid boundary type or resolution"))
  }

  if (dataset_type %in% c("admin0", "land")) {
    natural_earth_path <- tryCatch(get_ne_boundary_path(scale, dataset_type), error = function(e) NULL)
    if (!is.null(natural_earth_path) && sdm_boundary_path_has_symlink(natural_earth_path, boundary_root)) {
      res$status <- 500L
      return(list(error = "Natural Earth boundary storage is unsafe"))
    }
  }

  boundary_path <- if (dataset_type == "custom") {
    if (is.null(boundary_asset_id) || is.null(req) || !is.null(file_path)) {
      res$status <- 400L
      return(list(error = "Custom boundaries require a canonical asset ID"))
    }
    resolved_path <- sdm_boundary_asset_path(req, boundary_asset_id, project_id, boundary_root = boundary_root)
    if (is.null(resolved_path)) {
      res$status <- 404L
      return(list(error = "Boundary file not found"))
    }
    resolved_path
  } else if (dataset_type %in% c("admin0", "land")) {
    if (!is.null(file_path)) {
      res$status <- 400L
      return(list(error = "Path-based boundary inputs are not supported"))
    }
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
  if (sdm_boundary_path_has_symlink(boundary_path, boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary path is unsafe"))
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
  if (sdm_boundary_path_has_symlink(boundary_dir, boundary_root)) {
    res$status <- 500L
    return(list(error = "Custom boundary storage is unsafe"))
  }
  dir.create(boundary_dir, recursive = TRUE, showWarnings = FALSE)
  if (!dir.exists(boundary_dir) || sdm_boundary_path_has_symlink(boundary_dir, boundary_root)) {
    res$status <- 500L
    return(list(error = "Custom boundary storage is unsafe"))
  }
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
      extracted_all <- list.files(zip_dir, all.files = TRUE, recursive = TRUE, full.names = TRUE, no.. = TRUE)
      if (any(vapply(extracted_all, function(path) {
        target <- Sys.readlink(path)
        length(target) > 0L && !is.na(target) && nzchar(target)
      }, logical(1)))) {
        res$status <- 400L
        return(list(error = "ZIP archive contains symlinks; refusing to extract"))
      }
      src <- list.files(zip_dir, pattern = "\\.(shp|kml|gpkg|geojson|json)$", full.names = TRUE, recursive = TRUE)[1]
      if (is.na(src) || !file.exists(src)) {
        res$status <- 400L
        return(list(error = "ZIP archive does not contain a valid vector file (.shp, .kml, .gpkg, .geojson)"))
      }
    }
    dest <- file.path(boundary_dir, paste0(uuid_base, ".geojson"))
    if (!sdm_boundary_destination_is_safe(dest, boundary_root)) {
      res$status <- 500L
      return(list(error = "Failed to save uploaded boundary"))
    }
    converted <- tryCatch({
      vec <- sf::st_read(src, quiet = TRUE)
      sf::st_write(vec, dest, delete_dsn = TRUE, quiet = TRUE)
      TRUE
    }, error = function(e) {
      warning("Boundary conversion failed: ", conditionMessage(e), call. = FALSE)
      FALSE
    })
    if (!converted) {
      res$status <- 400L
      return(list(error = "Boundary conversion failed"))
    }
  } else {
    dest <- file.path(boundary_dir, paste0(uuid_base, ".geojson"))
    if (!sdm_boundary_destination_is_safe(dest, boundary_root) ||
        !isTRUE(file.copy(src, dest, overwrite = FALSE))) {
      res$status <- 500L
      return(list(error = "Failed to save uploaded boundary"))
    }
  }
  if (is.null(sdm_resolve_boundary_path(normalizePath(dest, winslash = "/", mustWork = FALSE), boundary_root))) {
    res$status <- 500L
    return(list(error = "Uploaded boundary storage is unsafe"))
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
  if (sdm_boundary_path_has_symlink(boundary_path, boundary_root)) {
    res$status <- 500L
    return(list(error = "Natural Earth boundary storage is unsafe"))
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

handle_boundary_extent <- function(res, app_dir, file_path = NULL, type = NULL, resolution = NULL, country = NULL, buffer_deg = 2,
                                   boundary_asset_id = NULL, project_id = NULL, req = NULL) {
  boundary_root <- sdm_boundary_storage_root(app_dir)
  if (!sdm_boundary_root_is_safe(boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary storage root is unsafe"))
  }
  if ((!is.null(type) && (!is.character(type) || length(type) != 1L || !type %in% c("admin0", "land", "custom"))) ||
      (!is.null(resolution) && (!is.character(resolution) || length(resolution) != 1L || !resolution %in% c("auto", "10m", "50m", "110m")))) {
    res$status <- 400L
    return(list(error = "Invalid boundary type or resolution"))
  }
  if (!is.null(file_path) || identical(type, "custom") || !is.null(boundary_asset_id)) {
    if (is.null(boundary_asset_id) || is.null(req) || !is.null(file_path) || !identical(type %||% "custom", "custom")) {
      res$status <- 400L
      return(list(error = "Custom boundaries require a canonical asset ID"))
    }
    file_path <- sdm_boundary_asset_path(req, boundary_asset_id, project_id, boundary_root = boundary_root)
    if (is.null(file_path)) {
      res$status <- 404L
      return(list(error = "Boundary file not found"))
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
      if (sdm_boundary_path_has_symlink(file_path, boundary_root)) {
        res$status <- 500L
        return(list(error = "Natural Earth boundary storage is unsafe"))
      }
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
  if (sdm_boundary_path_has_symlink(file_path, boundary_root)) {
    res$status <- 500L
    return(list(error = "Boundary path is unsafe"))
  }
  tryCatch({
    vec <- terra::vect(file_path)
    e <- terra::ext(vec)
    xmin <- e[1]; xmax <- e[2]; ymin <- e[3]; ymax <- e[4]
    buf <- as.numeric(buffer_deg) %||% 2
    list(xmin = xmin - buf, xmax = xmax + buf, ymin = ymin - buf, ymax = ymax + buf)
  }, error = function(e) {
    warning("Boundary extent failed: ", conditionMessage(e), call. = FALSE)
    res$status <- 500L
    list(error = "Boundary extent failed")
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
    if (!is.character(type) || length(type) != 1L || !type %in% c("admin0", "land") ||
        !is.character(scale) || length(scale) != 1L || !scale %in% c("10m", "50m", "110m")) {
      res$status <- 400L
      return(list(status = "error", message = "Invalid boundary type or resolution"))
    }
    natural_earth_path <- get_ne_boundary_path(scale, type)
    if (sdm_boundary_path_has_symlink(natural_earth_path, boundary_root)) {
      res$status <- 500L
      return(list(status = "error", message = "Natural Earth boundary storage is unsafe"))
    }

    boundary_path <- tryCatch(resolve_mask_file(type, scale, country_val, raster_res = NULL, default_file = NULL),
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
    if (sdm_boundary_path_has_symlink(boundary_path, boundary_root)) {
      return(list(status = "error", message = "Boundary source path is unsafe"))
    }

    custom_dir <- file.path(boundary_root, "custom")
    if (sdm_boundary_path_has_symlink(custom_dir, boundary_root)) {
      return(list(status = "error", message = "Custom boundary storage is unsafe"))
    }
    dir.create(custom_dir, recursive = TRUE, showWarnings = FALSE)
    if (!dir.exists(custom_dir) || sdm_boundary_path_has_symlink(custom_dir, boundary_root)) {
      return(list(status = "error", message = "Custom boundary storage is unsafe"))
    }
    saved_name <- sdm_boundary_download_filename(type, scale, country_val)
    saved_path <- file.path(custom_dir, saved_name)

    if (file.exists(saved_path) || sdm_boundary_path_has_symlink(saved_path, boundary_root) ||
        !isTRUE(file.copy(boundary_path, saved_path, overwrite = FALSE))) {
      return(list(status = "error", message = "Failed to save downloaded boundary"))
    }
    if (is.null(sdm_resolve_boundary_path(normalizePath(saved_path, winslash = "/", mustWork = FALSE), boundary_root))) {
      return(list(status = "error", message = "Downloaded boundary storage is unsafe"))
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
    warning("Boundary download failed: ", conditionMessage(e), call. = FALSE)
    res$status <- 500L
    list(status = "error", message = "Boundary download failed")
  })
}
