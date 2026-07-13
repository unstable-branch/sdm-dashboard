#pragma once

// Shared tensor extraction utilities for sdmtorch C++ extensions.
// Extracts at::Tensor from R torch external pointers (XPtrTorch*).
//
// Memory layout (confirmed by diag_extptr):
//   R_ExternalPtrAddr → XPtrTorchTensor* (16 bytes = shared_ptr<void>)
//   offset[0] = shared_ptr::_M_ptr = managed pointer = at::Tensor*
//
// NOTE: This couples to the torch R package's internal XPtrTorchTensor
// layout, which is NOT a public API. If torch R package is upgraded,
// rebuild sdmtorch with: make -C sdmtorch clean all

#include <RcppCommon.h>
#include <ATen/ATen.h>
#include <Rcpp.h>

// Compile-time torch version hash for ABI compatibility checks.
// Set at build time via -DSDMTORCH_TORCH_VERSION="x.y.z"
#ifndef SDMTORCH_TORCH_VERSION
#define SDMTORCH_TORCH_VERSION "unknown"
#endif

// Sentinel value to validate layout assumption.
// Must not conflict with valid at::Tensor* alignment (16-byte).
static constexpr uintptr_t XPTR_SENTINEL = 0x53444D544F524348ULL;

inline at::Tensor extract_tensor(SEXP xptr) {
  if (TYPEOF(xptr) != EXTPTRSXP)
    Rcpp::stop("Expected external pointer");
  void* raw = R_ExternalPtrAddr(xptr);
  if (!raw) Rcpp::stop("NULL tensor pointer");
  uintptr_t first_word = *static_cast<uintptr_t*>(raw);
  if (first_word == XPTR_SENTINEL)
    Rcpp::stop("XPtrTorch layout mismatch — sentinel at offset 0 means shared_ptr::_M_ptr is NOT at offset 0");
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
