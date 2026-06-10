#include <RcppCommon.h>
#include <ATen/ATen.h>
#include <ATen/core/grad_mode.h>
#include <Rcpp.h>
#include <cmath>
#include "common.h"

extern "C" {

// Custom Adam step using standard ATen ops.
// Replaces _fused_adam_ CUDA kernel which produces NaN on Blackwell GPUs.
// These ATen ops auto-dispatch to CPU/CUDA and work correctly everywhere.
SEXP adam_step_direct(SEXP params_, SEXP grads_,
                       SEXP exp_avgs_, SEXP exp_avg_sqs_,
                       SEXP state_steps_,
                       SEXP lr_, SEXP b1_, SEXP b2_,
                       SEXP eps_, SEXP wd_) {
  try {
    auto params = extract_list(params_);
    auto grads = extract_list(grads_);
    auto eavgs = extract_list(exp_avgs_);
    auto esqs = extract_list(exp_avg_sqs_);
    auto steps = extract_list(state_steps_);

    double lr = Rcpp::as<double>(lr_);
    double b1 = Rcpp::as<double>(b1_);
    double b2 = Rcpp::as<double>(b2_);
    double eps = Rcpp::as<double>(eps_);
    double wd = Rcpp::as<double>(wd_);

    int n = params.size();
    for (int i = 0; i < n; i++) {
      at::Tensor& p = params[i];
      at::Tensor& g = grads[i];
      at::Tensor& ea = eavgs[i];
      at::Tensor& es = esqs[i];
      at::Tensor& st = steps[i];

      // item() handles device-to-host copy (required for CUDA tensors)
      int64_t step = st.item<int64_t>();

      // Gradient with weight decay (L2 regularization)
      at::Tensor g_adj = g;
      if (wd != 0.0) {
        g_adj = g + wd * p;
      }

      // Disable autograd for in-place optimizer updates
      at::NoGradGuard no_grad;

      // Update biased first moment estimate
      ea.mul_(b1).add_(g_adj, 1.0 - b1);

      // Update biased second raw moment estimate
      es.mul_(b2).addcmul_(g_adj, g_adj, 1.0 - b2);

      // Bias correction and step size
      double bc1 = 1.0 - std::pow(b1, step);
      double bc2 = 1.0 - std::pow(b2, step);
      double step_size = lr / bc1;

      // denom = sqrt(exp_avg_sq) / sqrt(bc2) + eps
      auto denom = at::sqrt(es).div_(std::sqrt(bc2)).add_(eps);

      // param -= step_size * exp_avg / denom
      p.addcdiv_(ea, denom, -step_size);
    }
  } catch (std::exception& ex) {
    Rcpp::stop(std::string("adam_step_direct: ") + ex.what());
  }
  return R_NilValue;
}

} // extern "C"
