#!/usr/bin/env Rscript
# Plumber container entrypoint — installs CUDA libtorch + builds lantern from source.
# LD_LIBRARY_PATH, TORCH_HOME, CUDA_HOME are set in the Dockerfile ENV.
# CUDA toolkit is pre-installed in the image.

`%||%` <- function(a, b) if (!is.null(a)) a else b

# Ensure PATH includes CUDA tools
Sys.setenv(PATH = paste("/usr/local/cuda-12.6/bin", Sys.getenv("PATH"), sep = ":"))
# cli 3.6.6 broke torch 0.17.0's onLoad formatting — disable cli styling
options(cli.num_colors = 0, cli.hyperlink = FALSE)

options(timeout = 1800)
torch_home <- Sys.getenv("TORCH_HOME", "/app/outputs/.torch")
dir.create(torch_home, recursive = TRUE, showWarnings = FALSE)

cat("=== Plumber entrypoint ===\n")

has_nvcc <- nzchar(Sys.which("nvcc"))
cat("CUDA toolkit:", has_nvcc, "\n")
if (has_nvcc) {
  cat("CUDA version:", system("nvcc --version | grep release | sed 's/.*release //;s/,.*//'", intern = TRUE), "\n")
}

libtorch_ready <- dir.exists(file.path(torch_home, "libtorch")) && length(dir(file.path(torch_home, "libtorch"))) > 0
lantern_so <- list.files(file.path(torch_home, "lantern"), pattern = "\\.so$", full.names = TRUE)
lantern_ready <- length(lantern_so) > 0 || length(list.files(file.path(torch_home, "lib"), pattern = "lantern\\.so$")) > 0
cat("libtorch cached:", libtorch_ready, "\n")
cat("lantern ready:", lantern_ready, "\n")

# ─── Install phase ──────────────────────────────────────────────────────────
if (has_nvcc && (!libtorch_ready || !lantern_ready)) {

  if (!libtorch_ready) {
    cat("\n[1/3] Downloading CUDA libtorch (~2.8 GB)...\n")
    url <- "https://download.pytorch.org/libtorch/cu126/libtorch-shared-with-deps-2.8.0%2Bcu126.zip"
    zip <- file.path(torch_home, "lt.zip")
    repeat {
      ok <- tryCatch({ download.file(url, zip, mode = "wb", quiet = TRUE); TRUE }, error = function(e) { cat("  retry:", conditionMessage(e), "\n"); FALSE })
      if (ok) break
      Sys.sleep(5)
    }
    cat("  extracting...\n")
    unzip(zip, exdir = torch_home)
    unlink(zip)
    cat("  libtorch ready\n")
  }

  if (!lantern_ready) {
    cat("[2/3] Cloning lantern...\n")
    unlink("/tmp/lantern", recursive = TRUE)
    system("git clone --depth 1 https://github.com/mlverse/lantern.git /tmp/lantern", ignore.stdout = TRUE, ignore.stderr = TRUE)

    cat("[3/3] Building lantern...\n")
    build_dir <- file.path(torch_home, "lantern_build")
    unlink(build_dir, recursive = TRUE)
    dir.create(build_dir, recursive = TRUE, showWarnings = FALSE)
    system(paste("cd", shQuote(build_dir), "&& cmake", shQuote("/tmp/lantern"),
      "-DCMAKE_INSTALL_PREFIX=", shQuote(torch_home), "-DLANTERN_BUILD_TESTS=OFF",
      "&& make -j$(nproc)", "&& make install"), ignore.stdout = FALSE, ignore.stderr = FALSE)
    cat("  lantern built\n")
  }
}

# ─── Finalize: ensure lantern.so is where torch expects it ────────────────
if (has_nvcc && requireNamespace("torch", quietly = TRUE)) {
  dir.create(file.path(torch_home, "lantern"), recursive = TRUE, showWarnings = FALSE)
  src <- file.path(torch_home, "lib", "liblantern.so")
  dst <- file.path(torch_home, "lantern", "lantern.so")
  if (file.exists(src) && !file.exists(dst)) file.copy(src, dst, overwrite = TRUE)
  cat("\nCUDA check:", tryCatch(torch::cuda_is_available(), error = function(e) paste("error:", conditionMessage(e))), "\n")
}

# ─── Start Plumber ──────────────────────────────────────────────────────────
cat("\nStarting Plumber server...\n")
source("/app/plumber/R/run_server.R")
