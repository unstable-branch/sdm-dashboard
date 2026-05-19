# UI helper values and small rendering functions used by app.R.

biovar_choices <- sdm_biovar_choices

sanitize_extent <- function(x) {
  x <- as.numeric(x)
  ifelse(!is.finite(x), NA_real_, x)
}

extent_from_inputs <- function(input, occurrence = NULL) {
  preset <- input$extent_preset
  if (identical(preset, "occurrence")) {
    if (!is.null(occurrence) && !is.null(occurrence$df) && nrow(occurrence$df) > 0) {
      return(make_training_extent(occurrence$df, buffer = 2))
    }
    return(sdm_default_projection_extent)
  }
  if (identical(preset, "custom")) {
    return(sanitize_extent(c(input$xmin, input$xmax, input$ymin, input$ymax)))
  }
  if (identical(preset, "boundary_file")) {
    if (!is.null(input$boundary_shp) && !is.null(input$boundary_shp$datapath) && nzchar(input$boundary_shp$datapath)) {
      ext <- compute_extent_from_file(input$boundary_shp$datapath)
      if (!is.null(ext)) {
        return(ext)
      }
    }
    return(sdm_default_projection_extent)
  }
  result <- tryCatch(sdm_extent_presets[[preset]], error = function(e) NULL)
  if (is.null(result)) sdm_default_projection_extent else result
}

fmt_num <- function(x, digits = 0) {
  if (length(x) == 0 || is.null(x) || !is.finite(x)) {
    return("-")
  }
  format(round(x, digits), big.mark = ",", nsmall = digits)
}

metric_card <- function(label, value, note = NULL, note_class = NULL) {
  note_el <- if (!is.null(note)) {
    div(class = paste("metric-note", note_class), note)
  } else NULL
  div(class = "metric-card", div(class = "metric-label", label), div(class = "metric-value", value), note_el)
}

infer_species_label <- function(path) {
  if (is.null(path) || length(path) == 0 || is.na(path[1]) || !file.exists(path[1])) {
    return(NA_character_)
  }
  path <- path[1]
  quiet_log <- function(message) invisible(NULL)
  raw <- tryCatch(read_occurrence_file(path, log_fun = quiet_log), error = function(e) NULL)
  if (is.null(raw) || nrow(raw) == 0) {
    return(NA_character_)
  }
  species_col <- detect_column(names(raw), c("^(species|scientificname|taxon)$", "scientific.*name", "taxon.*name"))
  if (is.na(species_col)) {
    return(NA_character_)
  }
  values <- trimws(as.character(raw[[species_col]]))
  values <- values[!is.na(values) & nzchar(values) & values != "NA"]
  if (length(values) == 0) {
    return(NA_character_)
  }
  counts <- sort(table(values), decreasing = TRUE)
  top <- names(counts)[1]
  if (length(top) == 0 || as.numeric(counts[1]) / length(values) < 0.6) {
    return(NA_character_)
  }
  top
}

default_species_label <- function(path = sdm_default_occurrence_file) {
  inferred <- infer_species_label(path)
  if (!is.na(inferred) && nzchar(inferred)) inferred else sdm_default_species
}

clean_occurrence_preview <- function(path, min_source_records = sdm_default_min_source_records, use_cc = FALSE, cc_tests = "all") {
  quiet_log <- function(message) invisible(NULL)
  tryCatch(clean_occurrences(path, min_source_records = min_source_records, merge_small_sources = TRUE, use_cc = use_cc, cc_tests = cc_tests, log_fun = quiet_log), error = function(e) list(error = conditionMessage(e)))
}

occurrence_extent_overlap <- function(occ, extent) {
  if (is.null(occ) || nrow(occ) == 0 || length(extent) != 4 || any(!is.finite(extent))) {
    return(NULL)
  }
  inside <- occ$longitude >= extent[1] & occ$longitude <= extent[2] & occ$latitude >= extent[3] & occ$latitude <= extent[4]
  list(count = sum(inside, na.rm = TRUE), total = nrow(occ), percent = 100 * sum(inside, na.rm = TRUE) / nrow(occ))
}

placeholder_plot <- function(message) {
  old_par <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(old_par), add = TRUE)
  graphics::par(bg = "#07111D", mar = c(0, 0, 0, 0))
  graphics::plot.new()
  graphics::rect(0, 0, 1, 1, col = "#07111D", border = NA)
  graphics::rect(0.04, 0.08, 0.96, 0.92, border = grDevices::adjustcolor("#4ADECB", 0.22), lwd = 1.2)
  graphics::text(0.5, 0.56, message, cex = 1.08, col = "#D8E7F3", font = 2)
  graphics::text(0.5, 0.46, "Configure options on the left, then click Run SDM.", cex = 0.86, col = "#8EA2B5")
}

opentopo_key_is_configured <- function() nzchar(Sys.getenv("OPENTOPOGRAPHY_API_KEY", unset = ""))
