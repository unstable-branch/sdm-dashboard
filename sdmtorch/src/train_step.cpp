// Fused training step for SDM DNN training.
// Calls the lantern _fused_adam_ function directly from C++ to eliminate
// all R-level wrapping overhead. Function pointers are resolved once from
// torchpkg's BSS globals (initialized by _lantern_init when torch loads).
//
// Sequence: tensor extptr → XPtrTorchTensor* → .get() → lantern handle
// R_ExternalPtrAddr gives XPtrTorchTensor* (confirmed by diag_extptr).

#include <Rcpp.h>
#include <dlfcn.h>
#include <cstdint>
#include <torch_types.h>
#include <R_ext/Print.h>

#define DBG(fmt, ...) do { Rprintf("DBG " fmt "\n", ##__VA_ARGS__); R_FlushConsole(); } while(0)

// Extract lantern void* handle from an R torch tensor (external pointer).
// Memory layout (confirmed by diag_extptr): external pointer stores
// XPtrTorchTensor* (16-byte shared_ptr object). .get() returns the
// managed pointer which is the actual lantern tensor handle.
inline void* xptr_addr(SEXP s, const char* label = "") {
  if (TYPEOF(s) != EXTPTRSXP)
    Rcpp::stop("xptr_addr(%s): not an EXTPTRSXP", label);
  void* raw = R_ExternalPtrAddr(s);
  if (!raw) Rcpp::stop("xptr_addr(%s): NULL external pointer", label);
  XPtrTorch* xptr = static_cast<XPtrTorch*>(raw);
  void* handle = xptr->get();
  return handle;
}

struct Lantern {
  void* handle;
  void* (*TensorList)();
  void  (*TensorList_push_back)(void*, void*);
  void  (*TensorList_delete)(void*);
  void* (*double_)(double);
  void  (*double_delete)(void*);
  void* (*bool_)(bool);
  void  (*bool_delete)(void*);
  void  (*cuda_synchronize)(int);
  void  (*Tensor_delete)(void*);
  void* (*fused_adam)(void*, void*, void*, void*, void*, void*,
                       void*, void*, void*, void*, void*, void*,
                       void*, void*, void*);
};

static Lantern L = {NULL};

static void ensure_lantern(const char* path) {
  if (L.handle) return;
  DBG("dlopen liblantern: %s", path);
  L.handle = dlopen(path, RTLD_LAZY | RTLD_LOCAL);
  if (!L.handle)
    Rcpp::stop(std::string("Cannot load liblantern.so: ") + dlerror());

  // Get torchpkg path from R (already loaded by dyn.load)
  Rcpp::Environment torch_ns("package:torch");
  Rcpp::Function system_file = Rcpp::Environment::base_env()["system.file"];
  SEXP tpkg_sexp = system_file("libs", "torchpkg.so", Rcpp::Named("package", "torch"));
  std::string tpkg_path = Rcpp::as<std::string>(tpkg_sexp);
  DBG("torchpkg path: %s", tpkg_path.c_str());
  void* tpkg = dlopen(tpkg_path.c_str(), RTLD_LAZY | RTLD_NOLOAD);
  DBG("tpkg handle: %p", tpkg);

  // Read function pointer values from torchpkg's globals
  auto get_fn = [tpkg](const char* name) -> void* {
    if (!tpkg) return NULL;
    void** ptr = (void**)dlsym(tpkg, name);
    void* val = ptr ? *ptr : NULL;
    Rprintf("  %s -> addr=%p val=%p\n", name, (void*)ptr, val);
    return val;
  };

  L.TensorList         = (void*(*)())get_fn("_lantern_TensorList");
  L.TensorList_push_back = (void(*)(void*,void*))get_fn("_lantern_TensorList_push_back");
  L.TensorList_delete  = (void(*)(void*))get_fn("_lantern_TensorList_delete");
  L.double_            = (void* (*)(double))get_fn("_lantern_double");
  L.double_delete      = (void(*)(void*))get_fn("_lantern_double_delete");
  L.bool_              = (void* (*)(bool))get_fn("_lantern_bool");
  L.bool_delete        = (void(*)(void*))get_fn("_lantern_bool_delete");
  L.cuda_synchronize   = (void(*)(int))get_fn("_lantern_cuda_synchronize");
  L.Tensor_delete      = (void(*)(void*))get_fn("_lantern_Tensor_delete");
  L.fused_adam         = (void*(*)(void*,void*,void*,void*,void*,void*,
                                    void*,void*,void*,void*,void*,void*,
                                    void*,void*,void*))get_fn(
    "_lantern__fused_adam__tensorlist_tensorlist_tensorlist_tensorlist_tensorlist_tensorlist_double_double_double_double_double_bool_bool_tensor_tensor");
  // Also try the lr=Tensor variant
  // L.fused_adam is set above. We keep the double variant for now.
  if (!L.TensorList || !L.TensorList_push_back || !L.double_ || !L.bool_ || !L.fused_adam) {
    Rcpp::Rcerr << "lantern init failed. tpkg=" << tpkg << std::endl;
    Rcpp::Rcerr << "  _lantern_TensorList=" << (void*)(void*)L.TensorList << std::endl;
    Rcpp::Rcerr << "  _lantern_double=" << (void*)(void*)L.double_ << std::endl;
    Rcpp::Rcerr << "  _lantern_bool=" << (void*)(void*)L.bool_ << std::endl;
    Rcpp::Rcerr << "  _lantern_fused_adam=" << (void*)(void*)L.fused_adam << std::endl;
    Rcpp::stop("Could not resolve lantern function pointers from torchpkg");
  }
  DBG("lantern init OK");
}

extern "C" {

SEXP fused_adam_step_cpp(SEXP params_xptr_list, SEXP grads_xptr_list,
                          SEXP exp_avgs_xptr_list, SEXP exp_avg_sqs_xptr_list,
                          SEXP state_steps_xptr_list,
                          SEXP lr, SEXP b1, SEXP b2, SEXP eps, SEXP weight_decay,
                          SEXP cuda_device) {
  // Find liblantern path via R on first call
  if (!L.handle) {
    Rcpp::Environment torch_ns("package:torch");
    Rcpp::Function system_file = Rcpp::Environment::base_env()["system.file"];
    SEXP path_sexp = system_file("lib", "liblantern.so",
      Rcpp::Named("package", "torch"));
    std::string path = Rcpp::as<std::string>(path_sexp);
    if (path.empty())
      Rcpp::stop("Cannot find liblantern.so path via system.file");
    DBG("liblantern path: %s", path.c_str());
    ensure_lantern(path.c_str());
  }

  DBG("converting R lists");
  Rcpp::List params_xptr(params_xptr_list);
  Rcpp::List grads_xptr(grads_xptr_list);
  Rcpp::List ea_xptr(exp_avgs_xptr_list);
  Rcpp::List eas_xptr(exp_avg_sqs_xptr_list);
  Rcpp::List steps_xptr(state_steps_xptr_list);
  int n = params_xptr.size();
  DBG("n_params = %d", n);

  DBG("creating TensorLists");
  void* self_tl  = L.TensorList();
  DBG("  self_tl=%p", self_tl);
  void* grads_tl = L.TensorList();
  DBG("  grads_tl=%p", grads_tl);
  void* ea_tl    = L.TensorList();
  void* eas_tl   = L.TensorList();
  void* mea_tl   = L.TensorList();
  void* steps_tl = L.TensorList();

  DBG("pushing back %d elements per TL", n);
  for (int i = 0; i < n; i++) {
    void* ph = xptr_addr(params_xptr[i], "params");
    void* gh = xptr_addr(grads_xptr[i], "grads");
    void* eh = xptr_addr(ea_xptr[i], "ea");
    void* esh = xptr_addr(eas_xptr[i], "eas");
    void* sth = xptr_addr(steps_xptr[i], "steps");
    DBG("  handles[%d]: p=%p g=%p ea=%p eas=%p st=%p", i, ph, gh, eh, esh, sth);
    L.TensorList_push_back(self_tl,  ph);
    L.TensorList_push_back(grads_tl, gh);
    L.TensorList_push_back(ea_tl,    eh);
    L.TensorList_push_back(eas_tl,   esh);
    L.TensorList_push_back(steps_tl, sth);
  }
  DBG("push_back done");

  int cuda_dev = Rcpp::as<int>(cuda_device);
  if (cuda_dev >= 0) {
    DBG("cuda_synchronize(%d)", cuda_dev);
    L.cuda_synchronize(cuda_dev);
  }

  DBG("creating scalar args");
  void* lr_arg   = L.double_(Rcpp::as<double>(lr));
  void* b1_arg   = L.double_(Rcpp::as<double>(b1));
  void* b2_arg   = L.double_(Rcpp::as<double>(b2));
  void* eps_arg  = L.double_(Rcpp::as<double>(eps));
  void* wd_arg   = L.double_(Rcpp::as<double>(weight_decay));
  void* amsgrad  = L.bool_(false);
  void* maximize = L.bool_(false);
  DBG("scalar args: lr=%p b1=%p b2=%p eps=%p wd=%p ams=%p max=%p",
      lr_arg, b1_arg, b2_arg, eps_arg, wd_arg, amsgrad, maximize);

  DBG("calling fused_adam...");
  void* result = L.fused_adam(
    self_tl, grads_tl, ea_tl, eas_tl, mea_tl, steps_tl,
    lr_arg, b1_arg, b2_arg, wd_arg, eps_arg,
    amsgrad, maximize, NULL, NULL
  );
  DBG("fused_adam returned: %p", result);

  DBG("cleaning up TensorLists");
  L.TensorList_delete(self_tl);
  L.TensorList_delete(grads_tl);
  L.TensorList_delete(ea_tl);
  L.TensorList_delete(eas_tl);
  L.TensorList_delete(mea_tl);
  L.TensorList_delete(steps_tl);

  L.double_delete(lr_arg);
  L.double_delete(b1_arg);
  L.double_delete(b2_arg);
  L.double_delete(eps_arg);
  L.double_delete(wd_arg);
  L.bool_delete(amsgrad);
  L.bool_delete(maximize);

  if (result) L.Tensor_delete(result);

  DBG("done");
  return R_NilValue;
}

} // extern "C"
