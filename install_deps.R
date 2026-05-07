# Install required packages
pkgs <- c(
  "biomod2",
  "randomForest",
  "gbm",
  "maxnet",
  "nnet",
  "mgcv",
  "earth",
  "rpart",
  "mda",
  "httr",
  "jsonlite",
  "cito"
)

for (pkg in pkgs) {
  cat("Installing", pkg, "...\n")
  tryCatch({
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = FALSE)
    cat(pkg, "installed successfully\n")
  }, error = function(e) {
    cat("Failed to install", pkg, ":", conditionMessage(e), "\n")
  })
}

# Install torch with GPU support (CUDA 12.8 pre-built binaries)
# GPU mode requires: NVIDIA GPU + CUDA Toolkit 12.8 + cuDNN
cat("Installing torch...\n")
options(timeout = 600)

tryCatch({
  # Check for NVIDIA GPU and CUDA availability
  has_nvidia_gpu <- FALSE
  cuda_version <- NA_character_
  
  if (.Platform$OS.type == "windows") {
    tryCatch({
      gpu_info <- system("wmic path win32_VideoController get name", intern = TRUE)
      has_nvidia_gpu <- any(grepl("NVIDIA", gpu_info, ignore.case = TRUE))
    }, error = function(e) NULL)
  }
  
  if (has_nvidia_gpu) {
    cat("NVIDIA GPU detected. Installing torch with CUDA 12.8 support...\n")
    # Use pre-built binaries with CUDA 12.8 for Windows
    version <- packageVersion("torch")
    if (is.null(version)) {
      # Get version from available.packages if not loaded
      avail <- available.packages()
      version <- avail["torch", "Version"]
    }
    
    options(repos = c(
      torch = sprintf("https://torch-cdn.mlverse.org/packages/cu128/%s/", version),
      CRAN = "https://cloud.r-project.org"
    ))
    
    install.packages("torch")
    cat("torch with CUDA 12.8 installed successfully\n")
  } else {
    cat("No NVIDIA GPU detected. Installing CPU version of torch...\n")
    install.packages("torch", repos = "https://cloud.r-project.org")
    
    # Verify CPU installation
    library(torch)
    if (!torch::torch_is_installed()) {
      cat("Running torch::install_torch() for CPU build...\n")
      torch::install_torch()
    }
    cat("torch CPU version installed successfully\n")
  }
  
  # Verify installation
  library(torch)
  if (torch::torch_is_installed()) {
    cat("torch installation verified\n")
    
    # Report device availability
    if (torch::cuda_is_available()) {
      cat("CUDA is available - GPU acceleration enabled\n")
    } else if (torch::mps_is_available()) {
      cat("MPS is available (Apple Silicon GPU) - GPU acceleration enabled\n")
    } else {
      cat("Using CPU for computations\n")
    }
  } else {
    cat("Warning: torch installation not verified\n")
  }
  
}, error = function(e) {
  cat("Failed to install torch:", conditionMessage(e), "\n")
  cat("Attempting fallback to CPU installation...\n")
  tryCatch({
    install.packages("torch", repos = "https://cloud.r-project.org")
    library(torch)
    if (!torch::torch_is_installed()) {
      torch::install_torch()
    }
    cat("torch fallback installation completed\n")
  }, error = function(e2) {
    cat("Fallback also failed:", conditionMessage(e2), "\n")
  })
})

cat("\nAll packages installed.\n")