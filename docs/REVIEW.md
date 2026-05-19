# SDM Dashboard — Code Review (2026-05-19)

**Scope:** Full review of the clean snapshot after replacing project files.
**Commit:** `c4c1849` (sync: clean snapshot from local working copy)

---

## Critical Bugs

### 1. `download_worldclim_layers` — Silent `try()` swallows writeRaster failures

**File:** `R/covariates_climate.R:128`

```r
if (!file.exists(out)) try(terra::writeRaster(wc[[idx[1]]], out, overwrite = TRUE), silent = TRUE)
```

If `writeRaster` fails (disk full, permission error, terra version incompatibility), the error is silently discarded. The function returns as if nothing happened, and `find_worldclim_files` then reports all layers as missing.

**Fix:** Log the error at minimum; fail loudly if all layers fail to write.

### 2. `load_climate_covariates` — Crashes when called with NULL extents from Get Data tab

**File:** `R/covariates_climate.R:190-191`

```r
env_train = crop_and_optionally_aggregate(env_global, training_extent, aggregation_factor),
env_project = crop_and_optionally_aggregate(env_global, projection_extent, aggregation_factor),
```

The Get Data download handler calls `load_climate_covariates(training_extent = NULL, projection_extent = NULL)`. This passes NULL into `crop_and_optionally_aggregate` → `terra::crop(r, terra::ext(NULL[1], ...))` → crash. The download succeeds (it happens before the crop), but the background process reports a failure, confusing the user.

**Fix:** Skip cropping when extents are NULL; return the global raster directly.

### 3. `verify_worldclim_cache` — Pattern matching on full paths instead of basenames

**File:** `R/verify_cache.R:27-29`

```r
all_files[grepl(pat1, all_files, ...)]
all_files[grepl(pat2, all_files, ...)]
all_files[grepl(pat3, all_files, ...)]
```

Unlike `find_worldclim_files` (which matches `basename(files)`), this matches against full file paths. If the path contains a directory name like `bio_data` or `worldclim_bio`, patterns like `_bio1` could produce false positives.

**Fix:** Apply `basename()` before pattern matching, consistent with `find_worldclim_files`.

---

## Moderate Bugs

### 4. Double-sourcing UI modules on startup

**File:** `app.R:22-26`

```r
source(engine_file)  # optimized_sdm.R → load.R → sources ALL modules including UI files
source(file.path(app_dir, "R", "ui_header.R"))          # sourced AGAIN
source(file.path(app_dir, "R", "ui_sidebar_controls.R")) # sourced AGAIN
source(file.path(app_dir, "R", "ui_main_tabs.R"))        # sourced AGAIN
```

`optimized_sdm.R` → `load.R` already sources these three UI files. `app.R` then sources them again. This doubles parsing time for these files on every startup.

**Fix:** Remove the three explicit `source()` calls in `app.R`, or remove the UI entries from `load.R`.

### 5. `download_worldclim_layers` — `geodata` layer name regex doesn't match actual names

**File:** `R/covariates_climate.R:124`

```r
idx <- grep(sprintf("bio_?%d$", bv), names(wc), ignore.case = TRUE)
```

`geodata` names layers as `bio01`, `bio02`, ..., `bio19`. The regex `bio_?1$` only matches `bio1` or `bio_1` — NOT `bio01`. The fallback `if (bv <= nlyr(wc)) idx <- bv` saves it because geodata layers ARE ordered 1-19, but this is fragile and would break if geodata ever changes layer ordering.

**Fix:** Add pattern matching for `bio01`-style names, or just rely on the positional fallback with a clear comment.

### 6. `start_download_bg` — No working directory guarantee for callr subprocess

**File:** `R/download_helper.R:5`

```r
callr::r_bg(wrapped_fun, args = as.list(args %||% list()), stdout = "|", stderr = "|")
```

The background process inherits the parent's cwd, but `.__sdm_project_root` is NOT inherited. `sdm_project_root()` falls back to `sdm_find_project_root()` which walks up from cwd. This works IF cwd is still the project root, but isn't guaranteed.

**Fix:** Pass `wd = sdm_project_root()` to `callr::r_bg()`.

---

## Minor Issues / Improvements

### 7. Missing `default_cores` in sidebar when `detect_available_cores` isn't available

**File:** `R/ui_sidebar_controls.R:5`

```r
safe_numeric <- function(x, default = 1) { ... }
```

This local helper is defined inside the UI function. It's only used twice. Consider moving it to `app_helpers.R` for reuse.

### 8. Reactive value writes outside `observeEvent` contexts

Several places in `app.R` write to `rv$` directly inside `observeEvent` handlers without `isolate()` or proper scoping. While Shiny generally handles this, the `append_log` function and batch state mutations could benefit from explicit isolation to prevent unexpected reactive chains.

### 9. `opentopo_key_is_configured` doesn't check `.Renviron`

**File:** `R/app_helpers.R:62`

```r
opentopo_key_is_configured <- function() nzchar(Sys.getenv("OPENTOPOGRAPHY_API_KEY", unset = ""))
```

This only checks the environment variable, not any `.Renviron` file that might be loaded later. If the user sets the key in a project `.Renviron` that hasn't been read yet, this returns FALSE.

### 10. Hardcoded CMIP6 GCM map in `verify_future_cache`

**File:** `R/verify_cache.R:107-111`

```r
gcm_map <- c("UKESM1-0-LL" = "UKESM1-0-LL", "MPI-ESM1-2-HR" = "MPI-ESM1-2-HR", ...)
```

This hardcoded map will miss any GCM not in the list. Consider deriving GCM names from directory structure instead.

### 11. `ui_main_tabs.R` — 642 lines of diff, needs modularization

The main tabs file is large and handles results display, downloads, and the Get Data tab UI. Consider splitting into `ui_tab_getdata.R`, `ui_tab_results.R`, etc.

### 12. No cleanup of `rv$gbif_temp_file` tempfile on session end

**File:** `app.R:186`

```r
temp_file <- tempfile(fileext = ".csv")
write.csv(occ_df, temp_file, row.names = FALSE)
rv$gbif_temp_file <- temp_file
```

The temp file is never cleaned up. Add an `onSessionEnded` callback to `unlink(rv$gbif_temp_file)`.

---

## Code Quality

### Good
- Clean modular structure with clear separation (models, covariates, UI, caching)
- Comprehensive test suite (30 test files)
- Good error messages with specific guidance
- Proper use of `req()`, `validate()`, and `tryCatch()` in Shiny modules
- `sdm_config` object pattern centralizes all parameters
- Cache verification system is thorough
- Bootstrap/project-root detection is robust

### Needs Work
- Silent `try()` in critical download path (Bug #1)
- Path resolution inconsistency between readiness check and actual run
- Some functions are doing double duty (download + process) which causes the NULL extent crash
- The `load.R` module list is very long (60+ files) — consider grouping into sub-loaders
- CSS theme file is embedded inline AND loaded as external file

---

## Recommended Priority Fixes

1. **Fix `try()` in `download_worldclim_layers`** (Bug #1) — makes debugging impossible
2. **Handle NULL extents in `load_climate_covariates`** (Bug #2) — Get Data tab crashes
3. **Fix `verify_worldclim_cache` basename matching** (Bug #3) — false cache status
4. **Pass explicit `wd` to `callr::r_bg`** (Bug #6) — robust background downloads
5. **Remove double-sourcing in `app.R`** (Bug #4) — faster startup
