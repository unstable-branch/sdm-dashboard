## Biomod2 modelling wrapper ---------------------------------------------------
## This module centralises all calls to the biomod2 package. It receives the
## selected biomod2 algorithms (as a character vector), the prepared predictor
## raster stack and the occurrence data, builds the BIOMOD_FormatingData
## object, runs the models, and optionally attaches the external range‑bagging
## predictions.

#' Run biomod2 modelling
#'
#' @param occ_df Data frame with columns `longitude`, `latitude` and optionally
#'   `species`. Must contain presence records (presence‑only workflow).
#' @param pred_stack terra SpatRaster stack of all covariates (climate,
#'   elevation, soil layers, etc.).
#' @param models Character vector of biomod2 algorithm names to run. Defaults
#'   to config$biomod2_default if NULL.
#' @param background_n Number of background points to use for PA generation.
#' @param cv_folds Number of cross-validation folds.
#' @param use_rangebag Logical – whether to include the custom range‑bagging
#'   model in the ensemble (default FALSE).
#' @return A list containing the BIOMOD_FormatingData object, the BIOMOD_Modeling
#'   result and, if requested, the range‑bagging predictions.
#' @export
run_biomod2 <- function(occ_df, pred_stack, models = NULL,
                       background_n = 1000, cv_folds = 3,
                       use_rangebag = FALSE) {
  if (is.null(models)) {
    models <- config$biomod2_default
  }

  sp_name <- if (!is.null(occ_df$species)) occ_df$species[1] else 'species'

  # Generate pseudo-absences using terra (manual approach for biomod2 4.x compatibility)
  set.seed(sdm_default_seed)
  pa_points <- terra::spatSample(pred_stack, size = background_n,
                                  method = "random", na.rm = TRUE,
                                  as.points = TRUE, xy = TRUE)

  if (is.null(pa_points) || terra::nrow(pa_points) == 0) {
    stop("Failed to generate pseudo-absence points for biomod2")
  }

  # Get PA coordinates - explicit data frame creation
  pa_df <- as.data.frame(pa_points)
  pa_xy <- data.frame(
    longitude = pa_df$x,
    latitude = pa_df$y
  )

  # Explicit pres_xy creation
  pres_xy <- data.frame(
    longitude = occ_df$longitude,
    latitude = occ_df$latitude
  )

  # Now rbind should work
  all_xy <- rbind(pres_xy, pa_xy)
  all_response <- c(rep(1, nrow(occ_df)), rep(0, nrow(pa_xy)))

  biomod_data <- biomod2::BIOMOD_FormatingData(
    resp.var = all_response,
    expl.var = pred_stack,
    resp.name = sp_name,
    resp.xy = all_xy,
    na.rm = TRUE
  )

  # ---------------------------------------------------------------
  # 2. Run selected biomod2 models
  # ---------------------------------------------------------------
  # Set modeling options with explicit strategy (required in biomod2 v4.2+)
  bm_opts <- biomod2::bm_ModelingOptions(
    bm.format = biomod_data,
    strategy = "default"
  )
  biomod_mod <- biomod2::BIOMOD_Modeling(
    bm.format = biomod_data,
    models = models,
    modeling.id = 'sdm_dash',
    CV.strategy = "random",
    CV.perc = 0.7,
    OPT.strategy = "default",
    OPT.user = bm_opts
  )

  # ---------------------------------------------------------------
  # 3. Optional range‑bagging integration
  # ---------------------------------------------------------------
  rangebag_pred <- NULL
  if (use_rangebag) {
    rangebag_file <- "R/model_rangebag.R"
    if (file.exists(rangebag_file)) {
      source(rangebag_file, local = TRUE)
      if (exists("run_rangebag", where = .GlobalEnv) || exists("run_rangebag")) {
        rangebag_pred <- run_rangebag(occ_df, pred_stack, background_n = background_n, cv_folds = cv_folds)
      }
    }
  }

  list(
    data = biomod_data,
    model = biomod_mod,
    rangebag = rangebag_pred,
    cv_folds = cv_folds,
    background_n = background_n
  )
}