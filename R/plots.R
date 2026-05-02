# Plotting helpers used by the Shiny app and output writer.

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
  cols <- grDevices::colorRampPalette(c(
    "#F7FBFF", "#DDECF3", "#B7D7E8", "#7FC6D4", "#49B6B1",
    "#4FA66D", "#9FC65A", "#F1D46B", "#F2A65A", "#D85C43", "#8F2D38"
  ))(160)
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(mar = c(3.9, 4.3, 4.5, 5.5), bg = "#EEF5F8", fg = "#263238")
  terra::plot(suitability_plot, col = cols, range = c(0, 1), main = "", axes = TRUE,
              colNA = "#F6F4EF", xlab = "Longitude", ylab = "Latitude", box = FALSE)
  graphics::grid(col = grDevices::adjustcolor("#FFFFFF", 0.42), lwd = 0.7)
  graphics::title(main = paste0(species, " suitability"), line = 2.2, cex.main = 1.08, font.main = 2)
  graphics::mtext(sprintf("Predicted suitability (0-1); reporting threshold %.2f", threshold),
                  side = 3, line = 0.7, adj = 0, cex = 0.72, col = "#4C5A5F")
  graphics::mtext("Low values are shown with pale cool tones; higher suitability trends to warm tones.",
                  side = 1, line = 2.7, adj = 0, cex = 0.64, col = "#5C666A")
  if (!is.null(occ) && add_points) {
    pts <- occ
    if (!is.null(projection_extent)) {
      pts <- pts[pts$longitude >= projection_extent[1] & pts$longitude <= projection_extent[2] &
                   pts$latitude >= projection_extent[3] & pts$latitude <= projection_extent[4], , drop = FALSE]
    }
    if (nrow(pts) > 0) {
      point_cex <- if (nrow(pts) > 1500) 0.42 else if (nrow(pts) > 500) 0.52 else 0.62
      point_alpha <- if (nrow(pts) > 1500) 0.42 else 0.62
      graphics::points(pts$longitude, pts$latitude, pch = 21, cex = point_cex,
                       bg = grDevices::adjustcolor("#FFF7E6", point_alpha),
                       col = grDevices::adjustcolor("#263238", 0.72), lwd = 0.45)
      graphics::legend("bottomleft", legend = "Observation records",
                       pch = 21, pt.cex = 0.8,
                       pt.bg = grDevices::adjustcolor("#FFF7E6", 0.72),
                       col = "#263238",
                       bty = "n", cex = 0.74, y.intersp = 1.15)
    }
  }
}

plot_delta_map <- function(delta, scenario_label = "Future climate") {
  delta_plot <- plot_downsample_raster(delta)
  max_abs <- tryCatch(max(abs(terra::values(delta_plot)), na.rm = TRUE), error = function(e) NA_real_)
  if (!is.finite(max_abs) || max_abs <= 0) max_abs <- 1
  cols <- grDevices::colorRampPalette(c("#2C4C9C", "#9FC5E8", "#F7F7F7", "#F6B26B", "#B94E48"))(160)
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(mar = c(3.9, 4.3, 4.5, 5.5), bg = "#EEF5F8", fg = "#263238")
  terra::plot(delta_plot, col = cols, range = c(-max_abs, max_abs), main = "", axes = TRUE,
              colNA = "#F6F4EF", xlab = "Longitude", ylab = "Latitude", box = FALSE)
  graphics::grid(col = grDevices::adjustcolor("#FFFFFF", 0.42), lwd = 0.7)
  graphics::title(main = paste0(scenario_label, " suitability delta"), line = 2.2, cex.main = 1.08, font.main = 2)
  graphics::mtext("Future suitability minus current suitability; warm tones indicate increases and blue tones decreases.",
                  side = 3, line = 0.7, adj = 0, cex = 0.72, col = "#4C5A5F")
}

plot_occurrence_map <- function(occ, species = "Species") {
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(mar = c(4, 4, 3, 1), bg = "white")
  graphics::plot(occ$longitude, occ$latitude, pch = 21, cex = 0.55,
                 bg = grDevices::adjustcolor("#2C7FB8", 0.55), col = "white",
                 xlab = "Longitude", ylab = "Latitude", main = paste0(species, " observation records"))
  graphics::grid(col = "grey90")
}

save_suitability_png <- function(suitability, occ, projection_extent, species, threshold, output_png) {
  dir.create(dirname(output_png), recursive = TRUE, showWarnings = FALSE)
  grDevices::png(output_png, width = 1600, height = 950, res = 160)
  on.exit(grDevices::dev.off(), add = TRUE)
  plot_suitability_map(suitability, occ = occ, projection_extent = projection_extent, species = species, threshold = threshold, add_points = TRUE)
  invisible(output_png)
}
