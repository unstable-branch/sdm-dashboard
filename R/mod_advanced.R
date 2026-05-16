mod_advanced_server <- function(id, rv, input) {
  moduleServer(id, function(input, output, session) {

    observeEvent(input$open_advanced_modal, {
      showModal(modalDialog(
        title = "Advanced Settings",
        size = "l",
        easyClose = FALSE,
        footer = tagList(
          actionButton("apply_advanced", "Apply", class = "btn-primary"),
          modalButton("Cancel")
        ),
        tags$div(class = "advanced-modal-body",
          h4("Cross-validation"),
          selectInput("cv_strategy_modal", "CV strategy",
            choices = c("Random" = "random", "Spatial blocks" = "spatial_blocks"),
            selected = input$cv_strategy %||% sdm_default_cv_strategy),
          conditionalPanel("input.cv_strategy_modal == 'spatial_blocks'",
            numericInput("cv_block_size_km_modal", "Spatial block size (km)",
              value = input$cv_block_size_km %||% if (is.na(sdm_default_cv_block_size_km)) 50 else sdm_default_cv_block_size_km,
              min = 1, max = 500, step = 1),
            div(class = "small-muted", "Auto-estimated if left at default.")
          ),
          hr(),
          h4("Bias correction"),
          selectInput("bias_method_modal", "Background sampling bias correction",
            choices = c("Uniform random" = "uniform", "Target-group" = "target_group", "Thickened" = "thickened"),
            selected = input$bias_method %||% "uniform"),
          conditionalPanel("input.bias_method_modal == 'target_group'",
            fileInput("target_group_file_modal", "Upload related species occurrences (CSV)",
              accept = c(".csv")),
            div(class = "small-muted", "One record per row with longitude and latitude columns.")
          ),
          conditionalPanel("input.bias_method_modal == 'thickened'",
            numericInput("thickening_distance_km_modal", "Kernel distance (km)",
              value = input$thickening_distance_km %||% 10, min = 1, max = 100)
          ),
          hr(),
          h4("CoordinateCleaner (Advanced Cleaning)"),
          selectInput("cc_tests_modal", "CC tests to run",
            choices = c("All tests" = "all", "Sea only" = "sea", "Capitals only" = "capitals",
                        "Institutions only" = "institutions", "Centroids only" = "centroids",
                        "Urban only" = "urban", "Zero only" = "zero"),
            selected = input$cc_tests %||% "all"),
          hr(),
          h4("Data merging"),
          checkboxInput("merge_small_sources_modal", "Merge small occurrence sources", value = input$merge_small_sources %||% TRUE),
          checkboxInput("vif_reduction_modal", "Drop collinear covariates (VIF > 10)", value = input$vif_reduction %||% FALSE)
        )
      ))
    })

    observeEvent(input$apply_advanced, {
      removeModal()
      updateSelectInput(session, "cv_strategy", selected = input$cv_strategy_modal)
      if (identical(input$cv_strategy_modal, "spatial_blocks") && !is.null(input$cv_block_size_km_modal)) {
        updateNumericInput(session, "cv_block_size_km", value = input$cv_block_size_km_modal)
      }
      updateSelectInput(session, "bias_method", selected = input$bias_method_modal)
      if (!is.null(input$thickening_distance_km_modal)) {
        updateNumericInput(session, "thickening_distance_km", value = input$thickening_distance_km_modal)
      }
      if (!is.null(input$target_group_file_modal) && isTRUE(input$bias_method_modal == "target_group")) {
        safe_name <- make.names(basename(input$target_group_file_modal$name), unique = TRUE)
        shiny::file.copy(input$target_group_file_modal$datapath,
                        file.path(tempdir(), safe_name), overwrite = TRUE)
      }
      updateSelectInput(session, "cc_tests", selected = input$cc_tests_modal)
      updateCheckboxInput(session, "merge_small_sources", value = isTRUE(input$merge_small_sources_modal))
      updateCheckboxInput(session, "vif_reduction", value = isTRUE(input$vif_reduction_modal))
    })

  })
}