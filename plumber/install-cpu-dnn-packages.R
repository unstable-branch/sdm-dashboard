#!/usr/bin/env Rscript

# Reproducible CPU DNN installation for the R 4.4 runtime. The versioned
# mlverse archive contains a matched LibTorch/LibLantern distribution, but its
# packaged R shared object targets a newer R ABI. Extract only the native
# runtime and compile the exact torch source commit against this image's R.
cran_repo <- Sys.getenv("R_CRAN_REPO", unset = NA_character_)
torch_version <- Sys.getenv("R_TORCH_VERSION", unset = "0.17.0")
cito_version <- Sys.getenv("R_CITO_VERSION", unset = "1.1")
runtime_sha256 <- Sys.getenv("R_TORCH_RUNTIME_SHA256", unset = NA_character_)
torch_commit <- Sys.getenv("R_TORCH_SOURCE_COMMIT", unset = NA_character_)
source_sha256 <- Sys.getenv("R_TORCH_SOURCE_SHA256", unset = NA_character_)
required <- c(cran_repo, runtime_sha256, torch_commit, source_sha256)
if (any(is.na(required) | !nzchar(required))) {
  stop("Dated CRAN and exact torch runtime/source pins are required.", call. = FALSE)
}
if (!grepl("^[0-9]+[.][0-9]+[.][0-9]+$", torch_version)) {
  stop("R_TORCH_VERSION must be an exact x.y.z version.", call. = FALSE)
}
if (!grepl("^[0-9a-f]{64}$", runtime_sha256) || !grepl("^[0-9a-f]{64}$", source_sha256)) {
  stop("Torch SHA-256 pins must be lowercase 64-character digests.", call. = FALSE)
}
if (!grepl("^[0-9a-f]{40}$", torch_commit)) {
  stop("R_TORCH_SOURCE_COMMIT must be a full commit hash.", call. = FALSE)
}

options(
  timeout = 1800,
  repos = c(CRAN = cran_repo),
  HTTPUserAgent = paste0("R/", getRversion(), " ", getOption("HTTPUserAgent")),
  Ncpus = max(1L, parallel::detectCores() - 1L)
)

check_sha256 <- function(path, expected) {
  output <- system2("sha256sum", path, stdout = TRUE, stderr = TRUE)
  status <- attr(output, "status")
  if (!is.null(status) && status != 0L) stop(paste(output, collapse = "\n"), call. = FALSE)
  actual <- strsplit(output[[1]], "[[:space:]]+")[[1]][1]
  if (!identical(actual, expected)) {
    stop(sprintf("SHA-256 mismatch for %s: expected %s, got %s", basename(path), expected, actual), call. = FALSE)
  }
}

runtime_url <- sprintf(
  "https://torch-cdn.mlverse.org/packages/cpu/%s/src/contrib/torch_%s_R_x86_64-pc-linux-gnu.tar.gz",
  torch_version, torch_version
)
runtime_archive <- tempfile("torch-runtime-", fileext = ".tar.gz")
runtime_extract <- tempfile("torch-runtime-")
dir.create(runtime_extract)
download.file(runtime_url, runtime_archive, mode = "wb", quiet = FALSE)
check_sha256(runtime_archive, runtime_sha256)
utils::untar(runtime_archive, exdir = runtime_extract)
runtime_root <- file.path(runtime_extract, "torch")
for (component in c("include", "lib")) {
  if (!dir.exists(file.path(runtime_root, component))) {
    stop(sprintf("Pinned torch runtime is missing %s/.", component), call. = FALSE)
  }
}
unlink("/opt/torch", recursive = TRUE)
dir.create("/opt/torch", recursive = TRUE)
for (component in c("include", "lib")) {
  ok <- file.copy(file.path(runtime_root, component), "/opt/torch", recursive = TRUE)
  if (!all(ok)) stop(sprintf("Could not install torch runtime %s/.", component), call. = FALSE)
}
if (!file.exists("/opt/torch/lib/libtorch.so") || !file.exists("/opt/torch/lib/liblantern.so")) {
  stop("Pinned CPU archive lacks LibTorch or LibLantern.", call. = FALSE)
}
unlink(c(runtime_archive, runtime_extract), recursive = TRUE)

# Install the exact R wrapper source against the image's own R ABI.
install.packages(c("coro", "desc", "safetensors"))
source_url <- sprintf("https://codeload.github.com/mlverse/torch/tar.gz/%s", torch_commit)
source_archive <- tempfile("torch-source-", fileext = ".tar.gz")
source_extract <- tempfile("torch-source-")
dir.create(source_extract)
download.file(source_url, source_archive, mode = "wb", quiet = FALSE)
check_sha256(source_archive, source_sha256)
utils::untar(source_archive, exdir = source_extract)
source_roots <- list.dirs(source_extract, recursive = FALSE, full.names = TRUE)
if (length(source_roots) != 1L || !file.exists(file.path(source_roots, "DESCRIPTION"))) {
  stop("Pinned torch source archive has an unexpected layout.", call. = FALSE)
}
install_output <- system2(
  file.path(R.home("bin"), "R"),
  c("CMD", "INSTALL", "--no-multiarch", shQuote(source_roots)),
  stdout = "", stderr = ""
)
if (!identical(install_output, 0L)) stop("Compiling pinned R torch source failed.", call. = FALSE)
unlink(c(source_archive, source_extract), recursive = TRUE)
if (!identical(as.character(packageVersion("torch")), torch_version)) {
  stop("Installed torch version does not match R_TORCH_VERSION.", call. = FALSE)
}

# torch is already present, so cito resolves against the local compatible build.
install.packages("cito", repos = c(CRAN = cran_repo))
if (!identical(as.character(packageVersion("cito")), cito_version)) {
  stop("Installed cito version does not match R_CITO_VERSION.", call. = FALSE)
}

suppressPackageStartupMessages(library(torch))
if (!isTRUE(torch::torch_is_installed())) {
  stop("LibTorch/LibLantern are absent from the pinned CPU torch runtime.", call. = FALSE)
}
probe <- torch::torch_tensor(c(1, 2, 3), device = "cpu")$sum()$item()
if (!identical(as.numeric(probe), 6)) {
  stop("CPU LibTorch tensor smoke test failed.", call. = FALSE)
}

cat(sprintf(
  "Verified CPU DNN runtime: torch %s (%s), cito %s, LibTorch tensor probe=%s\n",
  torch_version, torch_commit, cito_version, probe
))
