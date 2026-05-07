# Smoke-test every projection-extent preset.
#
# Run from the project root:  Rscript scripts/test_extents.R
#
# It mocks Shiny's `input` object and calls extent_from_inputs() for every
# choice in sdm_extent_choices. Each row prints PASS/FAIL plus the resolved
# extent. A preset passes when the result is c(xmin, xmax, ymin, ymax) with
# all four values finite, xmin < xmax, and ymin < ymax.

source("R/bootstrap.R")
sdm_set_project_root(getwd())
source("R/load.R")

# Mock occurrence frame (bbox = a small region around Sydney) so the
# `occurrence` preset has something to work with.
mock_occ <- data.frame(
  longitude = c(150.5, 151.0, 151.3, 152.0),
  latitude  = c(-34.0, -33.8, -33.5, -33.0)
)
mock_cleaned <- list(occ = mock_occ)

# Picks the first available demo boundary file for the boundary_file preset.
demo_boundary <- config$sdm_australia_boundary_path
if (!file.exists(demo_boundary)) demo_boundary <- config$sdm_world_boundary_path

# Mock `input`. Shiny inputs are accessed with $; a list works for the test.
make_input <- function(preset, ...) {
  defaults <- list(
    extent_preset  = preset,
    xmin = sdm_default_projection_extent[1],
    xmax = sdm_default_projection_extent[2],
    ymin = sdm_default_projection_extent[3],
    ymax = sdm_default_projection_extent[4],
    boundary_file  = NULL
  )
  modifyList(defaults, list(...))
}

valid_extent <- function(e) {
  is.numeric(e) && length(e) == 4 && all(is.finite(e)) &&
    e[1] < e[2] && e[3] < e[4]
}

run_case <- function(label, preset, input_overrides = list(), occurrence = NULL) {
  input <- do.call(make_input, c(list(preset = preset), input_overrides))
  result <- tryCatch(
    extent_from_inputs(input, occurrence),
    error = function(e) structure(list(error = conditionMessage(e)), class = "ext_error")
  )
  if (inherits(result, "ext_error")) {
    cat(sprintf("FAIL  %-30s ERROR: %s\n", label, result$error))
    return(invisible(FALSE))
  }
  ok <- valid_extent(result)
  cat(sprintf("%-5s %-30s extent = c(%s)\n",
              if (ok) "PASS" else "FAIL",
              label,
              paste(format(result, nsmall = 0), collapse = ", ")))
  invisible(ok)
}

cat("--- Projection extent preset coverage ---\n")
cat("sdm_extent_choices keys: ", paste(unname(sdm_extent_choices), collapse = ", "), "\n")
cat("sdm_default_projection_extent: c(",
    paste(sdm_default_projection_extent, collapse = ", "), ")\n\n", sep = "")

results <- c(
  run_case("occurrence (with data)",   "occurrence", occurrence = mock_cleaned),
  run_case("occurrence (no data)",     "occurrence", occurrence = NULL),
  run_case("world",                    "world"),
  run_case("aus_full",                 "aus_full"),
  run_case("aus_north",                "aus_north"),
  run_case("aus_east",                 "aus_east"),
  run_case("custom (defaults)",        "custom"),
  run_case("custom (user values)",     "custom",
           input_overrides = list(xmin = 140, xmax = 150, ymin = -40, ymax = -30)),
  if (file.exists(demo_boundary)) {
    run_case("boundary_file (real)",   "boundary_file",
             input_overrides = list(boundary_file = list(datapath = demo_boundary,
                                                         name = basename(demo_boundary))))
  } else {
    cat("SKIP  boundary_file (real)            no demo boundary file on disk\n")
    TRUE
  },
  run_case("boundary_file (no file)",  "boundary_file"),
  run_case("unknown preset",           "atlantis")
)

cat(sprintf("\n%d/%d cases PASS\n", sum(results), length(results)))
if (!all(results)) {
  quit(status = 1)
}
