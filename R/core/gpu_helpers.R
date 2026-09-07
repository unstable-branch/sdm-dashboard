# Accelerator helpers. R torch exposes both NVIDIA CUDA and AMD ROCm through
# device = "cuda"; keep the public backend label separate from that tensor name.

# Session-level cache for accelerator capabilities (avoids repeated cuda_is_available probes)
._gpu_caps_cache <- new.env(parent = emptyenv())

#' Probe AMD ROCm runtime via loaded DLLs.
#' @details Uses getLoadedDLLs() to check for libamdhip64.so and related ROCm
#'   runtime libraries. This is a runtime probe (authoritative) vs the
#'   SDM_ROCM=1 env-var which is an explicit opt-in with a warning message.
.sdm_rocm_runtime_detected <- function() {
  dlls <- tryCatch(getLoadedDLLs(), error = function(e) list())
  rocm_dlls <- c("libamdhip64.so", "libhsa-runtime64.so", "libhsa-runtime.so")
  any(rocm_dlls %in% names(dlls)) || any(grepl("amdhip|hsa-runtime", names(dlls), ignore.case = TRUE))
}

#' Resolve accelerator capabilities for the current host.
#' @param capabilities Optional named list with cuda/rocm/mps flags. When NULL
#'   (default), probes the runtime. When provided (e.g., from python_torch_dnn
#'   via python_capabilities), the explicit values are used directly.
#' @details Results are cached per session in ._gpu_caps_cache. Pass an explicit
#'   capabilities list to bypass the cache and force recomputation. ROCm
#'   detection uses getLoadedDLLs() as the primary probe; set SDM_ROCM=1 for
#'   an explicit opt-in (triggers a warning if no ROCm runtime is detected).
sdm_accelerator_capabilities <- function(capabilities = NULL) {
  if (!is.null(capabilities)) {
    .caps <- .compute_caps(capabilities)
    assign("caps", .caps, envir = ._gpu_caps_cache)
    return(.caps)
  }
  if (exists("caps", envir = ._gpu_caps_cache)) {
    return(get("caps", envir = ._gpu_caps_cache))
  }
  .caps <- .compute_caps(NULL)
  assign("caps", .caps, envir = ._gpu_caps_cache)
  .caps
}

.compute_caps <- function(raw = NULL) {
  if (is.null(raw)) {
    torch_ready <- requireNamespace("torch", quietly = TRUE) &&
      tryCatch(torch::torch_is_installed(), error = function(e) FALSE)
    torch_cuda <- torch_ready && tryCatch(torch::cuda_is_available(), error = function(e) FALSE)
    mps <- torch_ready && tryCatch(torch::mps_is_available(), error = function(e) FALSE)
    raw <- list(cuda = torch_cuda, cuda_compatible = torch_cuda, mps = mps)
  }

  cuda_compatible <- isTRUE(raw$cuda_compatible %||% raw$cuda)
  if (!is.null(raw$rocm)) {
    rocm <- isTRUE(raw$rocm) && cuda_compatible
  } else {
    rocm_runtime <- cuda_compatible && .sdm_rocm_runtime_detected()
    rocm_env <- identical(tolower(Sys.getenv("SDM_ROCM", "")), "1")
    rocm <- cuda_compatible && (rocm_runtime || rocm_env)
    if (rocm_env && !rocm_runtime) {
      message("SDM_ROCM=1 is set, but no ROCm runtime libraries detected. ",
              "Training will proceed assuming ROCm backend. ",
              "Unset SDM_ROCM if running on NVIDIA CUDA.")
    }
  }
  cuda <- isTRUE(raw$cuda) && !rocm
  mps <- isTRUE(raw$mps)
  list(
    cuda = cuda,
    rocm = rocm,
    mps = mps,
    cpu = TRUE,
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

#' Check if a torch device is CUDA (NVIDIA or AMD ROCm).
#' @param device A torch_device object or a character device string e.g. "cuda:0".
#' @details Both NVIDIA CUDA and AMD ROCm tensors use the "cuda" device name in R torch.
#'   This function returns TRUE for any device starting with "cuda" to cover both.
#'   Use this instead of string comparisons like `startsWith(device, "cuda")`.
sdm_device_is_cuda_tensor <- function(device) {
  dev <- if (inherits(device, "torch_device")) device$type else as.character(device)
  identical(dev, "cuda") || startsWith(dev, "cuda")
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

sdm_gpu_available_vram <- function() {
  if (!requireNamespace("torch", quietly = TRUE)) return(NA_real_)
  if (!tryCatch(torch::cuda_is_available(), error = function(e) FALSE)) return(NA_real_)
  tryCatch({
    stats <- torch::cuda_memory_stats()
    # Free VRAM = reserved_bytes$all$peak − allocated_bytes$all$current.
    # reserved_bytes$all$current is what torch has reserved (allocated),
    # not what's free. vram_safe_batchsize downstream sizes GPU batches
    # based on this; using reserved directly causes OOM under load.
    allocated <- stats$allocated_bytes$all$current
    reserved_peak <- stats$reserved_bytes$all$peak
    if (is.finite(allocated) && is.finite(reserved_peak) && reserved_peak > 0) {
      free_bytes <- max(0, reserved_peak - allocated)
      return(free_bytes / (1024 * 1024))
    }
    NA_real_
  }, error = function(e) NA_real_)
}

sdm_gpu_total_vram <- function() {
  if (!requireNamespace("torch", quietly = TRUE)) return(NA_real_)
  if (!tryCatch(torch::cuda_is_available(), error = function(e) FALSE)) return(NA_real_)
  tryCatch({
    stats <- torch::cuda_memory_stats()
    total_bytes <- stats$reserved_bytes$all$total
    if (is.finite(total_bytes) && total_bytes > 0) return(total_bytes / (1024 * 1024))
    NA_real_
  }, error = function(e) NA_real_)
}
