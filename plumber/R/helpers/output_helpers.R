handle_output_compare <- function(res, run_id1, run_id2, app_dir) {
  load_result <- function(rid) {
    job_dir <- sdm_safe_job_dir(rid)
    if (is.null(job_dir)) return(NULL)
    meta_file <- file.path(job_dir, "meta.json")
    if (!file.exists(meta_file)) return(NULL)
    meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
    if (meta$status != "completed") return(NULL)
    result_rds <- meta$output_files$result_rds
    if (is.null(result_rds) || !file.exists(result_rds)) return(NULL)
    tryCatch(sdm_read_result(result_rds), error = function(e) NULL)
  }

  r1 <- load_result(run_id1)
  r2 <- load_result(run_id2)

  if (is.null(r1) || is.null(r2)) {
    res$status <- 404L
    return(list(error = "One or both runs not found or not completed"))
  }

  tryCatch({
    comp <- compare_runs(r1, r2)
    comp$report_text <- format_comparison_text(comp)
    comp
  }, error = function(e) {
    list(error = paste("Comparison failed:", conditionMessage(e)))
  })
}

handle_output_script <- function(res, run_id, app_dir, output_dir = NULL) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  if (meta$status != "completed") {
    res$status <- 400L; return(list(error = "Run not completed yet"))
  }

  output_files <- meta$output_files %||% list()
  result_rds <- output_files$result_rds

  if (is.null(result_rds) || !file.exists(result_rds)) {
    res$status <- 404L; return(list(error = "Result file not found"))
  }

  tryCatch({
    result <- sdm_read_result(result_rds)
    script_path <- file.path(job_dir, "reproducible_run.R")
    source(sdm_resolve_module("script_export.R"), local = TRUE)
    export_run_script(result, script_path)
    list(ok = TRUE, script_path = script_path)
  }, error = function(e) {
    list(error = paste("Script export failed:", conditionMessage(e)))
  })
}

handle_output_manifest <- function(res, run_id, app_dir) {
  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; return(list(error = "Run not found")) }
  meta_file <- file.path(job_dir, "meta.json")

  if (!file.exists(meta_file)) {
    res$status <- 404L; return(list(error = "Run not found"))
  }

  meta <- jsonlite::fromJSON(meta_file, simplifyVector = FALSE)
  config <- meta$config %||% list()
  metrics <- meta$metrics %||% list()
  output_files <- meta$output_files %||% list()

  git_sha <- tryCatch(
    system("git rev-parse HEAD", intern = TRUE, ignore.stderr = TRUE),
    error = function(e) NA_character_
  )
  if (length(git_sha) != 1 || !nzchar(git_sha)) git_sha <- NA_character_

  si <- sessionInfo()
  pkg_versions <- list()
  if (!is.null(si$otherPkgs)) {
    for (pkg_name in names(si$otherPkgs)) {
      pkg_versions[[pkg_name]] <- si$otherPkgs[[pkg_name]]$Version %||% NA_character_
    }
  }

  occ_hash <- NA_character_
  occ_file <- config$occurrence_file
  if (!is.null(occ_file) && nzchar(occ_file) && file.exists(occ_file)) {
    occ_hash <- tryCatch(
      digest::digest(occ_file, algo = "sha256", file = TRUE),
      error = function(e) NA_character_
    )
  }

  manifest <- list(
    run_id = meta$id,
    run_timestamp = meta$started_at %||% format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
    app_version = list(
      git_sha = git_sha,
      r_version = R.version.string,
      platform = R.version$platform,
      package_versions = pkg_versions
    ),
    species = config$species,
    model = list(
      id = config$model_id,
      seed = config$seed %||% NA_integer_,
      parameters = config
    ),
    data = list(
      occurrence_file = occ_file,
      occurrence_hash_sha256 = occ_hash,
      record_count = metrics$presence_records %||% NA_integer_
    ),
    climate = list(
      source = config$source %||% "worldclim",
      worldclim_dir = config$worldclim_dir %||% NA_character_,
      biovars = config$biovars %||% NA_character_,
      resolution = config$worldclim_res %||% 10
    ),
    validation = list(
      cv_folds = config$cv_folds %||% NA_integer_,
      cv_strategy = config$cv_strategy %||% NA_character_,
      seed = config$seed %||% NA_integer_
    ),
    metrics = metrics,
    output_files = output_files
  )

  manifest_path <- file.path(job_dir, "manifest.json")
  writeLines(jsonlite::toJSON(manifest, auto_unbox = TRUE, pretty = TRUE), manifest_path)

  list(ok = TRUE, manifest_path = manifest_path, manifest = manifest)
}

sdm_transparent_tile_png <- function() {
  as.raw(c(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82
  ))
}

tile_cog_cache <- new.env(parent = emptyenv())
tile_cog_cache_max <- 20L

handle_tile_serve <- function(res, run_id, z, x, y, app_dir) {
  z <- as.integer(z); x <- as.integer(x); y <- as.integer(y)
  if (is.na(z) || is.na(x) || is.na(y) || z < 0L || z > 20L) {
    res$status <- 400L; stop("Invalid tile coordinates")
  }
  n <- 2^z
  if (x < 0L || x >= n || y < 0L || y >= n) {
    res$status <- 400L; stop("Tile coordinates out of range")
  }

  job_dir <- sdm_safe_job_dir(run_id)
  if (is.null(job_dir)) { res$status <- 404L; stop("Run not found") }

  cog_path <- NULL; need_reproject <- FALSE
  cog_files <- list.files(job_dir, pattern = "_3857\\.tif$", full.names = TRUE)
  if (length(cog_files) > 0L) {
    cog_path <- cog_files[1L]
  } else {
    suit_files <- list.files(job_dir, pattern = "_suitability\\.tif$", full.names = TRUE)
    if (length(suit_files) > 0L) {
      fallback_path <- sub("_suitability\\.tif$", "_3857_fallback.tif", suit_files[1L])
      if (!file.exists(fallback_path)) {
        lock_path <- paste0(fallback_path, ".lock")
        lock_acquired <- dir.create(lock_path, showWarnings = FALSE)
        if (!lock_acquired && dir.exists(lock_path)) {
          lock_time_file <- file.path(lock_path, "created_at")
          if (file.exists(lock_time_file)) {
            lock_time <- as.POSIXct(readLines(lock_time_file, warn = FALSE))
            if (is.na(lock_time) || difftime(Sys.time(), lock_time, units = "mins") > 5) {
              unlink(lock_path, recursive = TRUE)
              lock_acquired <- dir.create(lock_path, showWarnings = FALSE)
            }
          } else {
            unlink(lock_path, recursive = TRUE)
            lock_acquired <- dir.create(lock_path, showWarnings = FALSE)
          }
        }
        if (lock_acquired) {
          writeLines(format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"), file.path(lock_path, "created_at"))
          on.exit(unlink(lock_path, recursive = TRUE), add = TRUE)
          if (!file.exists(fallback_path)) {
            r_4326 <- terra::rast(suit_files[1L])
            r_3857 <- terra::project(r_4326, "EPSG:3857", method = "near")
            terra::writeRaster(r_3857, fallback_path, filetype = "COG",
              gdal = c("COMPRESS=DEFLATE", "PREDICTOR=2", "ZLEVEL=6", "BLOCKSIZE=512"),
              NAflag = -9999, datatype = "FLT4S", overwrite = TRUE)
          }
        }
      }
      cog_path <- fallback_path
    }
  }
  if (is.null(cog_path)) { res$status <- 404L; stop("No raster found for run") }

  cog_mtime <- file.info(cog_path)$mtime
  cog_key <- paste0(cog_path, "_", as.numeric(cog_mtime))
  r_cog <- tile_cog_cache[[cog_key]]
  if (is.null(r_cog)) {
    if (length(ls(tile_cog_cache)) >= tile_cog_cache_max) {
      access_times <- sapply(ls(tile_cog_cache), function(k) attr(tile_cog_cache[[k]], "accessed") %||% 0)
      n_excess <- length(ls(tile_cog_cache)) - tile_cog_cache_max + 1L
      to_remove <- names(sort(access_times))[seq_len(n_excess)]
      rm(list = to_remove, envir = tile_cog_cache)
    }
    r_cog <- terra::rast(cog_path)
    attr(r_cog, "accessed") <- Sys.time()
    tile_cog_cache[[cog_key]] <- r_cog
  } else {
    attr(r_cog, "accessed") <- Sys.time()
    tile_cog_cache[[cog_key]] <- r_cog
  }
  cog_range <- terra::minmax(r_cog)
  vr_min <- max(0, cog_range[1, 1])
  vr_max <- min(1, cog_range[2, 1])
  if (!is.finite(vr_min) || !is.finite(vr_max) || vr_max <= vr_min) {
    vr_min <- 0; vr_max <- 1
  }

  n <- 2^z
  tile_res <- 40075016.685578488 / n
  half_world <- 20037508.342789244
  xmin <- x * tile_res - half_world
  xmax <- (x + 1L) * tile_res - half_world
  ymin <- half_world - (y + 1L) * tile_res
  ymax <- half_world - y * tile_res

  r_full <- NULL
  tile_crop <- tryCatch(terra::crop(r_cog, terra::ext(xmin, xmax, ymin, ymax), snap = "out"),
    error = function(e) NULL)
  if (is.null(tile_crop) || terra::ncell(tile_crop) == 0L) {
    r_full <- terra::rast(cog_path)
    tile_crop <- tryCatch(terra::crop(r_full, terra::ext(xmin, xmax, ymin, ymax), snap = "out"),
      error = function(e) NULL)
  }

  template <- terra::rast(ncols = 256L, nrows = 256L, xmin = xmin, xmax = xmax,
    ymin = ymin, ymax = ymax, crs = "EPSG:3857")

  if (is.null(tile_crop) || terra::ncell(tile_crop) == 0L) {
    cx <- (xmin + xmax) / 2
    cy <- (ymin + ymax) / 2
    pt <- terra::vect(data.frame(x = cx, y = cy), geom = c("x", "y"), crs = "EPSG:3857")
    center_val <- terra::extract(r_full %||% r_cog, pt)[1, 1]
    if (is.na(center_val) || !is.finite(center_val)) { res$status <- 204L; return(sdm_transparent_tile_png()) }
    vals <- rep(as.numeric(center_val), 65536)
    is_na <- rep(FALSE, 65536)
  } else {
    vals <- terra::values(tile_crop)
    has_na_edge <- any(is.na(vals))
    resample_method <- if (has_na_edge) "near" else "bilinear"
    tile_256 <- tryCatch(terra::resample(tile_crop, template, method = resample_method),
      error = function(e) NULL)
    if (is.null(tile_256)) { res$status <- 204L; return(sdm_transparent_tile_png()) }
    vals <- terra::values(tile_256)
    is_na <- is.na(vals) | !is.finite(vals) | (vals <= -9998)
    if (all(is_na)) { res$status <- 204L; return(sdm_transparent_tile_png()) }
  }

  palette <- sdm_suitability_palette
  pal_rgb <- grDevices::col2rgb(palette, alpha = TRUE)
  n_col <- length(palette)
  idx <- if (all(is_na)) integer(0) else {
    round((vals - vr_min) / (vr_max - vr_min) * (n_col - 1L)) + 1L
  }
  if (length(idx) > 0) idx <- pmax(1L, pmin(n_col, idx))

  rgba <- matrix(0L, nrow = 65536L, ncol = 4L)
  rgba[!is_na, 1L] <- pal_rgb[1, idx[!is_na]]
  rgba[!is_na, 2L] <- pal_rgb[2, idx[!is_na]]
  rgba[!is_na, 3L] <- pal_rgb[3, idx[!is_na]]
  rgba[!is_na, 4L] <- 255L

  tmp_png <- tempfile(fileext = ".png")
  tile_out <- terra::rast(ncols = 256L, nrows = 256L, xmin = xmin, xmax = xmax,
    ymin = ymin, ymax = ymax, crs = "EPSG:3857", nlyrs = 4L)
  terra::values(tile_out) <- rgba
  terra::writeRaster(tile_out, tmp_png, datatype = "INT1U", gdal = "ZLEVEL=6", overwrite = TRUE)
  raw_bytes <- readBin(tmp_png, "raw", n = file.info(tmp_png)$size)
  unlink(tmp_png)
  res$setHeader("Cache-Control", "public, max-age=3600")
  raw_bytes
}
