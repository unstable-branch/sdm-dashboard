# User-friendly web interface for the SDM project
# Run with: Rscript app.R

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
app_path <- if (length(file_arg) > 0) sub("^--file=", "", file_arg[1]) else NA_character_
if (is.na(app_path)) {
  app_ofiles <- vapply(sys.frames(), function(frame) {
    if (!is.null(frame$ofile)) frame$ofile else NA_character_
  }, character(1))
  app_ofiles <- app_ofiles[!is.na(app_ofiles) & basename(app_ofiles) == "app.R"]
  if (length(app_ofiles) > 0) app_path <- app_ofiles[length(app_ofiles)]
}
app_dir <- if (!is.na(app_path)) dirname(normalizePath(app_path, winslash = "/", mustWork = TRUE)) else getwd()
source(file.path(app_dir, "R", "bootstrap.R"))
sdm_set_project_root(app_dir)

engine_file <- file.path(app_dir, "R", "optimized_sdm.R")
if (!file.exists(engine_file)) {
  stop(
    "Could not find R/optimized_sdm.R.\n",
    "Your zip/extraction may be incomplete."
  )
}
source(engine_file)

source(file.path(app_dir, "R", "ui_header.R"))
source(file.path(app_dir, "R", "ui_sidebar_controls.R"))
source(file.path(app_dir, "R", "ui_main_tabs.R"))
default_cores <- normalize_core_count(NULL, reserve_one = TRUE)
ensure_sdm_packages(c("shiny", "bslib", "terra", "leaflet", "sf", "DT"), n_cores = default_cores)

suppressPackageStartupMessages({
  library(shiny)
  library(bslib)
  library(leaflet)
  library(sf)
})

options(shiny.maxRequestSize = 300 * 1024^2)

sdm_initial_occurrence_file <- if (file.exists(sdm_default_occurrence_file)) sdm_default_occurrence_file else if (file.exists(sdm_demo_occurrence_file)) sdm_demo_occurrence_file else NA_character_
sdm_initial_species <- default_species_label(sdm_initial_occurrence_file)
sdm_theme_css_file <- file.path(app_dir, "www", "sdm-theme.css")
sdm_theme_css <- if (file.exists(sdm_theme_css_file)) paste(readLines(sdm_theme_css_file, warn = FALSE), collapse = "\n") else ""

ui <- fluidPage(
  theme = bslib::bs_theme(version = 5, bootswatch = "flatly", primary = "#0B6E69"),
  tags$head(
    tags$link(rel = "stylesheet", href = "sdm-theme.css"),
    if (nzchar(sdm_theme_css)) tags$style(HTML(sdm_theme_css)),
    tags$script(HTML("\n      console.log('SDM Dashboard JS loaded');\n      Shiny.addCustomMessageHandler('setRunState', function(x) {\n        var btn = document.getElementById('run_model');\n        if (!btn) { console.log('setRunState: run_model btn not found'); return; }\n        console.log('setRunState called, running=', x.running);\n        btn.disabled = !!x.running;\n        btn.classList.toggle('disabled', !!x.running);\n        btn.textContent = x.running ? 'Running SDM...' : 'Run SDM';\n      });\n      (function() {\n        function setTheme(dark) {\n          document.body.classList.toggle('sdm-dark', dark);\n          document.body.classList.toggle('sdm-light', !dark);\n          try { window.localStorage.setItem('sdm-dashboard-theme', dark ? 'dark' : 'light'); } catch (e) {}\n        }\n        function initialTheme() {\n          try {\n            var saved = window.localStorage.getItem('sdm-dashboard-theme');\n            if (saved === 'dark' || saved === 'light') return saved === 'dark';\n          } catch (e) {}\n          return true;\n        }\n        function wireToggle() {\n          var toggle = document.getElementById('dark_mode');\n          var dark = initialTheme();\n          setTheme(dark);\n          if (!toggle || toggle.dataset.themeBound === '1') return;\n          toggle.checked = dark;\n          toggle.dataset.themeBound = '1';\n          toggle.addEventListener('change', function() { setTheme(toggle.checked); });\n        }\n        document.addEventListener('DOMContentLoaded', wireToggle);\n        document.addEventListener('shiny:connected', function() { console.log('Shiny connected'); wireToggle(); });\n      })();\n    "))
  ),

  ui_header(),

  sidebarLayout(
    sidebarPanel(width = 3, class = "control-panel",
      ui_sidebar_controls()
    ),

    ui_main_tabs()
  )
)

server <- function(input, output, session) {
  rv <- reactiveValues(result = NULL, log = "Ready.\n", error = NULL, running = FALSE, gbif_temp_file = NULL, gbif_doi = NULL, cleaned_occurrence = NULL,
                      batch_running = FALSE, batch_results = NULL, batch_log = character(),
                      cmip6_scenarios = NULL)

  mod_get_data_server("get_data", rv, input)

  append_log <- function(message) rv$log <- paste0(rv$log, format(Sys.time(), "%H:%M:%S"), "  ", message, "\n")
  last_auto_species <- reactiveVal(sdm_initial_species)
  species_manually_set <- reactiveVal(FALSE)
  last_progress <- reactiveVal(0)

  readiness_item <- function(title, detail, state = "info") {
    symbol <- switch(state, ok = "OK", warn = "!", error = "!", "i")
    div(class = "readiness-item", div(class = "readiness-title", span(class = paste("pill", paste0("pill-", state)), symbol), title), div(class = "readiness-detail", detail))
  }

  mod_model_run_server("model_run", rv, input, append_log, occurrence_source, last_progress)
  mod_results_server("results", rv, input)
  mod_readiness_server("readiness", rv, input, readiness_item)

  output$hero_badges <- renderUI({
    occ <- rv$cleaned_occurrence
    res <- rv$result
    running <- isTRUE(rv$running)
    badges <- list()
    if (running) {
      badges <- c(badges, list(span("Running...")))
    }
    if (!is.null(occ) && is.data.frame(occ$df)) {
      n <- nrow(occ$df)
      n_pres <- sum(occ$df$presence == 1, na.rm = TRUE)
      badges <- c(badges, list(span(paste0(n_pres, " presence / ", n, " records"))))
    } else {
      badges <- c(badges, list(span("No data loaded")))
    }
    if (!is.null(res)) {
      auc <- res$metrics$auc_mean
      model <- res$config$model_label %||% "Model"
      badges <- c(badges, list(span(paste0(model, " AUC ", fmt_num(auc, 3)))))
      if (!is.null(res$future)) {
        badges <- c(badges, list(span("Future projection")))
      }
    } else if (!running) {
      badges <- c(badges, list(span("Ready to run")))
    }
    tagList(badges)
  })

  observeEvent(input$fetch_gbif, {
    req(input$gbif_taxon)
    output$gbif_status <- renderUI(p("Fetching from GBIF..."))
    tryCatch({
      if (nzchar(input$gbif_token %||% "")) {
        result <- read_gbif_download(
          taxon = input$gbif_taxon,
          country = if (nzchar(input$gbif_country %||% "")) input$gbif_country else NULL,
          token = input$gbif_token
        )
        occ_df <- result$occurrences
        rv$gbif_doi <- result$doi
      } else {
        occ_df <- read_gbif_records(
          taxon = input$gbif_taxon,
          country = if (nzchar(input$gbif_country %||% "")) input$gbif_country else NULL,
          max_records = input$gbif_max_records,
          log_fun = append_log
        )
        rv$gbif_doi <- if (!is.null(occ_df$gbif_doi[1]) && !is.na(occ_df$gbif_doi[1])) occ_df$gbif_doi[1] else NULL
      }
      if (nrow(occ_df) == 0) {
        output$gbif_status <- renderUI(p(class = "status-error-text", "No GBIF records found for this species."))
        return()
      }
      temp_file <- tempfile(fileext = ".csv")
      write.csv(occ_df, temp_file, row.names = FALSE)
      rv$gbif_temp_file <- temp_file
      n <- nrow(occ_df)
      msg <- paste0("Loaded ", n, " records from GBIF")
      if (!is.null(rv$gbif_doi) && nzchar(rv$gbif_doi)) {
        msg <- paste0(msg, ". GBIF DOI: ", rv$gbif_doi)
      }
      output$gbif_status <- renderUI(p(msg))
      append_log(msg)
    }, error = function(e) {
      output$gbif_status <- renderUI(p(class = "status-error-text", paste0("Error: ", conditionMessage(e))))
      append_log(paste0("GBIF fetch error: ", conditionMessage(e)))
    })
  })

  observeEvent(input$data_source, {
    if (!identical(input$data_source, "gbif")) {
      rv$gbif_temp_file <- NULL
      rv$gbif_doi <- NULL
    }
  }, ignoreInit = TRUE)

  observeEvent(input$batch_cancel, {
    if (!isTRUE(rv$batch_running)) return()
    message("SDM: Batch cancelled by user")
    options(sdm_cancelled = TRUE)
    rv$batch_running <- FALSE
    rv$batch_log <- c(rv$batch_log, paste0(format(Sys.time(), "%H:%M:%S"), "  Batch cancelled by user.\n"))
  })

  output$batch_progress_ui <- renderUI({
    if (!isTRUE(input$batch_mode)) return(NULL)
    lines <- rv$batch_log
    if (length(lines) == 0) {
      div(class = "batch-log batch-log-empty", "No batch run yet.")
    } else {
      div(class = "batch-log batch-log-active",
          paste(lines, collapse = ""))
    }
  })

  observeEvent(input$batch_download_template, {
    tf <- tempfile(fileext = ".csv")
    write.csv(data.frame(
      species = c("Acacia mearnsii", "Opuntia stricta"),
      occurrences_csv = c("data/acacia.csv", "data/opuntia.csv"),
      model_id = c("glm", "glm"),
      biovars = c("1,4,6,12,15,18", "1,4,6,12,15,18"),
      use_elevation = c("FALSE", "FALSE"),
      worldclim_dir = c("Worldclim", "Worldclim"),
      cv_folds = c("3", "3"),
      stringsAsFactors = FALSE
    ), tf, row.names = FALSE)
    session$sendFileResponse(tf, basename = "batch_config_template.csv")
  })

  observeEvent(input$batch_run, {
    req(input$batch_config_file)
    if (isTRUE(rv$batch_running)) return()

    rv$batch_running <- TRUE
    rv$batch_log <- character()
    rv$batch_results <- NULL

    append_log_batch <- function(msg) {
      rv$batch_log <- c(rv$batch_log, paste0(format(Sys.time(), "%H:%M:%S"), "  ", msg, "\n"))
    }

    tryCatch({
      configs <- parse_batch_config(input$batch_config_file$datapath)
      n <- length(configs)
      append_log_batch(paste0("Batch started: ", n, " species  (cores=", input$batch_n_cores, ")"))

      rv$batch_results <- batch_run_parallel(
        species_configs = configs,
        n_cores = input$batch_n_cores,
        output_dir = file.path(sdm_default_output_dir, "batch"),
        progress_fun = function(msg) {
          append_log_batch(msg)
        },
        seed = 42L
      )

      n_ok <- sum(!sapply(rv$batch_results, is.null))
      n_err <- n - n_ok
      append_log_batch(paste0("Batch complete. Successful: ", n_ok, " / ", n))
      if (n_err > 0) append_log_batch(paste0("Errors: ", n_err, " (see *_<species>_ERROR.log in outputs/batch/)"))
    },
    error = function(e) {
      append_log_batch(paste0("ERROR: ", conditionMessage(e)))
    },
    finally = {
      rv$batch_running <- FALSE
    })
  })

  is_dwca_upload <- function() {
    req(input$occ_file)
    ext <- tools::file_ext(input$occ_file$name)
    identical(ext, "zip")
  }
  output$is_dwca <- reactive(is_dwca_upload())
  outputOptions(output, "is_dwca", suspendWhenHidden = FALSE)

  output$occ_format_detected <- renderUI({
    req(input$occ_file)
    ext <- tools::file_ext(input$occ_file$name)
    if (identical(ext, "zip")) {
      div(class = "small-muted status-positive",
        "Darwin Core Archive detected — GBIF dataset DOI will be captured automatically")
    } else {
      div(class = "small-muted", "CSV/TSV format detected")
    }
  })

  occurrence_source <- function() {
    selected <- if (is.null(input$data_source)) "project" else input$data_source
    uploaded <- !is.null(input$occ_file)
    project_exists <- file.exists(sdm_default_occurrence_file)
    demo_exists <- file.exists(sdm_demo_occurrence_file)
    gbif_path <- if (!is.null(rv$gbif_temp_file)) rv$gbif_temp_file else NULL
    if (identical(selected, "upload") && uploaded) {
      return(list(path = input$occ_file$datapath, detail = paste("Using uploaded observation records:", input$occ_file$name), state = "ok", issue = NULL))
    }
    if (identical(selected, "gbif") && !is.null(gbif_path) && file.exists(gbif_path)) {
      return(list(path = gbif_path, detail = paste("Using GBIF records for:", input$gbif_taxon), state = "ok", issue = NULL))
    }
    if (identical(selected, "project") && project_exists) {
      return(list(path = sdm_default_occurrence_file, detail = paste("Using project observation records:", sdm_default_occurrence_file), state = "ok", issue = NULL))
    }
    if (identical(selected, "demo") && demo_exists) {
      return(list(path = sdm_demo_occurrence_file, detail = paste("Using bundled synthetic demo observation records:", sdm_demo_occurrence_file), state = "ok", issue = NULL))
    }
    if (project_exists) {
      return(list(path = sdm_default_occurrence_file, detail = paste("Selected observation source unavailable; falling back to project file:", sdm_default_occurrence_file), state = "warn", issue = NULL))
    }
    if (demo_exists) {
      return(list(path = sdm_demo_occurrence_file, detail = paste("Selected observation source unavailable; falling back to bundled synthetic demo records:", sdm_demo_occurrence_file), state = "warn", issue = NULL))
    }
    list(path = NULL, detail = "No observation record file is available yet.", state = "error", issue = paste("Upload a CSV/TSV, add", sdm_default_occurrence_file, "to the project folder, or restore the demo dataset."))
  }

  observeEvent(input$species, {
    value <- trimws(input$species %||% "")
    if (!identical(value, last_auto_species()) && nzchar(value)) species_manually_set(TRUE)
    if (!nzchar(value)) species_manually_set(FALSE)
  }, ignoreInit = TRUE)

  observe({
    occurrence <- occurrence_source()
    inferred <- infer_species_label(occurrence$path)
    next_label <- if (!is.na(inferred) && nzchar(inferred)) inferred else sdm_default_species
    if (!isTRUE(species_manually_set()) || !nzchar(trimws(input$species %||% ""))) {
      last_auto_species(next_label)
      updateTextInput(session, "species", value = next_label)
    }
  })



  cc_last_run <- reactiveVal(NULL)

  observeEvent(input$run_cc, {
    occurrence <- occurrence_source()
    current_path <- occurrence$path
    req(current_path)

    cc_tests <- input$cc_tests %||% "all"
    cleaned <- clean_occurrence_preview(occurrence$path, min_source_records = input$min_source_records, use_cc = TRUE, cc_tests = cc_tests)
    if (!is.null(cleaned$error)) {
      rv$cleaned_occurrence <- NULL
      output$cc_stats_log <- renderText(paste("Cleaning failed:", cleaned$error))
      output$source_table <- renderTable({
        data.frame(Message = paste("Error:", cleaned$error))
      }, striped = FALSE, hover = FALSE)
      return()
    }
    if (!"cc_flag" %in% names(cleaned$occ)) {
      cleaned$occ$cc_flag <- FALSE
    }
    rv$cleaned_occurrence <- list(
      df = cleaned$occ,
      source_counts = cleaned$source_counts,
      n_absent_excluded = cleaned$n_absent_excluded,
      original_rows = cleaned$original_rows
    )
    cc_last_run(format(Sys.time(), "%H:%M:%S"))
  }, ignoreInit = TRUE)

  output$cc_run_status <- renderUI({
    last_run <- cc_last_run()
    if (is.null(last_run)) {
      div(class = "small-muted", "Click to run advanced cleaning on occurrence data.")
    } else {
      div(class = "small-muted status-positive", paste("Last run:", last_run))
    }
  })
  outputOptions(output, "cc_run_status", suspendWhenHidden = FALSE)

  output$occurrence_source_status <- renderUI({
    occurrence <- occurrence_source()
    div(class = paste("status", occurrence$state, sep = "-"), role = "status", `aria-live` = "polite", occurrence$detail)
  })



  output$esm_recommendation <- renderUI({
    req(rv$cleaned_occurrence)
    n_pres <- sum(rv$cleaned_occurrence$df$presence == 1, na.rm = TRUE)
    esm_available <- "esm_glm" %in% sdm_model_ids()

    if (n_pres < 10 && esm_available) {
      div(class = "alert alert-danger",
          icon("exclamation-triangle"),
          strong(sprintf(" Very few records: %d presence", n_pres)),
          " — ESM is recommended but results should be treated with caution.")
    } else if (n_pres < 30 && esm_available) {
      div(class = "alert alert-info",
          icon("info-circle"),
          strong(" Rare species detected"),
          sprintf(" — %d presence records. ESM recommended.", n_pres),
          actionButton("switch_to_esm", "Switch to ESM", class = "btn-info btn-sm"))
    } else if (n_pres < 30 && !esm_available) {
      div(class = "alert alert-warning",
          icon("package"),
          strong(" Low record count"),
          sprintf(" — only %d presence records. ", n_pres),
          "Install ecospat to enable ESM (recommended): ",
          tags$code("install.packages('ecospat')"))
    }
  })

  observeEvent(input$switch_to_esm, {
    updateSelectInput(session, "model_id", selected = "esm_glm")
  })





  output$source_table <- renderTable({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df) || is.null(co$source_counts)) {
      return(data.frame(Message = "Load occurrence data to view source counts."))
    }
    sc <- co$source_counts
    head(data.frame(Source = names(sc), Records = as.integer(sc), row.names = NULL), 25)
  }, striped = TRUE, hover = TRUE, spacing = "s")

  output$absent_excluded_log <- renderText({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df)) return("")
    n_absent <- co$n_absent_excluded %||% 0L
    n_raw <- co$original_rows %||% NA_integer_
    if (n_absent == 0L) return("")
    sprintf("ABSENT records excluded from analysis: %s of %s total",
            format(n_absent, big.mark = ","), format(n_raw, big.mark = ","))
  })

  output$occurrence_cleaning_map <- renderLeaflet({
    req(rv$cleaned_occurrence)
    leaflet::leaflet() %>% leaflet::addTiles()
  })

  observeEvent(rv$cleaned_occurrence$df, {
    req(input$occurrence_cleaning_map)
    occ <- rv$cleaned_occurrence$df
    if (!is.data.frame(occ) || nrow(occ) < 1) {
      leaflet::leafletProxy("occurrence_cleaning_map") %>%
        leaflet::clearMarkers() %>%
        leaflet::removeLayersControl()
      return()
    }

    clean_idx <- is.na(occ$cc_flag) | occ$cc_flag == FALSE
    flagged_idx <- !clean_idx

    flag_status <- ifelse(clean_idx,
      '<span style="color:#2196F3;font-weight:bold;">Clean</span>',
      '<span style="color:#f44336;font-weight:bold;">Flagged</span>')
    species_col <- if ("species" %in% names(occ)) occ$species else "N/A"
    popups <- paste0("Row ", seq_len(nrow(occ)), "<br>",
                      "Species: ", species_col, "<br>",
                      "Source: ", occ$source, "<br>",
                      "Status: ", flag_status)

    proxy <- leaflet::leafletProxy("occurrence_cleaning_map") %>%
      leaflet::clearMarkers() %>%
      leaflet::removeLayersControl()

    if (any(clean_idx)) {
      proxy <- proxy %>%
        leaflet::addCircleMarkers(
          data = occ[clean_idx, , drop = FALSE],
          lng = ~longitude, lat = ~latitude,
          color = "blue", fillOpacity = 0.7, radius = 5,
          layerId = which(clean_idx),
          popup = popups[clean_idx],
          group = "Clean records"
        )
    }

    if (any(flagged_idx)) {
      proxy <- proxy %>%
        leaflet::addCircleMarkers(
          data = occ[flagged_idx, , drop = FALSE],
          lng = ~longitude, lat = ~latitude,
          color = "red", fillOpacity = 0.7, radius = 5,
          layerId = which(flagged_idx),
          popup = popups[flagged_idx],
          group = "Flagged records"
        )
    }

    proxy %>%
      leaflet::addLayersControl(
        overlayGroups = c("Clean records", "Flagged records"),
        options = leaflet::layersControlOptions(collapsed = TRUE)
      )
  }, ignoreInit = TRUE)

  observeEvent(input$occurrence_cleaning_map_marker_click, {
    req(rv$cleaned_occurrence)

    click <- input$occurrence_cleaning_map_marker_click
    row_idx <- as.integer(click$id)

    if (is.na(row_idx) || row_idx < 1 || row_idx > nrow(rv$cleaned_occurrence$df)) {
      return()
    }
    current_flag <- rv$cleaned_occurrence$df$cc_flag[row_idx]
    rv$cleaned_occurrence$df$cc_flag[row_idx] <- !current_flag
    rv$cleaned_occurrence$df <- rv$cleaned_occurrence$df
  })

  observeEvent(input$remove_flagged_map, {
    req(rv$cleaned_occurrence)

    keep <- is.na(rv$cleaned_occurrence$df$cc_flag) | rv$cleaned_occurrence$df$cc_flag == FALSE
    new_df <- rv$cleaned_occurrence$df[keep, , drop = FALSE]

    rv$cleaned_occurrence <- list(
      df = new_df,
      source_counts = rv$cleaned_occurrence$source_counts,
      n_absent_excluded = rv$cleaned_occurrence$n_absent_excluded,
      original_rows = rv$cleaned_occurrence$original_rows
    )
  })

  observeEvent(input$clear_flags, {
    req(rv$cleaned_occurrence)

    rv$cleaned_occurrence$df$cc_flag <- FALSE
    rv$cleaned_occurrence$df <- rv$cleaned_occurrence$df
  })

  output$flagged_count <- renderUI({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df) || !"cc_flag" %in% names(co$df)) return(NULL)
    n_flagged <- sum(co$df$cc_flag, na.rm = TRUE)
    if (n_flagged == 0) return(NULL)
    span(class = "flagged-count-badge flagged-count-badge-warn", paste0(n_flagged, " flagged"))
  })

  output$cc_stats_log <- renderText({
    co <- rv$cleaned_occurrence
    if (is.null(co) || !is.data.frame(co$df) || is.null(co$df$cc_flag)) {
      return("Advanced cleaning not enabled or CoordinateCleaner not available.")
    }
    n_total <- nrow(co$df)
    n_flagged <- sum(co$df$cc_flag, na.rm = TRUE)
    pct <- if (n_total > 0) paste0(" (", round(100 * n_flagged / n_total, 1), "%)") else ""

    lines <- c(
      "CoordinateCleaner Results:",
      paste0("  Total records: ", format(n_total, big.mark = ",")),
      paste0("  Flagged: ", format(n_flagged, big.mark = ","), pct),
      "  By test:"
    )

    test_names <- c(
      cc_test_sea = "Sea coordinates",
      cc_test_capitals = "Capital cities",
      cc_test_centroids = "Country centroids",
      cc_test_institutions = "Biodiversity institutions",
      cc_test_urban = "Urban areas",
      cc_test_zero = "Zero coordinates"
    )

    for (nm in names(test_names)) {
      if (nm %in% names(co$df)) {
        n <- sum(co$df[[nm]], na.rm = TRUE)
        lines <- c(lines, paste0("    ", test_names[nm], ": ", format(n, big.mark = ",")))
      }
    }

    paste(lines, collapse = "\n")
  })
}

if (!interactive()) {
  port <- as.integer(Sys.getenv("PORT", "3838"))

  wsl_ip <- NULL
  if (file.exists("/proc/version") && grepl("microsoft|WSL", readLines("/proc/version", warn = FALSE)[1], ignore.case = TRUE)) {
    wsl_ip <- tryCatch({
      con <- pipe("hostname -I 2>/dev/null", open = "r")
      ip_out <- readLines(con, warn = FALSE)
      close(con)
      if (length(ip_out) > 0) {
        parts <- strsplit(trimws(ip_out[1]), " ")[[1]]
        parts[nzchar(parts)][1]
      } else NULL
    }, error = function(e) NULL)
  }

  message("")
  message("========================================")
  message("SDM Dashboard is running!")
  message("========================================")
  message("")
  message(paste0("Local WSL access: http://localhost:", port))
  if (!is.null(wsl_ip) && nzchar(wsl_ip)) {
    message(paste0("Windows browser access: http://", wsl_ip, ":", port))
  } else {
    message("Windows browser: Use WSL IP address on port ", port)
  }
  message("========================================")
  message("")

  shiny::runApp(shiny::shinyApp(ui, server), host = "0.0.0.0", port = port)
}
