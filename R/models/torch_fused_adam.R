# Fused Adam optimizer for cito DNN training.
# Replaces cito's per-parameter Adam optimizer with torch's fused Adam kernel.
# Supports: fused Adam (libtorch direct + R fallback), mixed-precision (AMP),
# CUDA Graphs, gradient accumulation, jit-traced forward pass.

.train_opts <- new.env(parent = emptyenv())

set_train_opts <- function(mixed_precision = "auto", cuda_graphs = "auto") {
  .train_opts$mixed_precision <- mixed_precision
  .train_opts$cuda_graphs <- cuda_graphs
}

# Optional GPU memory profiler — records allocation traceback history.
# Enable with env SDM_GPU_PROFILE=true or gpu_profile=TRUE in train_model_fused.
# Writes gpu_memory_snapshot.json to the output dir for analysis with
# pytorch's memory_viz.py: python memory_viz.py trace gpu_memory_snapshot.json
gpu_profile_start <- function(enabled = FALSE) {
  if (!enabled) return(FALSE)
  if (!requireNamespace("torch", quietly = TRUE)) return(FALSE)
  if (!torch::cuda_is_available()) return(FALSE)
  tryCatch({
    torch::cuda_record_memory_history()
    TRUE
  }, error = function(e) FALSE)
}

gpu_profile_dump <- function(enabled, output_dir = NULL) {
  if (!isTRUE(enabled)) return(invisible(NULL))
  if (!requireNamespace("torch", quietly = TRUE)) return(invisible(NULL))
  tryCatch({
    if (!is.null(output_dir) && nzchar(output_dir)) {
      dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
      torch::cuda_dump_memory_snapshot(file.path(output_dir, "gpu_memory_snapshot.json"))
    }
  }, error = function(e) NULL)
}

gpu_profile_stop <- function(enabled) {
  if (!isTRUE(enabled)) return(invisible(NULL))
  # Recording is already stopped by cuda_dump_memory_snapshot; this is a no-op
  invisible(TRUE)
}

# ABI compatibility check: verify .so was compiled against the same torch version
# that is currently loaded. Prevents silent memory corruption from ABI mismatches.
sdm_check_so_abi <- function(so_path, so_label = "C++ extension") {
  if (!file.exists(so_path)) return(invisible(FALSE))
  if (!requireNamespace("torch", quietly = TRUE)) return(invisible(FALSE))
  # Get version from the .so — it should already be loaded
  so_version <- tryCatch(.Call("sdmtorch_torch_version"), error = function(e) "unknown")
  torch_version <- tryCatch(as.character(packageVersion("torch")), error = function(e) "unknown")
  if (identical(so_version, "unknown") || identical(torch_version, "unknown")) return(invisible(FALSE))
  # Major.minor must match (patch can differ)
  so_major <- strsplit(so_version, "\\.")[[1]][1:2]
  torch_major <- strsplit(torch_version, "\\.")[[1]][1:2]
  if (!identical(so_major, torch_major)) {
    warning(sprintf(
      "%s compiled against torch %s but running torch %s — ABI mismatch risk. Rebuild with: make -C sdmtorch clean all",
      so_label, so_version, torch_version
    ))
    return(invisible(FALSE))
  }
  invisible(TRUE)
}

# === Fused Elastic Net Regularization ===

fused_regularize_weights <- function(parameters, alpha, lambda) {
  weight_layers <- parameters[sapply(parameters, function(x) length(dim(x))) > 1]
  if (length(weight_layers) == 0) return(torch::torch_zeros(1L))
  dev <- weight_layers[[1]]$device
  l1_sum <- torch::torch_zeros(1L, device = dev)
  l2_sum <- torch::torch_zeros(1L, device = dev)
  for (w in weight_layers) {
    l1_sum <- l1_sum$add(torch::torch_norm(w, p = 1L))
    l2_sum <- l2_sum$add(torch::torch_norm(w, p = 2L))
  }
  ((1 - alpha) * l1_sum + alpha * l2_sum)$mul(lambda)
}

# === Fused Adam State Management ===

fused_adam_init <- function(params, lr = 0.01, betas = c(0.9, 0.999),
                            eps = 1e-8, weight_decay = 0) {
  dev <- if (length(params) > 0) params[[1]]$device else "cpu"
  list(
    params = params,
    lr = lr,
    b1 = betas[1],
    b2 = betas[2],
    eps = eps,
    weight_decay = weight_decay,
    exp_avgs = lapply(params, function(p) torch::torch_zeros_like(p)),
    exp_avg_sqs = lapply(params, function(p) torch::torch_zeros_like(p)),
    state_steps = lapply(params, function(p) {
      torch::torch_tensor(0L, dtype = torch::torch_int64(), device = p$device)
    })
  )
}

fused_adam_zero_grad <- function(state) {
  for (p in state$params) {
    g <- p$grad
    if (!is.null(g)) {
      tryCatch(g$zero_(), error = function(e) NULL)
    }
  }
}

fused_adam_step <- function(state) {
  params <- state$params
  grads <- lapply(params, function(p) p$grad)
  steps <- state$state_steps

  for (j in seq_along(steps)) steps[[j]]$add_(1L)

  # Custom Adam kernel via ATen ops — works on CPU/CUDA/MPS (no NaN on Blackwell)
  if (is.loaded("adam_step_direct", PACKAGE = "")) {
    .Call("adam_step_direct",
      params, grads,
      state$exp_avgs, state$exp_avg_sqs, steps,
      state$lr, state$b1, state$b2, state$eps, state$weight_decay
    )
  } else if (is.loaded("fused_adam_step_direct", PACKAGE = "")) {
    .Call("fused_adam_step_direct",
      params, grads,
      state$exp_avgs, state$exp_avg_sqs, steps,
      state$lr, state$b1, state$b2, state$eps, state$weight_decay
    )
  } else {
    fa <- get("torch__fused_adam_", envir = asNamespace("torch"))
    lr_t <- torch::torch_tensor(state$lr)
    fa(
      params, grads,
      state$exp_avgs, state$exp_avg_sqs, list(),
      steps,
      lr_t,
      state$b1, state$b2, state$weight_decay, state$eps,
      FALSE, FALSE
    )
  }
}

# === GC-Protected Training Loop with AMP + CUDA Graphs ===

train_model_fused <- function(model, epochs, device, train_dl, valid_dl = NULL,
                              verbose = TRUE,
                              accumulation_steps = 1L,
                              loss_record_interval = 10L) {
  model$net$to(device = device)
  model$net$train()
  model$successfull <- 1L

  .old_gc_threshold <- getOption("torch.threshold_call_gc", 4000L)
  options(torch.threshold_call_gc = Inf)
  on.exit(options(torch.threshold_call_gc = .old_gc_threshold), add = TRUE)

  # Optional GPU memory profiling — activated by SDM_GPU_PROFILE=true env var
  gpu_profile <- isTRUE(as.logical(Sys.getenv("SDM_GPU_PROFILE", "false")))
  if (gpu_profile && gpu_profile_start(TRUE)) {
    cat("[GPU Profile] Memory history recording started\n")
    on.exit(gpu_profile_stop(TRUE), add = TRUE)
  }

  opt_state <- fused_adam_init(
    model$net$parameters,
    lr = model$training_properties$lr,
    weight_decay = model$training_properties$lambda
  )

  scheduler <- NULL
  if (!is.null(model$training_properties$lr_scheduler)) {
    scheduler <- cito:::get_lr_scheduler(
      lr_scheduler = model$training_properties$lr_scheduler,
      optimizer = torch::optim_adam(model$net$parameters, lr = model$training_properties$lr)
    )
  }

  if (is.null(model$losses)) {
    model$losses <- data.frame(
      epoch = 1:epochs, train_l = NA_real_, valid_l = NA_real_
    )
  } else {
    start_epoch <- max(model$losses$epoch) + 1
    model$losses <- rbind(
      model$losses,
      data.frame(
        epoch = start_epoch:(start_epoch + epochs - 1),
        train_l = NA_real_, valid_l = NA_real_
      )
    )
  }

  loss.fkt <- model$loss$loss
  if (!is.null(model$loss$parameter)) {
    list2env(model$loss$parameter, envir = environment(fun = loss.fkt))
  }

  regularize <- !(model$training_properties$lambda == 0)
  best_train_loss <- Inf
  best_val_loss <- Inf
  counter <- 0L

  device_str <- if (inherits(device, "torch_device")) device$type else as.character(device)
  is_cuda <- startsWith(device_str, "cuda")

  gc(full = TRUE)
  if (is_cuda) {
    cuda_idx <- as.integer(sub("cuda:?", "", device_str))
    if (is.na(cuda_idx)) cuda_idx <- 0L
    tryCatch(.Call("_torch_cpp_cuda_synchronize", cuda_idx), error = function(e) NULL)
  }

  # Resolve mixed precision & CUDA Graphs settings
  mp_setting <- .train_opts$mixed_precision %||% "auto"
  cg_setting <- .train_opts$cuda_graphs %||% "auto"
  use_amp <- is_cuda && (identical(mp_setting, "auto") || isTRUE(mp_setting) || identical(mp_setting, "on"))
  use_cudagraphs <- is_cuda && (identical(cg_setting, "auto") || isTRUE(cg_setting) || identical(cg_setting, "on"))

  # Load CUDA Graphs .so if needed
  if (use_cudagraphs) {
    sdm_root <- if (exists("sdm_project_root", mode = "function")) sdm_project_root() else getwd()
    cg_so <- file.path(sdm_root, "sdmtorch", "cuda_graph.so")
    if (file.exists(cg_so) && !is.loaded("cuda_graph_begin", PACKAGE = "")) {
      tryCatch(dyn.load(cg_so, local = FALSE, now = TRUE), error = function(e) {
        use_cudagraphs <<- FALSE
      })
    } else if (!file.exists(cg_so)) {
      use_cudagraphs <<- FALSE
    }
  }

  # AMP scaler
  scaler <- NULL
  amp_pseudo_opt <- NULL
  if (use_amp) {
    scaler <- torch::cuda_amp_grad_scaler()
    amp_pseudo_opt <- structure(
      list(
        param_groups = list(
          list(params = NULL, has_sparse_grad = FALSE)
        ),
        state = list()
      ),
      class = "torch_optimizer"
    )
  }

  use_traced <- FALSE
  has_embeddings <- !is.null(model$training_properties$embeddings)
  traced_forward <- NULL
  if (!has_embeddings) {
    tryCatch({
      n_features <- as.integer(model$net[[1]]$in_features)
      example_input <- torch::torch_randn(1L, n_features, device = device)
      traced_module <- torch::jit_trace_module(
        model$net,
        forward = list(example_input)
      )
      traced_forward <- function(x) traced_module(x)
      use_traced <- TRUE
    }, error = function(e) {
      if (isTRUE(verbose) && device != "cpu") {
        cat("[GPU] JIT trace failed (NVRTC may be unavailable):", conditionMessage(e), "\n")
        cat("[GPU] Falling back to eager mode execution\n")
      }
    })
  }

  # CUDA Graphs: skip if model has stochastic elements (embeddings or dropout)
  has_dropout <- !is.null(model$training_properties$dropout) &&
    model$training_properties$dropout > 0
  use_cudagraphs <- use_cudagraphs && use_traced && !has_dropout

  acc_steps <- max(1L, as.integer(accumulation_steps)[1])
  start_epoch <- min(which(is.na(model$losses$train_l)))

  # Enable cuDNN autotuner for optimal kernel selection on cuDNN >= 7.6
  if (is_cuda) {
    tryCatch(torch::torch_backends_cudnn_benchmark(TRUE), error = function(e) NULL)
    tryCatch(torch::set_float32_matmul_precision("high"), error = function(e) NULL)
  }

  # GPU metrics tracking
  model$gpu_metrics <- list()

  # CUDA Graphs: setup non-default stream before epoch loop (required for graph capture)
  cg_stream_setup <- FALSE
  if (use_cudagraphs && is_cuda) {
    tryCatch({
      .Call("cuda_setup_graph_stream")
      cg_stream_setup <- TRUE
    }, error = function(e) {
      cat("[GPU] CUDA Graph stream setup failed, disabling CUDA Graphs:", conditionMessage(e), "\n")
      use_cudagraphs <<- FALSE
    })
  }

  for (epoch in start_epoch:(start_epoch + epochs - 1)) {
    epoch_start <- Sys.time()
    epoch_start_mem <- if (is_cuda) tryCatch(torch::cuda_memory_stats()$allocated_bytes$all$current %/% (1024L * 1024L), error = function(e) NA_integer_) else NA_integer_
    model$training_properties$epoch <- epoch

    # Materialize all batches once (avoids coro::loop overhead)
    train_batches <- coro::collect(train_dl)
    n_batches <- length(train_batches)
    train_l_vec <- numeric(n_batches)
    train_batch_idx <- 0L

    # CUDA Graph state
    cg_graph <- NULL
    cg_warmup <- 0L
    cg_captured <- FALSE
    cg_batches_this_epoch <- 0L

    for (batch_count in seq_len(n_batches)) {
      b <- train_batches[[batch_count]]

      if (batch_count %% acc_steps == 1L) {
        fused_adam_zero_grad(opt_state)
      }

      x_batch <- b[[1]]$to(device = device, non_blocking = TRUE)
      y_batch <- b[[2]]$to(device = device, non_blocking = TRUE)

      # CUDA Graphs: capture after 3 warmup steps
      can_use_graph <- use_cudagraphs && !cg_captured && cg_warmup >= 3L &&
        batch_count %% acc_steps == 1L
      if (can_use_graph) {
        cg_captured <- TRUE
        .Call("cuda_graph_begin", TRUE)
      }

      if (use_amp && is_cuda) {
        torch::with_autocast(device_type = "cuda", {
          if (use_traced) {
            output <- traced_forward(x_batch)
          } else if (!has_embeddings) {
            output <- model$net(x_batch)
          } else {
            output <- model$net(x_batch, b[[3]]$to(device = device, non_blocking = TRUE))
          }
          loss <- loss.fkt(output, y_batch)$mean()
        })
      } else {
        if (use_traced) {
          output <- traced_forward(x_batch)
        } else if (!has_embeddings) {
          output <- model$net(x_batch)
        } else {
          output <- model$net(x_batch, b[[3]]$to(device = device, non_blocking = TRUE))
        }
        loss <- loss.fkt(output, y_batch)$mean()
      }

      if (regularize) {
        reg_loss <- fused_regularize_weights(
          parameters = model$net$parameters,
          alpha = model$training_properties$alpha,
          lambda = model$training_properties$lambda
        )
        total_loss <- torch::torch_add(loss, reg_loss)
      } else {
        total_loss <- loss
      }

      if (has_embeddings) {
        for (ei in seq_along(model$training_properties$embeddings$dims)) {
          if (model$training_properties$embeddings$args[[ei]]$lambda > 0) {
            total_loss <- torch::torch_add(
              total_loss,
              fused_regularize_weights(
                model$net[[paste0("e_", ei)]]$parameters,
                lambda = model$training_properties$embeddings$args[[ei]]$lambda,
                alpha = model$training_properties$embeddings$args[[ei]]$alpha
              )
            )
          }
        }
      }

      if (acc_steps > 1L) total_loss <- total_loss$div(acc_steps)

      # Backward: scale if AMP
      if (use_amp && !is.null(scaler)) {
        scaler$scale(total_loss)$backward()
      } else {
        total_loss$backward()
      }

      if (batch_count %% acc_steps == 0L) {
        if (use_amp && !is.null(scaler)) {
          amp_pseudo_opt$param_groups[[1]]$params <- opt_state$params
          scaler$unscale_(amp_pseudo_opt)
        }
        fused_adam_step(opt_state)
        if (use_amp && !is.null(scaler)) scaler$update()
      }

      # Record loss (every loss_record_interval, always first 2)
      if (batch_count %% loss_record_interval == 0L || batch_count <= 2L) {
        train_batch_idx <- train_batch_idx + 1L
        train_l_vec[train_batch_idx] <- loss$item()
      }

      # CUDA Graphs: capture + replay for identical batches
      if (use_cudagraphs) {
        cg_batches_this_epoch <- cg_batches_this_epoch + 1L
        if (cg_captured && cg_batches_this_epoch == 2L) {
          cg_graph <- .Call("cuda_graph_end", TRUE)
        }
        if (!is.null(cg_graph) && cg_batches_this_epoch > 2L) {
          .Call("cuda_graph_replay", cg_graph)
        } else if (!cg_captured) {
          cg_warmup <- cg_warmup + 1L
        }
      }
    }

    # Final step for incomplete accumulation
    if (acc_steps > 1L && n_batches %% acc_steps != 0L) {
      if (use_amp && !is.null(scaler)) {
        amp_pseudo_opt$param_groups[[1]]$params <- opt_state$params
        scaler$unscale_(amp_pseudo_opt)
      }
      fused_adam_step(opt_state)
      if (use_amp && !is.null(scaler)) scaler$update()
    }

    # Clean up CUDA graph
    if (!is.null(cg_graph) && is.loaded("cuda_graph_cleanup", PACKAGE = "")) {
      tryCatch(.Call("cuda_graph_cleanup", cg_graph), error = function(e) NULL)
    }

    # Check NA using tracked value (avoid redundant loss$item() GPU sync)
    if (train_batch_idx > 0) {
      last_loss_val <- train_l_vec[train_batch_idx]
    } else {
      if (is_cuda) torch::cuda_synchronize()
      last_loss_val <- as.numeric(loss$item())
    }

    if (is.na(last_loss_val)) {
      if (verbose) cat("Loss is NA. Bad training.\n")
      model$successfull <- 0L
      break
    }

    model$losses$train_l[epoch] <- mean(train_l_vec[seq_len(train_batch_idx)])

    if (epoch >= model$burnin) {
      if (model$losses$train_l[epoch] > model$base_loss) {
        if (verbose) cat("Cancel training: loss above baseline.\n")
        model$successfull <- 0L
        break
      }
    }

    if (model$training_properties$validation != 0 && !is.null(valid_dl)) {
      model$net$train(FALSE)
      if (use_traced) traced_module$eval()

      valid_losses_vec <- numeric(length(valid_dl))
      valid_batch_idx <- 0L
      torch::with_no_grad({
        for (b in coro::collect(valid_dl)) {
          x_batch <- b[[1]]$to(device = device, non_blocking = TRUE)
          y_batch <- b[[2]]$to(device = device, non_blocking = TRUE)

          if (use_amp && is_cuda) {
            torch::with_autocast(device_type = "cuda", {
              if (use_traced) {
                output <- traced_forward(x_batch)
              } else if (!has_embeddings) {
                output <- model$net(x_batch)
              } else {
                output <- model$net(x_batch, b[[3]]$to(device = device, non_blocking = TRUE))
              }
              vloss <- loss.fkt(output, y_batch)$mean()
            })
          } else {
            if (use_traced) {
              output <- traced_forward(x_batch)
            } else if (!has_embeddings) {
              output <- model$net(x_batch)
            } else {
              output <- model$net(x_batch, b[[3]]$to(device = device, non_blocking = TRUE))
            }
            vloss <- loss.fkt(output, y_batch)$mean()
          }

          valid_batch_idx <- valid_batch_idx + 1L
          valid_losses_vec[valid_batch_idx] <- as.numeric(vloss$item())
        }
      })

      model$losses$valid_l[epoch] <- mean(valid_losses_vec[seq_len(valid_batch_idx)])

      model$net$train(TRUE)
      if (use_traced) traced_module$train()
    }

    if (!is.null(scheduler)) {
      if (model$training_properties$lr_scheduler$lr_scheduler == "reduce_on_plateau") {
        if (model$training_properties$validation != 0 && !is.null(valid_dl)) {
          scheduler$step(model$losses$valid_l[epoch])
        } else {
          scheduler$step(model$losses$train_l[epoch])
        }
      } else {
        scheduler$step()
      }
      opt_state$lr <- scheduler$optimizer$param_groups[[1]]$lr
    }

    if (verbose) {
      if (model$training_properties$validation != 0 && !is.null(valid_dl)) {
        cat(sprintf("Loss at epoch %d: training: %3.3f, validation: %3.3f, lr: %3.5f\n",
          epoch, model$losses$train_l[epoch], model$losses$valid_l[epoch],
          opt_state$lr))
      } else {
        cat(sprintf("Loss at epoch %d: %3f, lr: %3.5f\n",
          epoch, model$losses$train_l[epoch], opt_state$lr))
      }
    }

    if (model$training_properties$validation != 0 && !is.null(valid_dl)) {
      if (model$losses$valid_l[epoch] < best_val_loss) {
        best_val_loss <- model$losses$valid_l[epoch]
        model$weights[[1]] <- lapply(model$net$parameters,
          function(x) torch::as_array(x$to(device = "cpu")))
        counter <- 0L
      }
    } else {
      if (model$losses$train_l[epoch] < best_train_loss) {
        best_train_loss <- model$losses$train_l[epoch]
        model$weights[[1]] <- lapply(model$net$parameters,
          function(x) torch::as_array(x$to(device = "cpu")))
        counter <- 0L
      }
    }

    if (is.numeric(model$training_properties$early_stopping)) {
      if (counter >= model$training_properties$early_stopping) break
      counter <- counter + 1L
    }

    # Record per-epoch GPU metrics
    if (is_cuda) {
      epoch_end_mem <- tryCatch(torch::cuda_memory_stats()$allocated_bytes$all$current %/% (1024L * 1024L), error = function(e) NA_integer_)
      epoch_reserved <- tryCatch(torch::cuda_memory_stats()$reserved_bytes$all$current %/% (1024L * 1024L), error = function(e) NA_integer_)
      epoch_time_s <- as.numeric(difftime(Sys.time(), epoch_start, units = "secs"))
      n_samples <- n_batches * as.integer(model$training_properties$batchsize %||% 1L)
      model$gpu_metrics[[length(model$gpu_metrics) + 1L]] <- list(
        epoch = epoch,
        time_s = epoch_time_s,
        samples_per_sec = if (epoch_time_s > 0) n_samples / epoch_time_s else NA_real_,
        mem_allocated_mb = epoch_end_mem,
        mem_reserved_mb = epoch_reserved,
        mem_delta_mb = if (is.finite(epoch_start_mem) && is.finite(epoch_end_mem)) epoch_end_mem - epoch_start_mem else NA_integer_,
        amp_scale = if (use_amp && !is.null(scaler)) tryCatch(as.numeric(scaler$scale$item()), error = function(e) NA_real_) else NA_real_
      )
      if (is.finite(epoch_time_s) && epoch_time_s > 0) {
        cat(sprintf("  Epoch %d: %.1fs, %.0f samples/s, %d MiB\n",
          epoch, epoch_time_s, n_samples / epoch_time_s, epoch_end_mem %||% NA_integer_))
      }
    }
  }

  # Dump GPU profile snapshot if profiling was active
  gpu_profile_dump(gpu_profile, getwd())

  # Restore default CUDA stream after CUDA Graph capture
  if (cg_stream_setup) {
    tryCatch(.Call("cuda_graph_cleanup", NULL), error = function(e) NULL)
  }

  # Keep model on GPU for subsequent seeds; caller transfers to CPU when done
  model$weights[[2]] <- lapply(model$net$parameters,
    function(x) torch::as_array(x$to(device = "cpu")))
  if (!is.null(model$loss$parameter)) {
    model$parameter <- lapply(model$loss$parameter, cito:::cast_to_r_keep_dim)
  }
  model$use_model_epoch <- 1L
  model$loaded_model_epoch <- 1L
  if (!is.null(model$loss$parameter)) {
    model$loss$parameter_r <- unlist(lapply(model$loss$parameter,
      function(p) as.numeric(p$cpu())))
  }
  model$net$eval()

  model
}
