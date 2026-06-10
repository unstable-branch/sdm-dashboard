#include <RcppCommon.h>
#include <ATen/ATen.h>
#include <Rcpp.h>

at::Tensor extract_tensor(SEXP xptr) {
  if (TYPEOF(xptr) != EXTPTRSXP)
    Rcpp::stop("Expected external pointer");
  void* raw = R_ExternalPtrAddr(xptr);
  if (!raw) Rcpp::stop("NULL tensor pointer");
  at::Tensor* t = static_cast<at::Tensor*>(*static_cast<void**>(raw));
  if (!t) Rcpp::stop("NULL tensor handle in XPtrTorch");
  return *t;
}

std::vector<at::Tensor> extract_list(SEXP list_sexp) {
  Rcpp::List xptrs(list_sexp);
  int n = xptrs.size();
  std::vector<at::Tensor> tensors;
  tensors.reserve(n);
  for (int i = 0; i < n; i++)
    tensors.push_back(extract_tensor((SEXP)xptrs[i]));
  return tensors;
}

extern "C" {

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
