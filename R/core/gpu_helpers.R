# GPU acceleration helpers — optional torch/CUDA acceleration for raster ops,
# distance computations, and linear algebra. All functions are no-ops when
# torch is not installed or CUDA is unavailable.

sdm_use_gpu <- function() {
  if (!isTRUE(config$gpu_enabled %||% "auto" != "off")) return(FALSE)
  if (identical(config$gpu_enabled, "off")) return(FALSE)
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
