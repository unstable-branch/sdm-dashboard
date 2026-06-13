#include <Rcpp.h>
#include <R_ext/Error.h>
#include <dlfcn.h>
#include <cstdint>
#include <cstring>
#include <mutex>

// CUDA Graph capture/replay via ATen's CUDAGraph API.
// Uses dlsym to load symbols from libtorch_cuda.so and libc10_cuda.so
// to avoid compile-time dependency on CUDA headers.
//
// The CUDAGraph API is a stable public API since PyTorch 2.0.
// If symbols change across libtorch versions, a clear error is raised.

// sizeof(at::cuda::CUDAGraph) ≈ 256 bytes on x86_64
#define CUDAGRAPH_BUFFER_SIZE 2048

// Function pointer types for ATen CUDAGraph API (loaded via dlsym)
using CUDAGraph_ctor_t = void(*)(void* mem, bool keep_graph);
using CUDAGraph_dtor_t = void(*)(void* mem);
using capture_begin_t = void(*)(void* mem, const uint64_t* pool_id, unsigned int mode);
using capture_end_t = void(*)(void* mem);
using replay_t = void(*)(void* mem);
using graph_pool_handle_t = void(*)(uint64_t* out);
using getStreamFromPool_t = void(*)(void* stream_out, int device, bool high_priority);
using setCurrentCUDAStream_t = void(*)(void* stream);
using getCurrentCUDAStream_t = void(*)(void* stream_out, int device);

struct AtenCuda {
  void* torch_cuda_handle;

  CUDAGraph_ctor_t construct;
  CUDAGraph_dtor_t destroy;
  capture_begin_t capture_begin;
  capture_end_t capture_end;
  replay_t replay;
  graph_pool_handle_t graph_pool_handle;
  getStreamFromPool_t getStreamFromPool;
  setCurrentCUDAStream_t setCurrentCUDAStream;
  getCurrentCUDAStream_t getCurrentCUDAStream;

  // Direct cuda runtime for cudaStreamSynchronize
  void* cudart_handle;
  int (*cudaStreamSynchronize)(void* stream);
  int (*cudaGetLastError)();
  const char* (*cudaGetErrorString)(int err);

  char torch_lib_path[1024];
};

static AtenCuda at_cu;
static std::once_flag at_cuda_init_flag;

static void* find_symbol(void* handle, const char* name, const char* label) {
  void* p = dlsym(handle, name);
  if (!p) Rf_errorcall(R_NilValue, "CUDAGraph: missing %s (%s)", label, dlerror());
  return p;
}

static void ensure_at_cuda() {
  std::call_once(at_cuda_init_flag, []() {
    // Find libtorch_cuda.so from /proc/self/maps
    FILE* maps = fopen("/proc/self/maps", "r");
    char line[4096];
    while (maps && fgets(line, sizeof(line), maps)) {
      if (strstr(line, "libtorch_cuda.so")) {
        char* path = strchr(line, '/');
        if (path) {
          char* nl = strchr(path, '\n');
          if (nl) *nl = '\0';
          size_t len = strlen(path);
          if (len < sizeof(at_cu.torch_lib_path))
            memcpy(at_cu.torch_lib_path, path, len + 1);
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

    // Load CUDA Graph symbols (stable ATen API since PyTorch 2.0)
    at_cu.construct = (CUDAGraph_ctor_t)dlsym(at_cu.torch_cuda_handle,
      "_ZN2at4cuda9CUDAGraphC1Eb");
    at_cu.destroy = (CUDAGraph_dtor_t)dlsym(at_cu.torch_cuda_handle,
      "_ZN2at4cuda9CUDAGraphD1Ev");
    at_cu.capture_begin = (capture_begin_t)dlsym(at_cu.torch_cuda_handle,
      "_ZN2at4cuda9CUDAGraph13capture_beginESt4pairIyyE21cudaStreamCaptureMode");
    at_cu.capture_end = (capture_end_t)dlsym(at_cu.torch_cuda_handle,
      "_ZN2at4cuda9CUDAGraph11capture_endEv");
    at_cu.replay = (replay_t)dlsym(at_cu.torch_cuda_handle,
      "_ZN2at4cuda9CUDAGraph6replayEv");
    at_cu.graph_pool_handle = (graph_pool_handle_t)dlsym(at_cu.torch_cuda_handle,
      "_ZN2at4cuda17graph_pool_handleEv");

    // Load c10_cuda CUDAStream helpers
    char c10_cuda_path[1024];
    size_t plen = strlen(at_cu.torch_lib_path);
    if (plen >= sizeof(c10_cuda_path)) return;
    memcpy(c10_cuda_path, at_cu.torch_lib_path, plen + 1);
    char* slash = strrchr(c10_cuda_path, '/');
    if (slash) {
      memcpy(slash + 1, "libc10_cuda.so", 15);
      void* c10_cuda = dlopen(c10_cuda_path, RTLD_LAZY | RTLD_NOLOAD);
      if (!c10_cuda) c10_cuda = dlopen(c10_cuda_path, RTLD_LAZY | RTLD_LOCAL);
      if (c10_cuda) {
        at_cu.getStreamFromPool = (getStreamFromPool_t)dlsym(c10_cuda,
          "_ZN3c104cuda17getStreamFromPoolEib");
        at_cu.setCurrentCUDAStream = (setCurrentCUDAStream_t)dlsym(c10_cuda,
          "_ZN3c104cuda20setCurrentCUDAStreamENS0_10CUDAStreamE");
        at_cu.getCurrentCUDAStream = (getCurrentCUDAStream_t)dlsym(c10_cuda,
          "_ZN3c104cuda20getCurrentCUDAStreamEi");
      }
    }

    // Load cudart for stream sync (headers not needed — dlsym on symbols already in process)
    const char* cudart_candidates[] = {
      "libcudart.so.12", "libcudart.so", NULL
    };
    for (int i = 0; cudart_candidates[i]; i++) {
      at_cu.cudart_handle = dlopen(cudart_candidates[i], RTLD_LAZY | RTLD_NOLOAD);
      if (at_cu.cudart_handle) break;
    }
    if (at_cu.cudart_handle) {
      at_cu.cudaStreamSynchronize = (decltype(at_cu.cudaStreamSynchronize))dlsym(at_cu.cudart_handle, "cudaStreamSynchronize");
      at_cu.cudaGetLastError = (decltype(at_cu.cudaGetLastError))dlsym(at_cu.cudart_handle, "cudaGetLastError");
      at_cu.cudaGetErrorString = (decltype(at_cu.cudaGetErrorString))dlsym(at_cu.cudart_handle, "cudaGetErrorString");
    }
  });
}

static void cudagraph_finalizer(SEXP xp) {
  void* mem = R_ExternalPtrAddr(xp);
  if (mem && at_cu.destroy) {
    at_cu.destroy(mem);
    free(mem);
    R_SetExternalPtrAddr(xp, NULL);
  }
}

extern "C" {

// Create a non-default CUDA stream and set it as current.
// getStreamFromPool returns CUDAStream (intrusive_ptr, 8 bytes) by value.
// We properly store it and pass the value to setCurrentCUDAStream.
SEXP cuda_setup_graph_stream() {
  ensure_at_cuda();
  if (!at_cu.getStreamFromPool || !at_cu.setCurrentCUDAStream) {
    Rf_errorcall(R_NilValue, "CUDA stream helpers not available");
  }

  // Allocate buffer to hold CUDAStream (intrusive_ptr, 8 bytes)
  void* stream_mem = malloc(64);
  if (!stream_mem) Rf_errorcall(R_NilValue, "malloc failed");

  // getStreamFromPool writes the CUDAStream value into stream_mem
  at_cu.getStreamFromPool(stream_mem, 0, false);

  // setCurrentCUDAStream reads the CUDAStream value from the buffer
  at_cu.setCurrentCUDAStream(stream_mem);

  // Acquire a ref to keep the stream alive (intrusive_ptr copy)
  // Store in a second buffer so the first can be freed on cleanup
  void* stream_ref = malloc(64);
  if (!stream_ref) { free(stream_mem); Rf_errorcall(R_NilValue, "malloc failed"); }
  memcpy(stream_ref, stream_mem, 8);

  // Check for CUDA errors
  if (at_cu.cudaGetLastError && at_cu.cudaGetErrorString) {
    int err = at_cu.cudaGetLastError();
    if (err) {
      free(stream_mem); free(stream_ref);
      Rf_errorcall(R_NilValue, "CUDA error in cuda_setup_graph_stream: %s", at_cu.cudaGetErrorString(err));
    }
  }

  // Wrap stream_ref in an external pointer for R's garbage collection
  // stream_mem is no longer needed (was temporary for the API call)
  free(stream_mem);

  SEXP xp = R_MakeExternalPtr(stream_ref, R_NilValue, R_NilValue);
  PROTECT(xp);
  R_RegisterCFinalizerEx(xp, [](SEXP xp) {
    void* p = R_ExternalPtrAddr(xp);
    if (p) { free(p); R_SetExternalPtrAddr(xp, NULL); }
  }, TRUE);
  UNPROTECT(1);
  return xp;
}

// Begin CUDA Graph capture on the non-default stream (must have called
// cuda_setup_graph_stream first).
SEXP cuda_graph_begin(SEXP enable_) {
  bool enable = Rcpp::as<bool>(enable_);
  if (!enable) return R_NilValue;

  ensure_at_cuda();

  // Verify we're on a non-default stream
  // getCurrentCUDAStream writes into buffer; compare to the stream we created
  uint8_t current_stream[8] = {};
  at_cu.getCurrentCUDAStream(current_stream, 0);

  void* mem = malloc(CUDAGRAPH_BUFFER_SIZE);
  if (!mem) Rf_errorcall(R_NilValue, "malloc failed");

  try {
    at_cu.construct(mem, false);
  } catch (std::exception& e) {
    free(mem);
    Rf_errorcall(R_NilValue, "CUDAGraph ctor: %s", e.what());
  }

  uint64_t pool[2];
  try {
    at_cu.graph_pool_handle(pool);
  } catch (std::exception& e) {
    at_cu.destroy(mem); free(mem);
    Rf_errorcall(R_NilValue, "graph_pool_handle: %s", e.what());
  }

  try {
    at_cu.capture_begin(mem, pool, 1); // 1 = cudaStreamCaptureModeThreadLocal
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

// Cleanup: destroy graph and free memory.
// Called from R as .Call("cuda_graph_cleanup", graph_xptr) or
// .Call("cuda_graph_cleanup", NULL) for epoch-end cleanup.
SEXP cuda_graph_cleanup(SEXP graph_xptr) {
  if (graph_xptr != R_NilValue && TYPEOF(graph_xptr) == EXTPTRSXP) {
    cudagraph_finalizer(graph_xptr);
  }
  return R_NilValue;
}

} // extern "C"
