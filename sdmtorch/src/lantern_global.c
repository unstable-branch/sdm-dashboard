// Helper: make liblantern.so symbols globally visible.
// Compile: R CMD SHLIB lantern_global.c
// Load: dyn.load("lantern_global.so")   # BEFORE dyn.load("fused_step.so")

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <R.h>
#include <Rinternals.h>

// Called via .Call. Finds the already-loaded liblantern.so and re-dlopen's
// it with RTLD_GLOBAL | RTLD_NOLOAD so subsequently loaded .so files
// can resolve its weak symbols.
SEXP make_lantern_global() {
  // Try RTLD_GLOBAL | RTLD_NOLOAD first — uses existing loaded copy
  void* handle = dlopen("liblantern.so", RTLD_GLOBAL | RTLD_NOLOAD);
  if (!handle) {
    // RTLD_GLOBAL without NOLOAD — creates a NEW reference
    handle = dlopen("liblantern.so", RTLD_LAZY | RTLD_GLOBAL);
  }
  if (handle) {
    // Check that lantern_loaded was found
    bool* loaded = (bool*)dlsym(handle, "lantern_loaded");
    if (loaded) {
      Rprintf("lantern_loaded at %p, value=%d\n", (void*)loaded, (int)*loaded);
    }
    return R_NilValue;
  }
  Rf_error("Could not make liblantern.so globally visible: %s", dlerror());
}
