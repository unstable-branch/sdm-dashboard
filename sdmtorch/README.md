# sdmtorch — C++ Fused Training Step for cito

## Status: Research / Prototype

Four approaches explored for fusing cito DNN training loop into C++:

### 1. lantern weak symbols (`train_step.cpp` → lantern_v1)

Include `lantern.h` (weak symbols), call `lantern__fused_adam_...()`.

**Bug: uses `lantern_TensorList_new()`** — constructor is `lantern_TensorList()`.
**Bug: `R_ExternalPtrAddr()` returns `XPtrTorchTensor*`, not lantern handle** — need `.get()`.

### 2. Direct ATen/libtorch (`train_step_libtorch.cpp`)

Cast external pointer to `at::Tensor*`, build TensorList, call `at::_fused_adam_()`.

**Blocked:** R stores `XPtrTorchTensor` wrapper, not `at::Tensor*`. Wrong layout → segfault.

### 3. Weak symbols + `-llantern` link (`train_step.cpp` → lantern_v2)

Link against liblantern.so so `lantern_loaded` shares with torchpkg's initialized copy.

**Blocked:** torchpkg has its OWN BSS copy of `lantern_loaded` and all `_lantern_*` function pointer globals. torchpkg sets its copies during init. liblantern's copies stay NULL. Link via DT_NEEDED loads SEPARATE liblantern copy (torchpkg uses dlopen, not DT_NEEDED). SONAME dedup fails.

### 4. dlsym from torchpkg globals (`train_step.cpp` → current)

**Approach:**
1. `dlopen(liblantern.so)` → get liblantern handle
2. `Rcpp::system.file("libs", "torchpkg.so", package="torch")` → get torchpkg path
3. `dlopen(torchpkg_path, RTLD_NOLOAD)` → reuse already-loaded torchpkg
4. `dlsym(tpkg, "_lantern_TensorList")` → read function pointer VALUE from torchpkg's initialized BSS
5. Store in local function pointer table
6. Call fused_adam through local table, bypassing lantern_loaded check entirely

**Status:** Compiles, loads, all function pointers resolve non-NULL. Segfault at call time — likely `xptr_addr()` (handle extraction from R external pointer) passes wrong pointer type to `lantern_TensorList_push_back()`.

### Key discovery: `lantern_loaded` architecture

torchpkg has its OWN `B _lantern_*` BSS symbols for function pointers AND `lantern_loaded`. torchpkg sets these during `_lantern_init()`. liblantern.so ALSO has these same BSS symbols but NEVER initializes them. The torch R package does NOT link against liblantern — it loads it via `dlopen()` and initializes torcpkg's copies of function pointers.

This means external C++ extensions CANNOT use `#include <lantern.h>` (weak symbols) — the `lantern_loaded` flag and `_lantern_*` function pointers in liblantern.so's BSS are never set to true/non-NULL.

### Verified working path

```cpp
// 1. Get torchpkg handle (already loaded by R, RTLD_NOLOAD to avoid new copy)
void* tpkg = dlopen(torchpkg_path, RTLD_LAZY | RTLD_NOLOAD);

// 2. Read function pointer VALUE from torchpkg's BSS globals
void** ptr = (void**)dlsym(tpkg, "_lantern_TensorList");
void* tensorListFn = *ptr;  // dereference — ptr is address of BSS variable

// 3. Call via local function pointer (NOT via lantern.h wrappers)
typedef void* (*tl_fn_t)();
tl_fn_t tl = (tl_fn_t)tensorListFn;
void* handle = tl();
```

## Build

```bash
make fused_step.so   # build the reference .so (dlsym approach)
make lantern_global.so   # build RTLD_GLOBAL helper (not needed for dlsym approach)
```

## Next steps to fix segfault

The segfault at `address (nil)` suggests a wrong pointer type in `xptr_addr()`. Root cause:
- `R_ExternalPtrAddr(sexp)` returns what `operator_sexp_tensor()` stored
- Likely stores the lantern `void*` handle directly (not an `XPtrTorch*`)
- Current code: `static_cast<XPtrTorch*>(raw)->get()` — wrong if `raw` IS the handle
- Fix: try passing `raw` directly (without unwrapping) as the tensor handle

Fix approach: replace `xptr_addr()` with:
```cpp
inline void* xptr_addr(SEXP s) {
  return R_ExternalPtrAddr(s);  // raw IS the lantern handle
}
```
