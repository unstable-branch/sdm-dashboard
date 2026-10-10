# Plotting helpers used by the output writer.


load_australia_boundary <- function(path = sdm_australia_boundary_path) {
  if (!exists("sdm_australia_boundary_path", inherits = TRUE) || is.null(path) || !file.exists(path)) {
    return(NULL)
  }
  tryCatch(terra::vect(path), error = function(e) NULL)
}

plot_downsample_raster <- function(x, max_cells = 220000) {
  cells <- terra::ncell(x)
  if (is.na(cells) || cells <= max_cells) {
    return(x)
  }
  fact <- ceiling(sqrt(cells / max_cells))
  terra::aggregate(x, fact = fact, fun = "mean", na.rm = TRUE)
}

plot_suitability_map <- function(suitability, occ = NULL, projection_extent = NULL, species = "Species", threshold = sdm_default_threshold, add_points = TRUE) {
  threshold <- normalize_threshold(threshold)
  suitability_plot <- plot_downsample_raster(suitability)
  cols <- grDevices::colorRampPalette(sdm_suitability_palette)(sdm_suitability_palette_n)
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(
    mar = c(3.9, 4.3, 4.5, 5.5), bg = "#07111D", fg = "#D8E7F3",
    col.axis = "#B7C7D6", col.lab = "#D3E2EF", col.main = "#F2F7FB",
    cex.axis = 0.86, cex.lab = 0.92
  )
  terra::plot(suitability_plot,
    col = cols, range = c(0, 1), main = "", axes = TRUE,
    colNA = "#07111D", xlab = "Longitude", ylab = "Latitude",
    plg = list(
      title = "Suitability", title.cex = 0.88, cex = 0.78
    ), box = FALSE
  )
  australia_boundary <- load_australia_boundary()
  if (!is.null(australia_boundary)) {
    try(terra::plot(australia_boundary,
      add = TRUE,
      border = grDevices::adjustcolor("#E9F7EF", 0.86),
      col = grDevices::adjustcolor("#0B1F2E", 0.10), lwd = 1.25
    ), silent = TRUE)
  }
  graphics::grid(col = grDevices::adjustcolor("#8FB3C9", 0.22), lwd = 0.7)
  if (!is.null(australia_boundary)) {
    try(terra::plot(australia_boundary,
      add = TRUE,
      border = grDevices::adjustcolor("#F4FFF8", 0.92),
      col = NA, lwd = 1.05
    ), silent = TRUE)
  }
  graphics::box(col = "#24465F", lwd = 1.1)
  graphics::title(main = paste0(species, " suitability"), line = 2.2, cex.main = 1.08, font.main = 2)
  region_label <- if (!is.null(projection_extent)) {
    sprintf(
      "Region: lon %.1f–%.1f, lat %.1f–%.1f; threshold %.2f",
      projection_extent[1], projection_extent[2], projection_extent[3], projection_extent[4], threshold
    )
  } else {
    sprintf("Suitability surface; reporting threshold %.2f", threshold)
  }
  graphics::mtext(region_label, side = 3, line = 0.7, adj = 0, cex = 0.72, col = "#9FB2C2")
  graphics::mtext("Satellite-inspired dark basemap styling; warmer cells indicate higher predicted suitability.",
    side = 1, line = 2.7, adj = 0, cex = 0.64, col = "#8EA2B5"
  )
  if (!is.null(occ) && add_points) {
    pts <- occ
    if (!is.null(projection_extent)) {
      pts <- pts[pts$longitude >= projection_extent[1] & pts$longitude <= projection_extent[2] &
        pts$latitude >= projection_extent[3] & pts$latitude <= projection_extent[4], , drop = FALSE]
    }
    if (nrow(pts) > 0) {
      point_cex <- if (nrow(pts) > 1500) 0.36 else if (nrow(pts) > 500) 0.46 else 0.58
      point_alpha <- if (nrow(pts) > 1500) 0.38 else 0.68
      graphics::points(pts$longitude, pts$latitude,
        pch = 21, cex = point_cex,
        bg = grDevices::adjustcolor("#E8FFF6", point_alpha),
        col = grDevices::adjustcolor("#07111D", 0.82), lwd = 0.45
      )
      graphics::legend("bottomleft",
        legend = "Observation records",
        pch = 21, pt.cex = 0.8,
        pt.bg = grDevices::adjustcolor("#E8FFF6", 0.72),
        col = "#D8E7F3", text.col = "#D8E7F3",
        bty = "n", cex = 0.74, y.intersp = 1.15
      )
    }
  }
}

plot_delta_map <- function(delta, scenario_label = "Future climate") {
  delta_plot <- plot_downsample_raster(delta)
  max_abs <- tryCatch(max(abs(terra::minmax(delta_plot)), na.rm = TRUE), error = function(e) NA_real_)
  if (!is.finite(max_abs) || max_abs <= 0) max_abs <- 1
  cols <- grDevices::colorRampPalette(c("#2C4C9C", "#9FC5E8", "#F7F7F7", "#F6B26B", "#B94E48"))(160)
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(mar = c(3.9, 4.3, 4.5, 5.5), bg = "#EEF5F8", fg = "#263238")
  terra::plot(delta_plot,
    col = cols, range = c(-max_abs, max_abs), main = "", axes = TRUE,
    colNA = "#F6F4EF", xlab = "Longitude", ylab = "Latitude", box = FALSE
  )
  graphics::grid(col = grDevices::adjustcolor("#FFFFFF", 0.42), lwd = 0.7)
  graphics::title(main = paste0(scenario_label, " suitability delta"), line = 2.2, cex.main = 1.08, font.main = 2)
  graphics::mtext("Future suitability minus current suitability; warm tones indicate increases and blue tones decreases.",
    side = 3, line = 0.7, adj = 0, cex = 0.72, col = "#4C5A5F"
  )
}

plot_occurrence_map <- function(occ, species = "Species") {
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(mar = c(4, 4, 3, 1), bg = "white")
  graphics::plot(occ$longitude, occ$latitude,
    pch = 21, cex = 0.55,
    bg = grDevices::adjustcolor("#2C7FB8", 0.55), col = "white",
    xlab = "Longitude", ylab = "Latitude", main = paste0(species, " observation records")
  )
  graphics::grid(col = "grey90")
}

save_suitability_png <- function(suitability, occ, projection_extent, species, threshold, output_png) {
  if (!is.null(projection_extent) && inherits(suitability, "SpatRaster")) {
    suitability <- terra::crop(suitability, terra::ext(projection_extent[1], projection_extent[2], projection_extent[3], projection_extent[4]))
  }
  dir.create(dirname(output_png), recursive = TRUE, showWarnings = FALSE)
  grDevices::png(output_png, width = 1600, height = 950, res = 160)
  on.exit(grDevices::dev.off(), add = TRUE)
  plot_suitability_map(suitability, occ = occ, projection_extent = projection_extent, species = species, threshold = threshold, add_points = TRUE)
  invisible(output_png)
}

save_future_pngs <- function(future, occ, projection_extent, species, threshold, scenario_label, output_dir, base_name, suffix = "") {
  if (is.null(future) || is.null(future$suitability)) {
    return(list(future_png = NULL, delta_png = NULL))
  }
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  future_png <- file.path(output_dir, paste0(base_name, "_future", suffix, "_suitability.png"))
  delta_png <- file.path(output_dir, paste0(base_name, "_future", suffix, "_delta.png"))
  suit_cropped <- future$suitability
  if (!is.null(projection_extent) && inherits(suit_cropped, "SpatRaster")) {
    suit_cropped <- terra::crop(suit_cropped, terra::ext(projection_extent[1], projection_extent[2], projection_extent[3], projection_extent[4]))
  }
  grDevices::png(future_png, width = 1600, height = 950, res = 160)
  plot_suitability_map(suit_cropped, occ = occ, projection_extent = projection_extent, species = paste0(species, " (", scenario_label, ")"), threshold = threshold, add_points = FALSE)
  grDevices::dev.off()
  grDevices::png(delta_png, width = 1600, height = 950, res = 160)
  plot_delta_map(future$delta, scenario_label = scenario_label)
  grDevices::dev.off()
  list(future_png = future_png, delta_png = delta_png)
}

plotVariableImportance <- function(importance_df) {
  if (!is.data.frame(importance_df) || nrow(importance_df) == 0) {
    return(NULL)
  }
  cols_required <- c("variable", "importance")
  if (!all(cols_required %in% names(importance_df))) {
    return(NULL)
  }
  df <- importance_df
  has_error_bars <- "sd" %in% names(df)
  if (has_error_bars) {
    df$se <- df$sd / sqrt(max(1, n_perm_default(df)))
  }
  p <- ggplot2::ggplot(df, ggplot2::aes(x = stats::reorder(variable, importance), y = importance)) +
    ggplot2::geom_bar(stat = "identity", fill = "steelblue", alpha = 0.85)
  if (has_error_bars) {
    p <- p + ggplot2::geom_errorbar(ggplot2::aes(ymin = importance - se, ymax = importance + se),
      width = 0.2, colour = "darkred"
    )
  }
  p + ggplot2::coord_flip() +
    ggplot2::labs(x = "Covariate", y = "Importance (AUC drop)", title = "Variable Importance (Permutation)") +
    ggplot2::theme_minimal(base_size = 11) +
    ggplot2::theme(
      panel.grid.minor = ggplot2::element_blank(),
      axis.text = ggplot2::element_text(colour = "#263238"),
      title = ggplot2::element_text(colour = "#1A2634", face = "bold")
    )
}

n_perm_default <- function(df) {
  if (!"sd" %in% names(df) || !("importance" %in% names(df))) {
    return(sdm_default_n_perm)
  }
  # When the manifest reports sd (permutation SD) the actual n_perm is
  # sd^2 / se^2; we approximate by the global default which the
  # upstream perm-importance code honours (sdm_default_n_perm).
  sdm_default_n_perm
}
