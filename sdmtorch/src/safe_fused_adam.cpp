// Fused Adam step — calls torch's own registered .Call function directly.
// Completely bypasses the need to extract XPtrTorch handles or call
// lantern function pointers. Relies on torch's own type-wrapping code
// (call_c_function equivalent built into the .Call target).

#include <Rcpp.h>
#include <dlfcn.h>
#include <R_ext/Rdynload.h>

using namespace Rcpp;

extern "C" {

SEXP safe_fused_adam(SEXP params_xptr_list, SEXP grads_xptr_list,
                     SEXP exp_avgs_xptr_list, SEXP exp_avg_sqs_xptr_list,
                     SEXP state_steps_xptr_list,
                     SEXP lr_val, SEXP b1_val, SEXP b2_val,
                     SEXP eps_val, SEXP wd_val,
                     SEXP cuda_device) {
  
  // Resolve the torch .Call function once
  // We use the lr=double variant (lr is a raw double, matching our R call)
  static const char* SYM_NAME =
    "_torch_cpp_torch_namespace__fused_adam__self_TensorList_grads_TensorList"
    "_exp_avgs_TensorList_exp_avg_sqs_TensorList_max_exp_avg_sqs_TensorList"
    "_state_steps_TensorList_lr_double_beta1_double_beta2_double"
    "_weight_decay_double_eps_double_amsgrad_bool_maximize_bool";
  
  static DL_FUNC fn_ptr = NULL;
  if (!fn_ptr) {
    fn_ptr = R_FindSymbol(SYM_NAME, "torchpkg", NULL);
    if (!fn_ptr) {
      // Fallback: search all DLLs
      fn_ptr = R_FindSymbol(SYM_NAME, "", NULL);
    }
    if (!fn_ptr) {
      Rcpp::stop("Cannot find torch fused_adam .Call symbol");
    }
    Rprintf("safe_fused_adam: resolved fn_ptr=%p\n", (void*)fn_ptr);
  }
  
  // CUDA sync before fused_adam
  int dev = as<int>(cuda_device);
  if (dev >= 0) {
    static DL_FUNC sync_fn = NULL;
    if (!sync_fn) {
      sync_fn = R_FindSymbol("_torch_cpp_cuda_synchronize", "torchpkg", NULL);
    }
    if (sync_fn) {
      ((void(*)(int))sync_fn)(dev);
    }
  }
  
  // Build an empty TensorList for max_exp_avg_sqs (AMSGrad not used)
  // We need to pass it as an R list — torch's call_c_function handles
  // wrapping into XPtrTorchTensorList internally.
  SEXP empty_list = PROTECT(Rf_allocVector(VECSXP, 0));
  
  // lr is already an R numeric (double) passed from R, not a tensor
  // torch's .Call function handles the XPtrTorchdouble wrapping internally
  
  // Call fused_adam. Arguments match the .Call registered signature:
  //  (list, list, list, list, list, list, double, double, double, double, double, bool, bool)
  // Missing grad_scale & found_inf have defaults in the C++ function.
  SEXP result = ((SEXP(*)(SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP,SEXP))fn_ptr)(
    params_xptr_list, grads_xptr_list, 
    exp_avgs_xptr_list, exp_avg_sqs_xptr_list,
    empty_list, state_steps_xptr_list,
    lr_val, b1_val, b2_val, wd_val, eps_val,
    Rf_ScalarLogical(FALSE), Rf_ScalarLogical(FALSE)
  );
  
  UNPROTECT(1);
  return result;
}

} // extern "C"
