# Cross-platform launcher for the SDM Shiny app.
# This is friendlier than running app.R directly because it opens the browser.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
launcher_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath("launch_app.R", winslash = "/", mustWork = FALSE)
source(file.path(dirname(launcher_path), "R", "core", "bootstrap.R"))
sdm_set_project_root(dirname(launcher_path))

if (!file.exists("app.R")) {
  stop("app.R was not found. Run this launcher from the extracted SDM project folder.")
}

source("app.R")

port <- as.integer(Sys.getenv("PORT", "3838"))
host <- Sys.getenv("HOST", "0.0.0.0")

message("Starting SDM Web Interface...")
message("If the browser does not open, go to: http://127.0.0.1:", port)

open_browser <- function(url) {
  tryCatch(utils::browseURL(url), error = function(e) {
    message("Could not open a browser automatically: ", conditionMessage(e))
    message("Open this URL manually: ", url)
  })
}

shiny::runApp(
  shiny::shinyApp(ui, server),
  host = host,
  port = port,
  launch.browser = open_browser
)
