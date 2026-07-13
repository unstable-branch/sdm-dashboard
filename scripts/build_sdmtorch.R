# Build sdmtorch C++ extensions against the installed torch R package.
# Called during Docker build — resolves torch library paths dynamically.
# Usage: Rscript scripts/build_sdmtorch.R

torch_path <- system.file(package = "torch")
torch_lib <- file.path(torch_path, "lib")
cat("Torch package path:", torch_path, "\n")
cat("Torch lib path:", torch_lib, "\n")

# Also check TORCH_HOME for libtorch (the manually installed libtorch in Docker)
torch_home <- Sys.getenv("TORCH_HOME", "/opt/torch")
torch_home_lib <- file.path(torch_home, "lib")
cat("TORCH_HOME lib path:", torch_home_lib, "\n")

torch_home_include <- file.path(torch_home, "include")
if (dir.exists(torch_home_lib) && dir.exists(torch_home_include)) {
  torch_build_root <- torch_home
} else if (dir.exists(torch_lib) && dir.exists(file.path(torch_path, "include"))) {
  torch_build_root <- torch_path
} else {
  stop("No complete LibTorch include/lib root found under TORCH_HOME or the torch package.")
}
cat("LibTorch build root:", torch_build_root, "\n")

src_dir <- file.path(getwd(), "sdmtorch")
if (!dir.exists(src_dir)) {
  stop("sdmtorch source directory not found at: ", src_dir)
}

# Build
old_wd <- setwd(src_dir)
on.exit(setwd(old_wd))

# Rewrite Makefile paths for Docker environment. Source-built R torch can use
# an external TORCH_HOME, while binary packages keep LibTorch under the package.
makefile_lines <- readLines("Makefile")
makefile_lines <- sub(
  "TORCH_HOME := $(TORCH_PKG)",
  paste0("TORCH_HOME := ", torch_build_root),
  makefile_lines,
  fixed = TRUE
)
makefile_lines <- sub(
  "^R_INC :=.*$",
  paste0("R_INC := -I", R.home("include")),
  makefile_lines
)
makefile_lines <- sub(
  "^R_LIB :=.*$",
  paste0("R_LIB := -L", R.home("lib"), " -lR"),
  makefile_lines
)
makefile_lines <- sub(
  "^RPATH :=.*$",
  paste0("RPATH := -Wl,-rpath,$(TORCH_HOME)/lib -Wl,-rpath,", R.home("lib")),
  makefile_lines
)
makefile_lines <- gsub(
  "../renv/library/[^ ]+/torch",
  gsub("/+$", "", torch_path),
  makefile_lines
)
# Fix library paths to include both torch R package lib and torch_home lib
makefile_lines <- gsub(
  '-L\\S*/torch/lib',
  paste0('-L', torch_lib, ' -L', torch_home_lib),
  makefile_lines
)
makefile_lines <- gsub(
  '-Wl,-rpath,\\S*/torch/lib',
  paste0('-Wl,-rpath,', torch_lib, ':-Wl,-rpath,', torch_home_lib),
  makefile_lines
)
writeLines(makefile_lines, "Makefile")

# Clean and build all targets
cat("Building sdmtorch targets...\n")
ret <- system("make -C . clean 2>/dev/null; make -C . all 2>&1")
if (ret != 0) {
  cat("WARNING: sdmtorch build failed, continuing without C++ extensions\n")
}
