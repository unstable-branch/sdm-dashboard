# Look for project root by checking for app.R in parent directories
find_sdm_root <- function() {
  candidates <- c(
    ".",
    "..",
    file.path("..", ".."),
    file.path("..", "..", ".."),
    file.path("..", "..", "..", "..")
  )
  for (c in candidates) {
    candidate <- normalizePath(c, winslash = "/", mustWork = FALSE)
    if (file.exists(file.path(candidate, "app.R"))) {
      return(candidate)
    }
  }
  stop("Could not find SDM project root")
}
project_root <- find_sdm_root()
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)
source(file.path(project_root, "R", "core", "optimized_sdm.R"))