# SDM model comparison report engine.
# Takes two completed run results and produces structured comparison data.

compare_runs <- function(result1, result2) {
  stopifnot(is.list(result1), is.list(result2))

  # Model info comparison
  model1 <- list(
    id = result1$model_id %||% "unknown",
    label = result1$model_label %||% result1$model_id %||% "unknown",
    method = result1$model_method %||% ""
  )
  model2 <- list(
    id = result2$model_id %||% "unknown",
    label = result2$model_label %||% result2$model_id %||% "unknown",
    method = result2$model_method %||% ""
  )

  # Species
  species <- result1$config$species %||% result2$config$species %||% "unknown"
  same_species <- identical(
    tolower(trimws(result1$config$species %||% "")),
    tolower(trimws(result2$config$species %||% ""))
  )

  # Metrics comparison
  get_metric <- function(r, name) {
    if (!is.null(r$cv) && is.list(r$cv)) r$cv[[name]] %||% NA_real_ else NA_real_
  }

  metrics <- list(
    auc = list(
      model1 = get_metric(result1, "auc_mean"),
      model2 = get_metric(result2, "auc_mean"),
      diff = get_metric(result1, "auc_mean") - get_metric(result2, "auc_mean")
    ),
    tss = list(
      model1 = get_metric(result1, "tss_mean"),
      model2 = get_metric(result2, "tss_mean"),
      diff = get_metric(result1, "tss_mean") - get_metric(result2, "tss_mean")
    ),
    cv_strategy = list(
      model1 = result1$cv$strategy %||% "none",
      model2 = result2$cv$strategy %||% "none"
    ),
    cv_k = list(
      model1 = result1$cv$k %||% NA_integer_,
      model2 = result2$cv$k %||% NA_integer_
    )
  )

  # Variable importance comparison
  importance <- NULL
  imp1 <- result1$variable_importance
  imp2 <- result2$variable_importance

  if (is.data.frame(imp1) && is.data.frame(imp2) && nrow(imp1) > 0 && nrow(imp2) > 0) {
    merged <- merge(
      imp1[, c("variable", "importance")],
      imp2[, c("variable", "importance")],
      by = "variable", all = TRUE, suffixes = c("_model1", "_model2")
    )
    merged$importance_model1[is.na(merged$importance_model1)] <- 0
    merged$importance_model2[is.na(merged$importance_model2)] <- 0
    merged$diff <- merged$importance_model1 - merged$importance_model2
    merged <- merged[order(abs(merged$diff), decreasing = TRUE), , drop = FALSE]
    importance <- merged
  }

  # Response curves comparison (shared covariates only)
  response_curves <- NULL
  rc1 <- result1$response_curves
  rc2 <- result2$response_curves
  if (is.list(rc1) && is.list(rc2) && length(rc1) > 0 && length(rc2) > 0) {
    shared_vars <- intersect(names(rc1), names(rc2))
    if (length(shared_vars) > 0) {
      response_curves <- lapply(shared_vars, function(var) {
        df1 <- rc1[[var]]
        df2 <- rc2[[var]]
        if (!is.data.frame(df1) || !is.data.frame(df2) || nrow(df1) == 0 || nrow(df2) == 0) return(NULL)
        merged <- merge(
          df1[, c("value", "suitability")],
          df2[, c("value", "suitability")],
          by = "value", all = TRUE, suffixes = c("_model1", "_model2")
        )
        names(merged) <- c("value", model1$id, model2$id)
        list(covariate = var, points = merged)
      })
      names(response_curves) <- shared_vars
      response_curves <- Filter(Negate(is.null), response_curves)
    }
  }

  # Data comparison
  data_comp <- NULL
  occ1 <- result1$occurrence_used
  occ2 <- result2$occurrence_used
  if (is.data.frame(occ1) && is.data.frame(occ2)) {
    data_comp <- list(
      n_presences = list(model1 = nrow(occ1), model2 = nrow(occ2)),
      n_background = list(
        model1 = if (!is.null(result1$background_xy)) nrow(result1$background_xy) else NA_integer_,
        model2 = if (!is.null(result2$background_xy)) nrow(result2$background_xy) else NA_integer_
      )
    )
  }

  # Summary
  better_auc <- if (is.finite(metrics$auc$diff)) {
    if (metrics$auc$diff > 0) model1$label else if (metrics$auc$diff < 0) model2$label else "equal"
  } else "unknown"

  better_tss <- if (is.finite(metrics$tss$diff)) {
    if (metrics$tss$diff > 0) model1$label else if (metrics$tss$diff < 0) model2$label else "equal"
  } else "unknown"

  list(
    species = species,
    same_species = same_species,
    models = list(
      model1 = model1,
      model2 = model2
    ),
    metrics = metrics,
    data = data_comp,
    importance = importance,
    response_curves = response_curves,
    summary = list(
      better_auc = better_auc,
      better_tss = better_tss,
      n_shared_vars = if (is.data.frame(importance)) nrow(importance) else 0
    )
  )
}

format_comparison_text <- function(comp) {
  lines <- c(
    paste0("SDM Comparison Report: ", comp$species),
    paste0("  ", comp$models$model1$label, " vs ", comp$models$model2$label),
    "",
    "Metrics:",
    paste0("  AUC: ", sprintf("%.3f", comp$metrics$auc$model1), " vs ", sprintf("%.3f", comp$metrics$auc$model2),
      " (diff: ", sprintf("%+.3f", comp$metrics$auc$diff), ")"),
    paste0("  TSS: ", sprintf("%.3f", comp$metrics$tss$model1), " vs ", sprintf("%.3f", comp$metrics$tss$model2),
      " (diff: ", sprintf("%+.3f", comp$metrics$tss$diff), ")"),
    paste0("  Better AUC: ", comp$summary$better_auc),
    paste0("  Better TSS: ", comp$summary$better_tss),
    ""
  )
  if (!is.null(comp$data)) {
    lines <- c(lines,
      "Data:",
      paste0("  Presences: ", comp$data$n_presences$model1, " vs ", comp$data$n_presences$model2),
      paste0("  Background: ", comp$data$n_background$model1, " vs ", comp$data$n_background$model2),
      ""
    )
  }
  if (is.data.frame(comp$importance) && nrow(comp$importance) > 0) {
    lines <- c(lines,
      "Variable importance divergence (top 5):",
      paste0("  Variable | ", comp$models$model1$id, " | ", comp$models$model2$id, " | Diff"),
      apply(head(comp$importance, 5), 1, function(row) {
        sprintf("  %s | %.3f | %.3f | %+.3f", row["variable"], as.numeric(row["importance_model1"]),
          as.numeric(row["importance_model2"]), as.numeric(row["diff"]))
      }),
      ""
    )
  }
  paste(lines, collapse = "\n")
}
