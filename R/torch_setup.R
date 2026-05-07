# Torch Setup: Auto-detect GPU and install correct torch version
# This module handles GPU detection, CUDA version matching, and torch installation
# with caching for Species Distribution Modeling

#' Torch cache directory
#' @export
get_torch_cache_dir <- function() {
  cache_dir <- file.path(getwd(), "torch_cache")
  if (!dir.exists(cache_dir)) {
    dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)
  }
  cache_dir
}

#' GPU architecture mapping table
#' Maps NVIDIA GPU architecture to CUDA version and torch kind
gpu_architecture_map <- list(
  # Turing architecture (sm_75) - MX450, GTX 16xx, RTX 20xx
  list(gpu_pattern = "MX450|GTX 16[0-9]|RTX 20[0-9]", arch = "turing", sm = "75", cuda_best = "12.6", cuda_fallback = c("12.6", "12.8"), torch_kind = "cu126"),
  # Turing alternative names
  list(gpu_pattern = "Turing", arch = "turing", sm = "75", cuda_best = "12.6", cuda_fallback = c("12.6", "12.8"), torch_kind = "cu126"),
  # Ampere architecture (sm_80, sm_86) - RTX 30xx
  list(gpu_pattern = "RTX 30[0-9]", arch = "ampere", sm = "80", cuda_best = "12.8", cuda_fallback = c("12.8"), torch_kind = "cu128"),
  list(gpu_pattern = "RTX 30[0-9]", arch = "ampere", sm = "86", cuda_best = "12.8", cuda_fallback = c("12.8"), torch_kind = "cu128"),
  # Ada architecture (sm_89) - RTX 40xx
  list(gpu_pattern = "RTX 40[0-9]|RTX 45[0-9]", arch = "ada", sm = "89", cuda_best = "12.8", cuda_fallback = c("12.8"), torch_kind = "cu128"),
  # Hopper architecture (sm_90) - H100
  list(gpu_pattern = "H100", arch = "hopper", sm = "90", cuda_best = "12.8", cuda_fallback = c("12.8", "13.0"), torch_kind = "cu128"),
  # Blackwell architecture (sm_100+) - B100, B200
  list(gpu_pattern = "B100|B200|Blackwell", arch = "blackwell", sm = "100", cuda_best = "13.0", cuda_fallback = c("13.0", "12.8"), torch_kind = "cu130"),
  # Intel integrated graphics (not supported)
  list(gpu_pattern = "Intel|UHD|Iris", arch = "intel", sm = NA, cuda_best = NA, cuda_fallback = NA, torch_kind = "cpu")
)

#' Detect GPU using nvidia-smi
#' @return List with gpu_name, cuda_version, or NULL if no NVIDIA GPU
#' @export
detect_nvidia_gpu <- function() {
  if (.Platform$OS.type != "windows") {
    return(NULL)
  }

  result <- list(
    gpu_name = NULL,
    cuda_driver = NULL,
    driver_version = NULL
  )

  tryCatch({
    # Try nvidia-smi to get GPU info
    output <- system("nvidia-smi --query-gpu=name,driver_version,compute_version --format=csv,noheader", intern = TRUE, ignore.stderr = TRUE)

    if (length(output) > 0 && nzchar(output)) {
      parts <- strsplit(trimws(output[1]), ",")[[1]]
      if (length(parts) >= 3) {
        result$gpu_name <- trimws(parts[1])
        result$driver_version <- trimws(parts[2])
        result$cuda_driver <- trimws(parts[3])
      }
    }
  }, error = function(e) {
    # nvidia-smi failed or not available
  })

  # If no result from nvidia-smi, try alternative methods
  if (is.null(result$gpu_name)) {
    tryCatch({
      # Alternative: use WMI
      output <- system('wmic path win32_VideoController get name /format:list', intern = TRUE, ignore.stderr = TRUE)
      nvidia_line <- grep("NVIDIA", output, value = TRUE, ignore.case = TRUE)
      if (length(nvidia_line) > 0) {
        result$gpu_name <- gsub(".*=", "", nvidia_line[1])
      }
    }, error = function(e) NULL)
  }

  if (is.null(result$gpu_name) || !nzchar(result$gpu_name)) {
    return(NULL)
  }

  result
}

#' Map GPU to architecture info
#' @param gpu_name Character string of GPU name
#' @return List with arch, sm, cuda_best, cuda_fallback, torch_kind
#' @export
map_gpu_to_architecture <- function(gpu_name) {
  if (is.null(gpu_name)) {
    return(NULL)
  }

  for (mapping in gpu_architecture_map) {
    if (grepl(mapping$gpu_pattern, gpu_name, ignore.case = TRUE)) {
      return(mapping)
    }
  }

  # Unknown GPU - default to CPU
  NULL
}

#' Check if torch is already installed with GPU support
#' @param torch_kind Expected torch kind ("cu126", "cu128", "cpu")
#' @return TRUE if installed torch matches expected kind
#' @export
check_torch_installation <- function(torch_kind = "cpu") {
  if (!requireNamespace("torch", quietly = TRUE)) {
    return(FALSE)
  }

  if (!torch::torch_is_installed()) {
    return(FALSE)
  }

  # Check if LibTorch supports GPU
  has_gpu <- tryCatch({
    torch::cuda_is_available()
  }, error = function(e) FALSE)

  if (torch_kind == "cpu") {
    return(TRUE)
  }

  # For GPU kinds, check if CUDA is available
  has_gpu
}

#' Get cached torch binary path
#' @param torch_kind The torch kind ("cu126", "cu128", "cpu")
#' @return Path to cached binary or NULL
#' @export
get_cached_torch_binary <- function(torch_kind) {
  cache_dir <- get_torch_cache_dir()

  # Look for matching cached file
  pattern <- paste0("torch-.*", torch_kind, ".*\\.zip$")
  files <- list.files(cache_dir, pattern = pattern, full.names = TRUE)

  if (length(files) > 0) {
    # Return most recent
    files[order(file.info(files)$mtime, decreasing = TRUE)[1]]
  } else {
    NULL
  }
}

#' Save torch binary to cache
#' @param url Download URL
#' @param torch_kind The torch kind
#' @return Path to cached file
cache_torch_binary <- function(url, torch_kind) {
  cache_dir <- get_torch_cache_dir()

  # Generate filename
  version <- packageVersion("torch")
  filename <- paste0("torch-", torch_kind, "-v", version, ".zip")
  destfile <- file.path(cache_dir, filename)

  tryCatch({
    options(timeout = 600)
    download.file(url = url, destfile = destfile, mode = "wb", quiet = TRUE)
    destfile
  }, error = function(e) {
    NULL
  })
}

#' Check for cached torch and extract/use it
#' @param torch_kind The torch kind needed
#' @return TRUE if successfully set up, FALSE otherwise
use_cached_torch <- function(torch_kind) {
  cached_file <- get_cached_torch_binary(torch_kind)

  if (!is.null(cached_file) && file.exists(cached_file)) {
    message("Using cached torch binary: ", basename(cached_file))
    return(TRUE)
  }

  FALSE
}

#' Recommend torch installation kind
#' @param gpu_info Output from detect_nvidia_gpu()
#' @return List with recommended torch_kind, message, and alternatives
#' @export
recommend_torch_kind <- function(gpu_info) {
  result <- list(
    torch_kind = "cpu",
    cuda_version = NA,
    message = "No GPU detected - using CPU",
    arch_info = NULL,
    alternatives = c("cpu")
  )

  if (is.null(gpu_info)) {
    result$message <- "No NVIDIA GPU detected - using CPU"
    return(result)
  }

  # Map GPU to architecture
  arch_info <- map_gpu_to_architecture(gpu_info$gpu_name)

  if (is.null(arch_info)) {
    result$message <- paste("Unknown GPU:", gpu_info$gpu_name, "- using CPU")
    return(result)
  }

  # Build result
  result$torch_kind <- arch_info$torch_kind
  result$cuda_version <- gpu_info$cuda_driver
  result$arch_info <- arch_info
  result$message <- paste(
    "GPU detected:", gpu_info$gpu_name,
    "| Architecture:", toupper(arch_info$arch),
    "| CUDA:", gpu_info$cuda_driver,
    "| Recommended torch:",
    toupper(arch_info$torch_kind)
  )
  result$alternatives <- c(arch_info$torch_kind, "cpu")

  result
}

#' Test if GPU actually works after installation
#' @return TRUE if GPU test passes, FALSE otherwise
#' @export
test_gpu_working <- function() {
  if (!requireNamespace("torch", quietly = TRUE)) {
    return(FALSE)
  }

  if (!torch::torch_is_installed()) {
    return(FALSE)
  }

  tryCatch({
    # Simple tensor test on GPU
    has_cuda <- torch::cuda_is_available()

    if (!has_cuda) {
      return(FALSE)
    }

    # Create tensor and move to GPU
    t <- torch::torch_tensor(c(1, 2, 3), device = "cuda")

    # Simple operation
    result <- sum(t)

    # Cleanup
    rm(t, result)
    gc()

    TRUE
  }, error = function(e) {
    message("GPU test failed: ", conditionMessage(e))
    FALSE
  })
}

#' Main setup function - runs at startup
#' @param force_recheck Force re-detection even if torch already works
#' @param log_fun Optional logging function
#' @return List with setup status
#' @export
setup_torch_auto <- function(force_recheck = FALSE, log_fun = NULL) {
  result <- list(
    status = "unknown",
    gpu_detected = FALSE,
    gpu_info = NULL,
    torch_kind = "cpu",
    torch_works = FALSE,
    message = "Not initialized"
  )

  # Log helper
  log_msg <- function(msg) {
    if (!is.null(log_fun)) {
      log_fun(msg)
    }
    message(msg)
  }

  # Step 1: Check if torch is already working
  if (!force_recheck && requireNamespace("torch", quietly = TRUE)) {
    if (torch::torch_is_installed()) {
      # Test current installation
      has_cuda <- tryCatch(torch::cuda_is_available(), error = function(e) FALSE)

      if (has_cuda) {
        # Test GPU
        if (test_gpu_working()) {
          result$status <- "ok_gpu"
          result$gpu_detected <- TRUE
          result$torch_kind <- "gpu"
          result$torch_works <- TRUE
          result$message <- "GPU torch already working"
          log_msg(result$message)
          return(result)
        }
      }

      # CPU works
      result$status <- "ok_cpu"
      result$torch_kind <- "cpu"
      result$torch_works <- TRUE
      result$message <- "CPU torch already working"
      log_msg(result$message)
      return(result)
    }
  }

  # Step 2: Detect GPU
  log_msg("Detecting GPU...")
  gpu_info <- detect_nvidia_gpu()

  if (is.null(gpu_info)) {
    result$status <- "no_gpu"
    result$message <- "No NVIDIA GPU detected"
    log_msg(result$message)
    return(result)
  }

  result$gpu_detected <- TRUE
  result$gpu_info <- gpu_info
  log_msg(paste("GPU detected:", gpu_info$gpu_name))

  # Step 3: Recommend torch kind
  recommendation <- recommend_torch_kind(gpu_info)
  result$torch_kind <- recommendation$torch_kind
  result$message <- recommendation$message
  log_msg(result$message)

  # Step 4: Return recommendation for user prompt
  result$recommendation <- recommendation
  result$status <- "needs_install"

  result
}

#' Helper to format GPU info for display
#' @param gpu_info Output from detect_nvidia_gpu()
#' @param arch_info Output from map_gpu_to_architecture()
#' @return Formatted string
format_gpu_info <- function(gpu_info, arch_info = NULL) {
  if (is.null(gpu_info)) {
    return("No GPU detected")
  }

  msg <- paste0(
    "GPU: ", gpu_info$gpu_name, "\n",
    "Driver: ", gpu_info$driver_version, "\n",
    "CUDA: ", gpu_info$cuda_driver
  )

  if (!is.null(arch_info)) {
    msg <- paste0(msg, "\n", "Architecture: ", toupper(arch_info$arch), " (sm_", arch_info$sm, ")")
  }

  msg
}

#' Install torch with specific CUDA version
#' @param torch_kind The torch kind ("cu126", "cu128", "cpu")
#' @param log_fun Optional logging function
#' @return TRUE if successful, FALSE otherwise
#' @export
install_torch_for_gpu <- function(torch_kind = "cpu", log_fun = NULL) {
  log_msg <- function(msg) {
    if (!is.null(log_fun)) log_fun(msg) else message(msg)
  }

  log_msg(paste("Installing torch:", toupper(torch_kind)))

  # Try to use pre-built binaries
  success <- FALSE

  if (torch_kind != "cpu") {
    tryCatch({
      # Get torch version
      version <- as.character(packageVersion("torch"))

      # Set up repository for specific CUDA version
      options(repos = c(
        torch = sprintf("https://torch-cdn.mlverse.org/packages/%s/%s/", torch_kind, version),
        CRAN = "https://cloud.r-project.org"
      ))

      # Try installing
      suppressMessages(install.packages("torch", quiet = TRUE))

      # Verify
      if (torch::torch_is_installed() && torch::cuda_is_available()) {
        success <- TRUE
      }
    }, error = function(e) {
      log_msg(paste("Install failed:", conditionMessage(e)))
    })

    # If failed, try fallback
    if (!success) {
      # Try next available CUDA version
      cuda_versions <- c("12.8", "12.6", "cpu")

      for (cuda_ver in cuda_versions) {
        if (cuda_ver == torch_kind) next

        tryCatch({
          kind <- paste0("cu", gsub("\\.", "", cuda_ver))
          version <- as.character(packageVersion("torch"))

          options(repos = c(
            torch = sprintf("https://torch-cdn.mlverse.org/packages/%s/%s/", kind, version),
            CRAN = "https://cloud.r-project.org"
          ))

          suppressMessages(install.packages("torch", quiet = TRUE))

          if (torch::cuda_is_available()) {
            log_msg(paste("Success with CUDA:", cuda_ver))
            success <- TRUE
            break
          }
        }, error = function(e) NULL)
      }
    }
  }

  # If STILL no success, use CPU
  if (!success) {
    log_msg("Falling back to CPU torch installation")
    tryCatch({
      install.packages("torch", repos = "https://cloud.r-project.org")
      if (torch::torch_is_installed()) {
        success <- TRUE
      }
    }, error = function(e) {
      log_msg(paste("CPU install also failed:", conditionMessage(e)))
    })
  }

  # Test the installation
  if (success) {
    gpu_test <- test_gpu_working()
    if (gpu_test) {
      log_msg("GPU torch verification: PASSED")
    } else {
      log_msg("Warning: GPU installed but test failed - using CPU mode")
    }
  }

  success
}