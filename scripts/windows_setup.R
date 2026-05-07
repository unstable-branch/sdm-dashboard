#!/usr/bin/env Rscript
# One-time/first-run preparation used by run_app_windows.bat.

cmd_args <- commandArgs(FALSE)
file_arg <- grep("^--file=", cmd_args, value = TRUE)
setup_path <- if (length(file_arg) > 0) normalizePath(sub("^--file=", "", file_arg[1]), winslash = "/", mustWork = TRUE) else normalizePath(file.path("scripts", "windows_setup.R"), winslash = "/", mustWork = FALSE)
project_root <- dirname(dirname(setup_path))
source(file.path(project_root, "R", "bootstrap.R"))
sdm_set_project_root(project_root)

source(file.path("R", "optimized_sdm.R"))

n_cores <- normalize_core_count(NULL, reserve_one = TRUE)
cat("Preparing SDM app with ", n_cores, " worker(s).\n", sep = "")

ensure_sdm_packages(sdm_app_packages, n_cores = n_cores)

sdm_ensure_project_dirs()

missing_worldclim <- any(is.na(find_worldclim_files(sdm_default_worldclim_dir, sdm_default_biovars)))
if (missing_worldclim) {
  cat("Default WorldClim layers are missing. Attempting download now.\n")
  wc_ok <- tryCatch({
    ensure_sdm_packages("geodata", n_cores = n_cores)
    download_worldclim_layers(sdm_default_worldclim_dir, sdm_default_biovars, res = sdm_default_worldclim_res, n_cores = n_cores)
    TRUE
  }, error = function(e) {
    message("WorldClim pre-download skipped: ", conditionMessage(e))
    FALSE
  })
  if (!wc_ok) {
    cat("The app will still launch. Keep download enabled in the app and check your internet connection before running a model.\n")
  }
} else {
  cat("Default WorldClim layers are already available.\n")
}

if (!nzchar(Sys.getenv("OPENTOPOGRAPHY_API_KEY", unset = ""))) {
  cat("OpenTopography API key is not set. Elevation can still be used by entering a key in the app.\n")
}

<<<<<<< HEAD
cat("Windows setup complete. Launching the app next.\n")
=======
# Y/N prompt for PyTorch installation (works in terminal with Rscript)
ask_torch_install <- function() {
  # Check command-line argument first
  cmd_args <- commandArgs(TRUE)
  torch_arg <- grep("^--torch=", cmd_args, value = TRUE)
  
  if (length(torch_arg) > 0) {
    choice <- toupper(sub("^--torch=", "", torch_arg[1]))
    return(choice == "Y")
  }
  
  # Show message
  cat("\n=========================================================\n")
  cat("DNN models require PyTorch binaries (~500MB download).\n")
  cat("Website: https://github.com/mlverse/torch\n")
  cat("=========================================================\n\n")
  cat("Recommended: Use internet download manager for faster/reliable download.\n")
  cat("Download binaries from: https://github.com/mlverse/torch/releases\n\n")
  
  # Read from stdin - works in terminal with Rscript
  cat("Install automatically? (Y/N): ")
  
  choice <- ""
  
  # Try readline first
  tryCatch({
    input <- readline(prompt = "")
    if (!is.null(input) && nzchar(input)) {
      choice <- input
    }
  }, error = function(e) {})
  
  # If empty, try readLines
  if (!nzchar(choice)) {
    tryCatch({
      input <- readLines(file("stdin"), n = 1)
      if (length(input) > 0 && nzchar(input)) {
        choice <- input[1]
      }
    }, error = function(e) {})
  }
  
  choice <- toupper(substr(as.character(choice), 1, 1))
  
  if (choice == "Y") {
    return(TRUE)
  } else {
    cat("\nPyTorch skipped. Using other models (GLM, RF, GBM, MAXNET, etc.)\n")
    return(FALSE)
  }
}

# Simple torch package installation (R interface to PyTorch, no Conda needed)
install_torch_with_retry <- function() {
  # Check if already fully installed
  if (requireNamespace("torch", quietly = TRUE)) {
    if (torch::torch_is_installed()) {
      cat("torch fully installed.\n")
      return(TRUE)
    }
    
    # Binaries not installed - ask user first
    if (!ask_torch_install()) {
      return(FALSE)
    }
    
    # User said Y - proceed with binary installation
    cat("Installing PyTorch binaries...\n")
    tryCatch({
      torch::install_torch()
      if (torch::torch_is_installed()) {
        cat("PyTorch binaries installed successfully.\n")
        return(TRUE)
      }
    }, error = function(e) {
      cat("PyTorch binaries install error: ", conditionMessage(e), "\n", sep = "")
    })
    return(FALSE)
  }
  
  # torch package not installed - ask user
  if (!ask_torch_install()) {
    return(FALSE)
  }
  
  # User said Y - install both package and binaries
  cat("Installing torch package and PyTorch binaries (~1GB total, may take 10-15 minutes)...\n")
  start_time <- Sys.time()
  
  old_timeout <- getOption("timeout")
  options(timeout = 900)
  
  for (attempt in 1:3) {
    cat("Attempt ", attempt, " of 3...\n", sep = "")
    result <- tryCatch({
      install.packages("torch", repos = "https://cloud.r-project.org", 
                       dependencies = TRUE, quiet = FALSE)
      requireNamespace("torch", quietly = TRUE)
    }, error = function(e) {
      cat("Attempt ", attempt, " failed: ", conditionMessage(e), "\n", sep = "")
      FALSE
    })
    
    if (result) {
      cat("Downloading PyTorch C++ dependencies (~500MB)...\n")
      tryCatch({
        torch::install_torch()
      }, error = function(e) {
        cat("PyTorch binaries install error: ", conditionMessage(e), "\n", sep = "")
      })
      
      if (torch::torch_is_installed()) {
        options(timeout = old_timeout)
        elapsed <- round(difftime(Sys.time(), start_time, units = "secs"))
        if (elapsed < 60) {
          cat("torch fully installed. (took ", elapsed, " seconds)\n", sep = "")
        } else {
          mins <- floor(elapsed / 60)
          secs <- elapsed %% 60
          cat("torch fully installed. (took ", mins, " minutes ", secs, " seconds)\n", sep = "")
        }
        return(TRUE)
      }
    }
    
    if (attempt < 3) {
      cat("Waiting 5 seconds before retry...\n")
      Sys.sleep(5)
    }
  }
  
  options(timeout = old_timeout)
  cat("torch installation failed. DNN models will be disabled.\n")
  return(FALSE)
}

torch_ok <- tryCatch(install_torch_with_retry(), error = function(e) {
  cat("torch installation error: ", conditionMessage(e), "\n", sep = "")
  FALSE
})

cat("Windows setup complete. Launching the app next.\n")
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
