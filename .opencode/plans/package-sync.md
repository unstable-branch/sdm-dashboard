# Full Package Sync — install_packages.R, DESCRIPTION, R/core/packages.R

## install_packages.R — core_packages

### Before (32 packages):
```r
core_packages <- c(
  # UI
  "shiny", "bslib", "leaflet", "mapview", "sf", "DT",
  # Geodata / raster
  "terra", "geodata", "ncdf4",
  # SDM model backends
  "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost",
  # Model evaluation
  "biomod2", "PresenceAbsence", "pROC", "ecospat",
  "marginaleffects", "plotrix",
  # Utilities
  "httr", "jsonlite", "callr", "glue", "magrittr", "R.utils",
  "parallel", "foreach", "doParallel",
  # Occurrence handling
  "CoordinateCleaner", "rgbif", "finch",
  # Parallel / progress
  "future", "future.apply", "progressr",
  # Testing
  "testthat"
)
```

### After (32 packages — 5 added, 5 removed):
```r
core_packages <- c(
  # UI
  "shiny", "bslib", "leaflet", "mapview", "sf", "DT", "shinyjs",
  # Geodata / raster
  "terra", "geodata",
  # SDM model backends
  "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost", "ranger",
  # Model evaluation
  "biomod2", "PresenceAbsence", "pROC", "ecospat",
  "marginaleffects", "plotrix", "ggplot2",
  # Spatial analysis
  "CAST", "blockCV",
  # Utilities
  "httr", "jsonlite", "callr",
  # Occurrence handling
  "CoordinateCleaner", "rgbif", "finch",
  # Parallel
  "future", "future.apply",
  # Testing
  "testthat"
)
```

**Added:** `shinyjs`, `ranger`, `ggplot2`, `CAST`, `blockCV`
**Removed:** `ncdf4` (terra handles NetCDF), `glue` (unused), `magrittr` (unused), `R.utils` (unused), `parallel` (base R), `foreach` (unused), `doParallel` (unused), `progressr` (unused)

## DESCRIPTION — Imports

### Before:
```
Imports:
    bslib, callr, curl, DT, future, future.apply, geodata,
    ggplot2, leaflet, mgcv, sf, shiny, shinyjs, terra
```

### After (add 3 packages):
```
Imports:
    blockCV, bslib, callr, CAST, curl, DT, future, future.apply,
    geodata, ggplot2, leaflet, mgcv, ranger, sf, shiny, shinyjs, terra
```

**Added:** `blockCV`, `CAST`, `ranger`

## R/core/packages.R — sdm_app_packages

### Before:
```r
sdm_app_packages <- c(
  "shiny", "bslib", "terra",
  "biomod2", "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost",
  "httr", "jsonlite",
  "cito", "R.utils",
  "torch", "reticulate",
  "future", "future.apply", "progressr"
)
```

### After:
```r
sdm_app_packages <- c(
  "shiny", "bslib", "terra",
  "biomod2", "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam", "xgboost", "ranger",
  "httr", "jsonlite",
  "cito",
  "torch",
  "future", "future.apply",
  "ggplot2", "CAST", "blockCV"
)
```

**Added:** `ranger`, `ggplot2`, `CAST`, `blockCV`
**Removed:** `R.utils` (unused), `reticulate` (only for optional rgee), `progressr` (unused)

## R/core/packages.R — sdm_setup_packages

### Before:
```r
sdm_setup_packages <- c("shiny", "bslib", "terra", "geodata", "leaflet", "mapview", "sf", "DT", "marginaleffects", "shinyjs", "future", "future.apply")
```

### After:
```r
sdm_setup_packages <- c("shiny", "bslib", "terra", "geodata", "leaflet", "mapview", "sf", "DT", "marginaleffects", "shinyjs", "future", "future.apply", "ggplot2")
```

**Added:** `ggplot2` (used in calibration plots and ESM heatmap)
