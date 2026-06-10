#include <Rcpp.h>
#include <R_ext/Error.h>
#include <dlfcn.h>
#include <cstdint>
#include <cstring>

// CUDA Graph capture/replay using ATen's CUDAGraph API via dlsym.
// Usage:
//   1. cuda_setup_graph_stream() — creates a non-default CUDA stream
//   2. cuda_graph_begin(TRUE) — starts capture on that stream
//   3. Run forward+backward in R
//   4. cuda_graph_end(graph_xptr) — ends capture
//   5. cuda_graph_replay(graph_xptr) — replays

typedef uint64_t MempoolId_t_data[2];
typedef std::pair<uint64_t, uint64_t> MempoolId_t;

// sizeof(at::cuda::CUDAGraph) ≈ 256 bytes on x86_64 + hash map overhead
#define CUDAGRAPH_BUFFER_SIZE 2048

struct AtenCuda {
  void* torch_cuda_handle;

  void (*construct)(void* mem, bool keep_graph);
  void (*destroy)(void* mem);
  void (*capture_begin)(void* mem, MempoolId_t pool, unsigned int mode);
  void (*capture_end)(void* mem);
  void (*replay)(void* mem);
  MempoolId_t (*graph_pool_handle)();

  // c10::cuda::CUDAStream helpers — we store stream as opaque void*
  // sizeof(CUDAStream) is 8 bytes (intrusive_ptr to impl)
  void* (*getStreamFromPool)(int device, bool high_priority);
  void (*setCurrentCUDAStream)(void* stream);
  void* (*getCurrentCUDAStream)(int device);
  void* (*getDefaultCUDAStream)(int device);

  // Direct cuda runtime via dlopen on libcudart
  void* cudart_handle;
  int (*cudaStreamCreate)(void** stream);
  int (*cudaStreamDestroy)(void* stream);
  int (*cudaStreamSynchronize)(void* stream);
  const char* (*cudaGetErrorString)(int err);

  char torch_lib_path[1024];
};

static AtenCuda at_cu;

static void* find_symbol(void* handle, const char* name, const char* label) {
  void* p = dlsym(handle, name);
  if (!p) Rf_errorcall(R_NilValue, "CUDAGraph: missing %s (%s)", label, dlerror());
  return p;
}

static void ensure_at_cuda() {
  if (at_cu.torch_cuda_handle) return;

  FILE* maps = fopen("/proc/self/maps", "r");
  char line[4096];
  while (maps && fgets(line, sizeof(line), maps)) {
    if (strstr(line, "libtorch_cuda.so")) {
      char* path = strchr(line, '/');
      if (path) {
        char* nl = strchr(path, '\n');
        if (nl) *nl = '\0';
        strncpy(at_cu.torch_lib_path, path, sizeof(at_cu.torch_lib_path) - 1);
        break;
      }
    }
  }
  if (maps) fclose(maps);
  if (at_cu.torch_lib_path[0] == '\0')
    Rf_errorcall(R_NilValue, "Cannot find libtorch_cuda.so. Is torch loaded?");

  at_cu.torch_cuda_handle = dlopen(at_cu.torch_lib_path, RTLD_LAZY | RTLD_NOLOAD);
  if (!at_cu.torch_cuda_handle)
    at_cu.torch_cuda_handle = dlopen(at_cu.torch_lib_path, RTLD_LAZY | RTLD_LOCAL);
  if (!at_cu.torch_cuda_handle)
    Rf_errorcall(R_NilValue, "Cannot dlopen %s", at_cu.torch_lib_path);

  at_cu.construct = (decltype(at_cu.construct))find_symbol(at_cu.torch_cuda_handle,
    "_ZN2at4cuda9CUDAGraphC1Eb", "CUDAGraph ctor");
  at_cu.destroy = (decltype(at_cu.destroy))find_symbol(at_cu.torch_cuda_handle,
    "_ZN2at4cuda9CUDAGraphD1Ev", "CUDAGraph dtor");
  at_cu.capture_begin = (decltype(at_cu.capture_begin))find_symbol(at_cu.torch_cuda_handle,
    "_ZN2at4cuda9CUDAGraph13capture_beginESt4pairIyyE21cudaStreamCaptureMode",
    "capture_begin");
  at_cu.capture_end = (decltype(at_cu.capture_end))find_symbol(at_cu.torch_cuda_handle,
    "_ZN2at4cuda9CUDAGraph11capture_endEv", "capture_end");
  at_cu.replay = (decltype(at_cu.replay))find_symbol(at_cu.torch_cuda_handle,
    "_ZN2at4cuda9CUDAGraph6replayEv", "replay");
  at_cu.graph_pool_handle = (decltype(at_cu.graph_pool_handle))find_symbol(at_cu.torch_cuda_handle,
    "_ZN2at4cuda17graph_pool_handleEv", "graph_pool_handle");

  // Load c10_cuda for CUDAStream helpers
  char c10_cuda_path[1024];
  strncpy(c10_cuda_path, at_cu.torch_lib_path, sizeof(c10_cuda_path) - 1);
  char* slash = strrchr(c10_cuda_path, '/');
  if (slash) {
    strcpy(slash + 1, "libc10_cuda.so");
    void* c10_cuda = dlopen(c10_cuda_path, RTLD_LAZY | RTLD_NOLOAD);
    if (!c10_cuda) c10_cuda = dlopen(c10_cuda_path, RTLD_LAZY | RTLD_LOCAL);
    if (c10_cuda) {
      at_cu.getStreamFromPool = (decltype(at_cu.getStreamFromPool))find_symbol(c10_cuda,
        "_ZN3c104cuda17getStreamFromPoolEia", "getStreamFromPool");
      at_cu.setCurrentCUDAStream = (decltype(at_cu.setCurrentCUDAStream))find_symbol(c10_cuda,
        "_ZN3c104cuda20setCurrentCUDAStreamENS0_10CUDAStreamE", "setCurrentCUDAStream");
      at_cu.getCurrentCUDAStream = (decltype(at_cu.getCurrentCUDAStream))find_symbol(c10_cuda,
        "_ZN3c104cuda20getCurrentCUDAStreamEa", "getCurrentCUDAStream");
      at_cu.getDefaultCUDAStream = (decltype(at_cu.getDefaultCUDAStream))find_symbol(c10_cuda,
        "_ZN3c104cuda20getDefaultCUDAStreamEa", "getDefaultCUDAStream");
    }
  }

  // Load cudart for stream creation
  const char* cudart_candidates[] = {
    "libcudart-c3a75b33.so.12",
    "libcudart.so.12",
    "libcudart.so",
    NULL
  };
  for (int i = 0; cudart_candidates[i]; i++) {
    at_cu.cudart_handle = dlopen(cudart_candidates[i], RTLD_LAZY | RTLD_NOLOAD);
    if (at_cu.cudart_handle) break;
  }
  if (at_cu.cudart_handle) {
    at_cu.cudaStreamCreate = (decltype(at_cu.cudaStreamCreate))dlsym(at_cu.cudart_handle, "cudaStreamCreate");
    at_cu.cudaStreamDestroy = (decltype(at_cu.cudaStreamDestroy))dlsym(at_cu.cudart_handle, "cudaStreamDestroy");
    at_cu.cudaStreamSynchronize = (decltype(at_cu.cudaStreamSynchronize))dlsym(at_cu.cudart_handle, "cudaStreamSynchronize");
    at_cu.cudaGetErrorString = (decltype(at_cu.cudaGetErrorString))dlsym(at_cu.cudart_handle, "cudaGetErrorString");
  }
}

static void cudagraph_finalizer(SEXP xp) {
  void* mem = R_ExternalPtrAddr(xp);
  if (mem) {
    if (at_cu.torch_cuda_handle) at_cu.destroy(mem);
    free(mem);
    R_SetExternalPtrAddr(xp, NULL);
  }
}

extern "C" {

// Create a non-default CUDA stream and set it as current for this thread.
// Returns an external pointer to the stream (cudaStream_t).
SEXP cuda_setup_graph_stream() {
  ensure_at_cuda();
  if (!at_cu.cudaStreamCreate || !at_cu.getStreamFromPool || !at_cu.setCurrentCUDAStream) {
    Rf_errorcall(R_NilValue, "CUDA stream creation not available");
  }

  // Use PyTorch's getStreamFromPool to create a non-default CUDA stream.
  // It returns a CUDAStream (intrusive_ptr, 8 bytes).
  // We allocate 16 bytes to hold it (pad for safety).
  void* stream_mem = malloc(64);
  if (!stream_mem) Rf_errorcall(R_NilValue, "malloc failed");

  int device = 0; // default device
  // getStreamFromPool returns CUDAStream by value. The return convention
  // on x86_64 Linux for an 8-byte trivial class is in rax register.
  // We call it as a function returning void* (same as the intrusive_ptr).
  void* stream = at_cu.getStreamFromPool(device, false);

  // Store stream pointer in memory for later use
  memcpy(stream_mem, &stream, sizeof(void*));

  // Set as current stream for this thread
  at_cu.setCurrentCUDAStream(stream_mem);

  SEXP xp = R_MakeExternalPtr(stream_mem, R_NilValue, R_NilValue);
  PROTECT(xp);
  R_RegisterCFinalizerEx(xp, [](SEXP xp) {
    void* mem = R_ExternalPtrAddr(xp);
    if (mem) { free(mem); R_SetExternalPtrAddr(xp, NULL); }
  }, TRUE);
  UNPROTECT(1);
  return xp;
}

// Capture forward+backward on the non-default stream.
SEXP cuda_graph_begin(SEXP enable_) {
  bool enable = Rcpp::as<bool>(enable_);
  if (!enable) return R_NilValue;

  ensure_at_cuda();

  // Verify we're on a non-default stream
  void* current = at_cu.getCurrentCUDAStream(0);
  void* def = at_cu.getDefaultCUDAStream(0);
  if (current == def) {
    Rf_errorcall(R_NilValue, "Must call cuda_setup_graph_stream() before cuda_graph_begin");
  }

  void* mem = malloc(CUDAGRAPH_BUFFER_SIZE);
  if (!mem) Rf_errorcall(R_NilValue, "malloc failed");

  try {
    at_cu.construct(mem, false);
  } catch (std::exception& e) {
    free(mem);
    Rf_errorcall(R_NilValue, "CUDAGraph ctor: %s", e.what());
  }

  MempoolId_t pool;
  try {
    pool = at_cu.graph_pool_handle();
  } catch (std::exception& e) {
    at_cu.destroy(mem); free(mem);
    Rf_errorcall(R_NilValue, "graph_pool_handle: %s", e.what());
  }

  try {
    at_cu.capture_begin(mem, pool, 0);
  } catch (std::exception& e) {
    at_cu.destroy(mem); free(mem);
    Rf_errorcall(R_NilValue, "capture_begin: %s", e.what());
  }

  SEXP xp = R_MakeExternalPtr(mem, R_NilValue, R_NilValue);
  PROTECT(xp);
  R_RegisterCFinalizerEx(xp, cudagraph_finalizer, TRUE);
  UNPROTECT(1);
  return xp;
}

SEXP cuda_graph_end(SEXP graph_xptr) {
  void* mem = R_ExternalPtrAddr(graph_xptr);
  if (!mem) return R_NilValue;
  try { at_cu.capture_end(mem); }
  catch (std::exception& e) { Rf_errorcall(R_NilValue, "capture_end: %s", e.what()); }
  return graph_xptr;
}

SEXP cuda_graph_replay(SEXP graph_xptr) {
  void* mem = R_ExternalPtrAddr(graph_xptr);
  if (!mem) return R_NilValue;
  try { at_cu.replay(mem); }
  catch (std::exception& e) { Rf_errorcall(R_NilValue, "replay: %s", e.what()); }
  return R_NilValue;
}

SEXP cuda_graph_cleanup(SEXP graph_xptr) {
  void* mem = R_ExternalPtrAddr(graph_xptr);
  if (!mem) return R_NilValue;
  try { at_cu.destroy(mem); } catch (...) {}
  free(mem);
  R_SetExternalPtrAddr(graph_xptr, NULL);
  return R_NilValue;
}

} // extern "C"
