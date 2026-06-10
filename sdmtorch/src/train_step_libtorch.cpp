#include <RcppCommon.h>
#include <ATen/ATen.h>
#include <Rcpp.h>
#include "common.h"

extern "C" {

// Fused Adam step using libtorch's at::_ops::_fused_adam_::call dispatch.
// Uses the bundled _fused_adam_ CUDA/CPU kernel.
// NOTE: CUDA kernel produces NaN on Blackwell GPUs (compute 12.0).
// Use train_step_adam.so (custom ATen-op kernel) for GPU instead.
SEXP fused_adam_step_direct(SEXP params_xptr, SEXP grads_xptr,
                             SEXP exp_avgs_xptr, SEXP exp_avg_sqs_xptr,
                             SEXP state_steps_xptr,
                             SEXP lr_, SEXP b1_, SEXP b2_,
                             SEXP eps_, SEXP weight_decay_) {
  try {
    at::_ops::_fused_adam_::call(
      extract_list(params_xptr),
      extract_list(grads_xptr),
      extract_list(exp_avgs_xptr),
      extract_list(exp_avg_sqs_xptr),
      std::vector<at::Tensor>{},
      extract_list(state_steps_xptr),
      Rcpp::as<double>(lr_),
      Rcpp::as<double>(b1_),
      Rcpp::as<double>(b2_),
      Rcpp::as<double>(weight_decay_),
      Rcpp::as<double>(eps_),
      false, false, {}, {}
    );
  } catch (std::exception& ex) {
    Rcpp::stop(std::string("fused_adam_step_direct: ") + ex.what());
  }
  return R_NilValue;
}

} // extern "C"
