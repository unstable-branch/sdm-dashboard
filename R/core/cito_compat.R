sdm_cito_version <- function() {
  tryCatch(as.character(packageVersion("cito")), error = function(e) NA_character_)
}

sdm_cito_train_model_name <- function() {
  cito_ns <- asNamespace("cito")
  for (nm in c("train_model", "train_dnn", "fit_model")) {
    if (exists(nm, envir = cito_ns, inherits = FALSE)) return(nm)
  }
  NULL
}

sdm_cast_to_r_keep_dim <- function(x) {
  arr <- as.array(x$cpu())
  dn <- x$dimnames
  if (!is.null(dn)) {
    dimnames(arr) <- dn
  }
  arr
}

sdm_get_lr_scheduler <- function(lr_scheduler, optimizer) {
  if (is.null(lr_scheduler) || identical(lr_scheduler, "none")) return(NULL)
  sched_type <- tryCatch(class(lr_scheduler)[1], error = function(e) NA_character_)
  if (is.na(sched_type)) return(NULL)
  if (identical(sched_type, "torch_lr_scheduler")) {
    lr_scheduler
  } else if (is.character(lr_scheduler)) {
    switch(lr_scheduler,
      step = torch::lr_step(optimizer, step_size = 1),
      exponential = torch::lr_exponential(optimizer, gamma = 0.99),
      cosine = torch::lr_cosineAnnealing(optimizer, T_max = 100),
      plateau = torch::lr_reduce_on_plateau(optimizer, mode = "min", factor = 0.1, patience = 10),
      NULL
    )
  } else {
    NULL
  }
}
