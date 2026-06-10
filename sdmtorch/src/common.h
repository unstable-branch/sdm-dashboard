#pragma once

// Shared tensor extraction utilities for sdmtorch C++ extensions.
// Extracts at::Tensor from R torch external pointers (XPtrTorch*).
//
// Memory layout (confirmed by diag_extptr):
//   R_ExternalPtrAddr → XPtrTorchTensor* (16 bytes = shared_ptr<void>)
//   offset[0] = shared_ptr::_M_ptr = managed pointer = at::Tensor*

#include <RcppCommon.h>
#include <ATen/ATen.h>
#include <Rcpp.h>

inline at::Tensor extract_tensor(SEXP xptr) {
  if (TYPEOF(xptr) != EXTPTRSXP)
    Rcpp::stop("Expected external pointer");
  void* raw = R_ExternalPtrAddr(xptr);
  if (!raw) Rcpp::stop("NULL tensor pointer");
  at::Tensor* t = static_cast<at::Tensor*>(*static_cast<void**>(raw));
  if (!t) Rcpp::stop("NULL tensor handle in XPtrTorch");
  return *t;
}

inline std::vector<at::Tensor> extract_list(SEXP list_sexp) {
  Rcpp::List xptrs(list_sexp);
  int n = xptrs.size();
  std::vector<at::Tensor> tensors;
  tensors.reserve(n);
  for (int i = 0; i < n; i++)
    tensors.push_back(extract_tensor((SEXP)xptrs[i]));
  return tensors;
}
