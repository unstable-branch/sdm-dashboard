# Plotting helpers used by the Shiny app and output writer.


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
  cols <- grDevices::colorRampPalette(c(
    "#0A1624", "#123247", "#15545D", "#1F8A70", "#59C174",
    "#C6D65B", "#F3C45A", "#F28A3C", "#E34B35", "#A51E3B"
  ))(180)
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(mar = c(3.9, 4.3, 4.5, 5.5), bg = "#07111D", fg = "#D8E7F3",
                col.axis = "#B7C7D6", col.lab = "#D3E2EF", col.main = "#F2F7FB",
                cex.axis = 0.86, cex.lab = 0.92)
  terra::plot(suitability_plot, col = cols, range = c(0, 1), main = "", axes = TRUE,
              colNA = "#07111D", xlab = "Longitude", ylab = "Latitude",
              plg = list(title = "Suitability", title.cex = 0.88, cex = 0.78,
                         shrink = 0.82, mar = 3.4), box = FALSE)
  australia_boundary <- load_australia_boundary()
  if (!is.null(australia_boundary)) {
    try(terra::plot(australia_boundary, add = TRUE,
                    border = grDevices::adjustcolor("#E9F7EF", 0.86),
                    col = grDevices::adjustcolor("#0B1F2E", 0.10), lwd = 1.25), silent = TRUE)
  }
  graphics::grid(col = grDevices::adjustcolor("#8FB3C9", 0.22), lwd = 0.7)
  if (!is.null(australia_boundary)) {
    try(terra::plot(australia_boundary, add = TRUE,
                    border = grDevices::adjustcolor("#F4FFF8", 0.92),
                    col = NA, lwd = 1.05), silent = TRUE)
  }
  graphics::box(col = "#24465F", lwd = 1.1)
  graphics::title(main = paste0(species, " suitability"), line = 2.2, cex.main = 1.08, font.main = 2)
  graphics::mtext(sprintf("Australia-first suitability surface; reporting threshold %.2f", threshold),
                  side = 3, line = 0.7, adj = 0, cex = 0.72, col = "#9FB2C2")
  graphics::mtext("Satellite-inspired dark basemap styling; warmer cells indicate higher predicted suitability.",
                  side = 1, line = 2.7, adj = 0, cex = 0.64, col = "#8EA2B5")
  if (!is.null(occ) && add_points) {
    pts <- occ
    if (!is.null(projection_extent)) {
      pts <- pts[pts$longitude >= projection_extent[1] & pts$longitude <= projection_extent[2] &
                   pts$latitude >= projection_extent[3] & pts$latitude <= projection_extent[4], , drop = FALSE]
    }
    if (nrow(pts) > 0) {
      point_cex <- if (nrow(pts) > 1500) 0.36 else if (nrow(pts) > 500) 0.46 else 0.58
      point_alpha <- if (nrow(pts) > 1500) 0.38 else 0.68
      graphics::points(pts$longitude, pts$latitude, pch = 21, cex = point_cex,
                       bg = grDevices::adjustcolor("#E8FFF6", point_alpha),
                       col = grDevices::adjustcolor("#07111D", 0.82), lwd = 0.45)
      graphics::legend("bottomleft", legend = "Observation records",
                       pch = 21, pt.cex = 0.8,
                       pt.bg = grDevices::adjustcolor("#E8FFF6", 0.72),
                       col = "#D8E7F3", text.col = "#D8E7F3",
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
