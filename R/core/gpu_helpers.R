# Accelerator helpers. R torch exposes both NVIDIA CUDA and AMD ROCm through
# device = "cuda"; keep the public backend label separate from that tensor name.

sdm_accelerator_capabilities <- function(capabilities = NULL) {
  if (!is.null(capabilities)) {
    raw <- capabilities
  } else {
    torch_ready <- requireNamespace("torch", quietly = TRUE) &&
      tryCatch(torch::torch_is_installed(), error = function(e) FALSE)
    torch_cuda <- torch_ready && tryCatch(torch::cuda_is_available(), error = function(e) FALSE)
    mps <- torch_ready && tryCatch(torch::mps_is_available(), error = function(e) FALSE)
    # rocm-smi/environment are vendor labels only. They never make an R torch
    # backend available without a successful CUDA-compatible torch probe.
    rocm_hint <- nzchar(Sys.getenv("ROCM_HOME", "")) ||
      nzchar(Sys.getenv("ROCM_PATH", "")) ||
      nzchar(Sys.getenv("HIP_PATH", "")) ||
      nzchar(Sys.which("rocm-smi")) || file.exists("/opt/rocm/bin/rocm-smi")
    raw <- list(cuda = torch_cuda, cuda_compatible = torch_cuda, rocm = torch_cuda && rocm_hint, mps = mps)
  }

  cuda_compatible <- isTRUE(raw$cuda_compatible %||% raw$cuda)
  rocm <- isTRUE(raw$rocm) && cuda_compatible
  cuda <- isTRUE(raw$cuda) && !rocm
  mps <- isTRUE(raw$mps)
  list(
    cuda = cuda,
    rocm = rocm,
    mps = mps,
    cpu = TRUE,
    # Keep this mapping internal: ROCm tensors still use the R torch "cuda" name.
    tensor_devices = c(cuda = "cuda", rocm = "cuda", mps = "mps", cpu = "cpu")
  )
}

sdm_backend_is_gpu <- function(backend) {
  tolower(as.character(backend %||% "cpu")[1]) %in% c("cuda", "rocm", "mps", "gpu")
}

sdm_backend_is_discrete_gpu <- function(backend) {
  tolower(as.character(backend %||% "cpu")[1]) %in% c("cuda", "rocm", "gpu")
}

sdm_resolve_backend <- function(request = "auto", capabilities = NULL, fallback_cpu = TRUE) {
  caps <- sdm_accelerator_capabilities(capabilities)
  request <- tolower(as.character(request %||% "auto")[1])
  if (is.na(request) || !nzchar(request)) request <- "auto"
  if (request == "gpu") request <- "auto"
  if (!request %in% c("auto", "cuda", "rocm", "mps", "cpu")) request <- "auto"

  available <- function(backend) isTRUE(caps[[backend]])
  backend <- if (request == "auto") {
    c("cuda", "rocm", "mps", "cpu")[which(vapply(c("cuda", "rocm", "mps", "cpu"), available, logical(1)))[1]]
  } else if (available(request)) {
    request
  } else if (isTRUE(fallback_cpu)) {
    "cpu"
  } else {
    request
  }
  list(
    requested = request,
    backend = backend,
    device = unname(caps$tensor_devices[[backend]] %||% "cpu"),
    available = available(backend),
    requested_available = if (identical(request, "auto")) sdm_backend_is_gpu(backend) || identical(backend, "cpu") else available(request),
    capabilities = caps
  )
}

sdm_backend_for_device <- function(device = "auto", capabilities = NULL) {
  sdm_resolve_backend(device, capabilities = capabilities)$backend
}

sdm_backend_device <- function(backend, capabilities = NULL) {
  unname(sdm_accelerator_capabilities(capabilities)$tensor_devices[[backend]] %||% "cpu")
}

sdm_is_cuda_backend <- function(backend = "auto", capabilities = NULL) {
  identical(sdm_resolve_backend(backend, capabilities = capabilities)$backend, "cuda")
}

sdm_use_gpu <- function(capabilities = NULL) {
  enabled <- config$gpu_enabled %||% "auto"
  if (identical(enabled, "off")) return(FALSE)
  sdm_backend_is_gpu(sdm_resolve_backend(config$gpu_device %||% "auto", capabilities)$backend)
}

sdm_use_gpu_for <- function(n, min_n = NULL, capabilities = NULL) {
  if (is.null(min_n)) min_n <- config$gpu_min_cells %||% 100000L
  sdm_use_gpu(capabilities) && n >= min_n
}

gpu_backend <- function(capabilities = NULL) {
  sdm_resolve_backend(config$gpu_device %||% "auto", capabilities)$backend
}

gpu_device <- function(capabilities = NULL) {
  sdm_resolve_backend(config$gpu_device %||% "auto", capabilities)$device
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

# Pinned allocation is a CUDA extension, not the generic torch CUDA/ROCm API.
sdm_load_pinned_alloc <- function(backend = gpu_backend()) {
  if (!identical(backend, "cuda")) return(FALSE)
  if (is.loaded("pinned_alloc", PACKAGE = "pinned_alloc")) return(TRUE)
  sdm_root <- if (exists("sdm_project_root", mode = "function")) sdm_project_root() else getwd()
  so_path <- file.path(sdm_root, "sdmtorch", "pinned_alloc.so")
  if (!file.exists(so_path)) return(FALSE)
  tryCatch({ dyn.load(so_path); TRUE }, error = function(e) FALSE)
}

raster_to_tensor_pinned <- function(rast, device = gpu_device(), backend = gpu_backend()) {
  if (!identical(backend, "cuda") || !sdm_load_pinned_alloc(backend) ||
      !is.loaded("pinned_alloc", PACKAGE = "pinned_alloc") ||
      !is.loaded("pinned_to_gpu_tensor", PACKAGE = "pinned_alloc")) {
    return(raster_to_tensor(rast, device))
  }
  vals <- terra::values(rast)
  if (is.null(vals)) return(NULL)
  n_vars <- NCOL(vals)
  if (n_vars <= 1) vals <- matrix(vals, ncol = 1L)
  buf <- .Call("pinned_alloc", NROW(vals), n_vars)
  on.exit(tryCatch(.Call("pinned_free", buf), error = function(e) NULL), add = TRUE)
  .Call("pinned_fill", buf, vals)
  tensor <- .Call("pinned_to_gpu_tensor", buf, device)
  tensor$view(c(NROW(vals), n_vars))
}

# XGBoost's R GPU implementation is CUDA-only; ROCm torch support is unrelated.
sdm_use_gpu_xgb <- function(n_rows, capabilities = NULL) {
  enabled <- config$gpu_enabled %||% "auto"
  !identical(enabled, "off") &&
    identical(sdm_resolve_backend(config$gpu_device %||% "auto", capabilities)$backend, "cuda") &&
    n_rows >= (config$gpu_min_rows %||% 5000L)
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
    for (i in seq_along(fun_list)) result_tensors[[i]] <- fun_list[[i]](tensor)
    cat_tensor <- torch::torch_stack(result_tensors, dim = 2)
    all_numeric <- as.matrix(cat_tensor$to(device = "cpu"))
    for (i in seq_along(fun_list)) {
      out <- terra::rast(rast[[1]])
      terra::values(out) <- NA_real_
      out[which(valid)] <- all_numeric[, i]
      results[[i]] <- out
    }
  } else {
    for (i in seq_along(fun_list)) {
      result_vals <- fun_list[[i]](tensor)
      out <- terra::rast(rast[[1]])
      terra::values(out) <- NA_real_
      out[which(valid)] <- as.numeric(result_vals$to(device = "cpu"))
      results[[i]] <- out
    }
  }
  results
}
