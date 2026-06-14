# GPU acceleration helpers — optional torch/CUDA acceleration for raster ops,
# distance computations, and linear algebra. All functions are no-ops when
# torch is not installed or CUDA is unavailable.

sdm_use_gpu <- function() {
  enabled <- config$gpu_enabled %||% "auto"
  if (identical(enabled, "off")) return(FALSE)
  requireNamespace("torch", quietly = TRUE) &&
  torch::torch_is_installed() &&
  torch::cuda_is_available()
}

sdm_use_gpu_for <- function(n, min_n = NULL) {
  if (is.null(min_n)) min_n <- config$gpu_min_cells %||% 100000L
  sdm_use_gpu() && n >= min_n
}

gpu_device <- function() {
  if (!sdm_use_gpu()) return("cpu")
  config$gpu_device %||% "cuda"
}

raster_to_tensor <- function(rast, device = gpu_device()) {
  vals <- terra::values(rast)
  if (is.null(vals)) return(NULL)
  torch::torch_tensor(vals, dtype = torch::torch_float(), device = device)
}

tensor_to_raster <- function(tensor, template) {
  vals <- as.numeric(tensor$to(device = "cpu"))
  rast <- terra::rast(template[[1]])
  terra::values(rast) <- vals
  rast
}

gpu_empty_cache <- function() {
  if (sdm_use_gpu()) {
    tryCatch(torch::cuda_empty_cache(), error = function(e) NULL)
  }
}

# Pinned memory GPU transfer helper.
# Uses the pinned_alloc.so C extension (CUDA toolkit headers required at build time)
# for async H2D copies. Falls back to standard raster_to_tensor() when unavailable.
#
# The C extension returns an XPtrTorchTensor directly usable by R's torch package.
# Steps: 1. allocate pinned CPU buffer (page-locked)  2. fill with R matrix values
#        3. async cudaMemcpy to GPU  4. return GPU tensor
tryCatch(
  { so_path <- file.path("sdmtorch", "pinned_alloc.so")
    if (file.exists(so_path)) dyn.load(so_path) },
  error = function(e) NULL
)
raster_to_tensor_pinned <- function(rast, device = gpu_device()) {
  if (!is.loaded("pinned_alloc", PACKAGE = "pinned_alloc") ||
      !is.loaded("pinned_to_gpu_tensor", PACKAGE = "pinned_alloc")) {
    return(raster_to_tensor(rast, device))
  }
  vals <- terra::values(rast)
  if (is.null(vals)) return(NULL)
  n_vars <- NCOL(vals)
  if (n_vars <= 1) {
    vals <- matrix(vals, ncol = 1L)
  }
  buf <- .Call("pinned_alloc", NROW(vals), n_vars)
  on.exit(tryCatch(.Call("pinned_free", buf), error = function(e) NULL), add = TRUE)
  .Call("pinned_fill", buf, vals)
  tensor <- .Call("pinned_to_gpu_tensor", buf, device)
  tensor$view(c(NROW(vals), n_vars))
}

sdm_use_gpu_xgb <- function(n_rows) {
  sdm_use_gpu() && n_rows >= (config$gpu_min_rows %||% 5000L)
}

gpu_raster_app <- function(rast, fun, ...) {
  n_cells <- terra::ncell(rast)
  n_layers <- terra::nlyr(rast)
  vals <- as.matrix(terra::values(rast))
  valid <- stats::complete.cases(vals)
  if (!any(valid)) {
    out <- terra::rast(rast[[1]])
    terra::values(out) <- NA_real_
    return(out)
  }
  dev <- gpu_device()
  tensor <- torch::torch_tensor(vals[valid, , drop = FALSE], device = dev)
  result_vals <- fun(tensor, ...)
  vals_numeric <- as.numeric(result_vals$to(device = "cpu"))
  out <- terra::rast(rast[[1]])
  terra::values(out) <- NA_real_
  out[which(valid)] <- vals_numeric
  out
}

gpu_raster_app_batch <- function(rast, fun_list, batch_download = TRUE) {
  n_cells <- terra::ncell(rast)
  n_layers <- terra::nlyr(rast)
  vals <- as.matrix(terra::values(rast))
  valid <- stats::complete.cases(vals)
  if (!any(valid)) {
    out <- terra::rast(rast[[1]])
    terra::values(out) <- NA_real_
    return(lapply(seq_along(fun_list), function(i) out))
  }
  dev <- gpu_device()
  tensor <- torch::torch_tensor(vals[valid, , drop = FALSE], device = dev)

  results <- vector("list", length(fun_list))
  if (batch_download && length(fun_list) > 1) {
    result_tensors <- vector("list", length(fun_list))
    for (i in seq_along(fun_list)) {
      result_tensors[[i]] <- fun_list[[i]](tensor)
    }
    n_out <- length(fun_list)
    cat_tensor <- torch::torch_stack(result_tensors, dim = 2)
    all_numeric <- as.matrix(cat_tensor$to(device = "cpu"))
    for (i in seq_along(fun_list)) {
      vals_numeric <- all_numeric[, i]
      out <- terra::rast(rast[[1]])
      terra::values(out) <- NA_real_
      out[which(valid)] <- vals_numeric
      results[[i]] <- out
    }
  } else {
    for (i in seq_along(fun_list)) {
      result_vals <- fun_list[[i]](tensor)
      vals_numeric <- as.numeric(result_vals$to(device = "cpu"))
      out <- terra::rast(rast[[1]])
      terra::values(out) <- NA_real_
      out[which(valid)] <- vals_numeric
      results[[i]] <- out
    }
  }
  results
}
