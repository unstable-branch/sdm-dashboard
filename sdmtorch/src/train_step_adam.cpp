#include <RcppCommon.h>
#include <ATen/ATen.h>
#include <ATen/core/grad_mode.h>
#include <Rcpp.h>
#include <cmath>
#include "common.h"

extern "C" {

// Custom Adam / AdamW step using standard ATen ops.
// Replaces _fused_adam_ CUDA kernel which produces NaN on Blackwell GPUs.
// When use_adamw=TRUE applies decoupled weight decay (AdamW):
//   param -= lr * wd * param  (before momentum update)
// When use_adamw=FALSE applies L2-style weight decay:
//   grad += wd * param        (L2 regularization)
SEXP adam_step_direct(SEXP params_, SEXP grads_,
                       SEXP exp_avgs_, SEXP exp_avg_sqs_,
                       SEXP state_steps_,
                       SEXP lr_, SEXP b1_, SEXP b2_,
                       SEXP eps_, SEXP wd_,
                       SEXP use_adamw_) {
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
    bool use_adamw = Rcpp::as<bool>(use_adamw_);

    int n = params.size();
    for (int i = 0; i < n; i++) {
      at::Tensor& p = params[i];
      at::Tensor& g = grads[i];
      at::Tensor& ea = eavgs[i];
      at::Tensor& es = esqs[i];
      at::Tensor& st = steps[i];

      // item() handles device-to-host copy (required for CUDA tensors)
      int64_t step = st.item<int64_t>();
      if (step < 1) {
        Rcpp::stop("adam_step_direct: step counter must be >= 1 (got %lld)", (long long)step);
      }

      // Disable autograd for in-place optimizer updates
      at::NoGradGuard no_grad;

      if (use_adamw && wd != 0.0) {
        // AdamW: decoupled weight decay — apply directly to param before momentum
        p.mul_(1.0 - lr * wd);
      }

      // Gradient with optional L2-style weight decay (only when NOT using AdamW)
      at::Tensor g_adj = g;
      if (!use_adamw && wd != 0.0) {
        g_adj = g + wd * p;
      }

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
