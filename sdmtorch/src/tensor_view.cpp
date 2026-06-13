#include <Rcpp.h>
#include <ATen/ATen.h>
#include "common.h"

// Zero-copy tensor view into an R matrix.
//
// R matrices are stored in column-major order (Fortran layout) with
// double-precision values. This function creates a torch tensor that
// views the existing R memory without copying or reordering.
//
// The resulting tensor has:
//   shape  = [nrow, ncol]
//   strides = [1, nrow]   (column-major — R's native layout)
//   dtype  = float64
//
// For GPU transfer, use tensor_view_to_contiguous() which does the reorder
// and H2D transfer in one operation. For CPU-only use, access via R's
// torch package by wrapping the external pointer.
//
// WARNING: The tensor shares memory with the R matrix. If R's garbage
// collector moves or frees the matrix, the tensor becomes a dangling pointer.
// as_tensor_view calls R_PreserveObject to prevent GC during use.

extern "C" {

SEXP as_tensor_view(SEXP r_matrix) {
  if (!Rf_isMatrix(r_matrix))
    Rcpp::stop("Input must be a matrix");
  if (TYPEOF(r_matrix) != REALSXP)
    Rcpp::stop("Matrix must be numeric (double)");

  SEXP dim = Rf_getAttrib(r_matrix, R_DimSymbol);
  int nrow = INTEGER(dim)[0];
  int ncol = INTEGER(dim)[1];
  double* data = REAL(r_matrix);

  auto tensor = at::from_blob(data, {nrow, ncol}, {1, nrow}, at::kDouble);

  auto* shared = new at::Tensor(tensor);
  SEXP xp = R_MakeExternalPtr(shared, R_NilValue, r_matrix);
  PROTECT(xp);
  R_RegisterCFinalizerEx(xp, [](SEXP xp) {
    auto* t = static_cast<at::Tensor*>(R_ExternalPtrAddr(xp));
    if (t) { delete t; R_SetExternalPtrAddr(xp, NULL); }
  }, TRUE);
  R_PreserveObject(r_matrix);
  UNPROTECT(1);
  return xp;
}

// Convert a column-major tensor view to a contiguous row-major tensor,
// optionally on a target device (e.g., "cuda"). Returns a new tensor.
SEXP tensor_view_to_device(SEXP view_xptr, SEXP device_sexp) {
  auto* t = static_cast<at::Tensor*>(R_ExternalPtrAddr(view_xptr));
  if (!t) Rcpp::stop("NULL tensor view");
  
  std::string device_str = Rcpp::as<std::string>(device_sexp);
  at::Tensor result;
  if (device_str == "cpu" || device_str.empty()) {
    result = t->contiguous().to(at::kFloat);
  } else {
    result = t->contiguous().to(at::kFloat).to(device_str, true);
  }
  
  auto* shared = new at::Tensor(result);
  SEXP xp = R_MakeExternalPtr(shared, R_NilValue, R_NilValue);
  PROTECT(xp);
  R_RegisterCFinalizerEx(xp, [](SEXP xp) {
    auto* p = static_cast<at::Tensor*>(R_ExternalPtrAddr(xp));
    if (p) { delete p; R_SetExternalPtrAddr(xp, NULL); }
  }, TRUE);
  UNPROTECT(1);
  return xp;
}

} // extern "C"

