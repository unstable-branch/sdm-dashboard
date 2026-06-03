# Verify all three module loaders resolve every listed module.
# This catches missing files and stale module list entries.

# Use engine_load.R's resolve function (simplest, includes xai/ subdir)
source(file.path(project_root, "R", "core", "bootstrap.R"))
sdm_set_project_root(project_root)

# Define resolve function matching engine_load.R
sdm_resolve_module <- function(m) {
  mod_dir <- file.path(sdm_project_root(), "R")
  subdirs <- c("core", "data", "covariates", "models", "ecology", "ui", "modules", "xai", "output")
  for (sub in subdirs) {
    p <- file.path(mod_dir, sub, m)
    if (file.exists(p)) return(p)
  }
  p <- file.path(mod_dir, m)
  if (file.exists(p)) return(p)
  NULL
}

# Source the module lists from each loader
# We source just the module vector definitions without executing the loading loop
loaders <- list(
  load =    file.path(project_root, "R", "load.R"),
  engine =  file.path(project_root, "R", "engine_load.R"),
  compute = file.path(project_root, "R", "load_compute.R")
)

for (loader_name in names(loaders)) {
  loader_path <- loaders[[loader_name]]
  lines <- readLines(loader_path, warn = FALSE)
  # Extract modules between the first assignment to "modules <- c(" and the closing ")"
  start <- grep('^modules\\s*<-\\s*c\\(', lines)
  end <- grep('^\\)', lines)
  end <- end[end > start][1]
  if (length(start) != 1 || is.na(end)) {
    stop("Could not parse module list in ", loader_path)
  }
  module_block <- lines[(start + 1):(end - 1)]
  # Strip comments and blank lines
  module_lines <- grep('^\\s*#', module_block, value = TRUE, invert = TRUE)
  module_lines <- grep('^\\s*$', module_lines, value = TRUE, invert = TRUE)
  # Extract quoted filenames
  modules <- gsub('^\\s*"([^"]+)"\\s*,?\\s*$', '\\1', module_lines)
  modules <- modules[grepl('^[a-zA-Z0-9_.-]+\\.R$', modules)]

  for (m in modules) {
    p <- sdm_resolve_module(m)
    if (is.null(p)) {
      stop(loader_name, " loader: module not found: ", m)
    }
  }
  message(loader_name, ": ", length(modules), " modules resolved OK")
}
