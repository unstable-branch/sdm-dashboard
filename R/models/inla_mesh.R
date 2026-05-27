# INLA mesh builder utility for spatial SDM.

build_inla_mesh <- function(coords, max_edge_inner = NULL, max_edge_outer = NULL,
                            cutoff = NULL, offset_inner = NULL, offset_outer = NULL,
                            crs = NULL) {
  coords <- as.matrix(coords[, c("x", "y")])
  coords <- coords[stats::complete.cases(coords), , drop = FALSE]
  if (nrow(coords) < 5) stop("At least 5 coordinate pairs are needed for mesh construction.", call. = FALSE)

  x_range <- diff(range(coords[, 1]))
  y_range <- diff(range(coords[, 2]))
  approx_range <- sqrt(x_range * y_range) / 3

  if (is.null(max_edge_inner)) max_edge_inner <- approx_range / 10
  if (is.null(max_edge_outer)) max_edge_outer <- approx_range / 3
  if (is.null(cutoff)) cutoff <- max_edge_inner / 5
  if (is.null(offset_inner)) offset_inner <- approx_range / 10
  if (is.null(offset_outer)) offset_outer <- approx_range / 3

  mesh <- INLA::inla.mesh.2d(
    loc = coords,
    max.edge = c(max_edge_inner, max_edge_outer),
    cutoff = cutoff,
    offset = c(offset_inner, offset_outer),
    crs = crs
  )
  mesh
}

build_spde_model <- function(mesh, prior_range = NULL, prior_sigma = NULL,
                             alpha = 2) {
  if (is.null(prior_range)) {
    xr <- diff(range(mesh$loc[, 1]))
    yr <- diff(range(mesh$loc[, 2]))
    approx_range <- sqrt(xr * yr) / 3
    prior_range <- c(approx_range, 0.5)
  }
  if (is.null(prior_sigma)) prior_sigma <- c(2, 0.01)

  spde <- INLA::inla.spde2.pcmatern(
    mesh = mesh,
    alpha = alpha,
    prior.range = prior_range,
    prior.sigma = prior_sigma
  )
  spde
}

make_inla_mesh_projector <- function(mesh, pred_coords) {
  INLA::inla.mesh.projector(mesh, loc = as.matrix(pred_coords))
}

summarise_mesh <- function(mesh) {
  list(
    n_vertices = mesh$n,
    n_triangles = nrow(mesh$graph$tv),
    max_edge = max(mesh$edge_lengths),
    min_edge = min(mesh$edge_lengths[mesh$edge_lengths > 0]),
    bbox = apply(mesh$loc[, 1:2], 2, range)
  )
}
