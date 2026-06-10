#include <Rcpp.h>
#include <dlfcn.h>
#include <cstdint>
#include <torch_types.h>

void* resolve_lantern_fn(const char* name) {
  void* handle = dlopen(NULL, RTLD_LAZY);
  void** ptr = (void**)dlsym(handle, name);
  if (!ptr) return NULL;
  return *ptr;
}

extern "C" {

SEXP diag_extptr(SEXP tensor_sexp) {
  if (TYPEOF(tensor_sexp) != EXTPTRSXP)
    Rcpp::stop("Not an external pointer");
  
  void* addr = R_ExternalPtrAddr(tensor_sexp);
  if (!addr) Rcpp::stop("NULL external pointer");
  
  Rprintf("addr = %p\n", addr);
  
  // Read memory values to distinguish XPtrTorch vs raw handle
  void** words = (void**)addr;
  Rprintf("  [0] = %p  [1] = %p\n", words[0], words[1]);
  Rprintf("  [2] = %p  [3] = %p\n", words[2], words[3]);
  
  // Try interpretation A: addr is an XPtrTorch*, extract with get()
  // This is only valid if sizeof(XPtrTorch) == 16 (shared_ptr: ptr + control_block)
  void* handle_a = NULL;
  bool a_valid = false;
  try {
    // Only attempt if [0] and [1] look like heap pointers
    if (words[0] && words[1]) {
      XPtrTorch* xptr = static_cast<XPtrTorch*>(static_cast<void*>(addr));
      handle_a = xptr->get();
      Rprintf("Interpretation A (XPtrTorch::get()): handle = %p\n", handle_a);
      a_valid = true;
    } else {
      Rprintf("Interpretation A skipped: [0] or [1] is NULL\n");
    }
  } catch (std::exception& e) {
    Rprintf("Interpretation A exception: %s\n", e.what());
  } catch (...) {
    Rprintf("Interpretation A unknown exception\n");
  }
  
  // Try interpretation B: addr IS the lantern handle directly
  void* handle_b = addr;
  Rprintf("Interpretation B (raw addr): handle = %p\n", handle_b);
  bool b_valid = true;  // always possible
  
  // Now test both interpretations by calling lantern_Tensor_device
  typedef void* (*device_fn_t)(void*);
  device_fn_t lantern_device = (device_fn_t)resolve_lantern_fn("_lantern_Tensor_device");
  if (!lantern_device) {
    Rprintf("Could not resolve lantern_Tensor_device\n");
    return R_NilValue;
  }
  Rprintf("lantern_device function ptr = %p\n", (void*)lantern_device);
  
  if (a_valid && handle_a) {
    Rprintf("Testing handle_a with lantern_device...\n");
    void* dev = NULL;
    // Wrap in try-catch to prevent crash
    Rprintf("  about to call lantern_device(%p)\n", handle_a);
    dev = lantern_device(handle_a);
    Rprintf("  device = %p\n", dev);
  }
  
  if (b_valid && handle_b) {
    Rprintf("Testing handle_b with lantern_device...\n");
    void* dev = NULL;
    Rprintf("  about to call lantern_device(%p)\n", handle_b);
    dev = lantern_device(handle_b);
    Rprintf("  device = %p\n", dev);
  }
  
  return R_NilValue;
}

} // extern "C"
