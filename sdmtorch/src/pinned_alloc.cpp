#include <Rcpp.h>
#include <cuda_runtime.h>
#include <cstring>
#include <cstdlib>
#include <mutex>
#include <ATen/ATen.h>
#include <torch_types.h>

// Pinned memory allocator for async CPU↔GPU transfers.
//
// Prediction paths currently do synchronous H2D via torch_tensor(matrix, device=device).
// This allocator provides pre-pinned CPU buffers that enable true async transfers
// using cudaMemcpyAsync. Data is copied from R heap into the pinned buffer by the
// CPU, then transferred to GPU asynchronously while the CPU prepares the next batch.
//
// Usage from R:
//   buf <- .Call("pinned_alloc", nrows, ncols)     # allocate [nrows x ncols] pinned buffer
//   .Call("pinned_fill", buf, r_matrix)              # copy R matrix data into pinned buffer
//   .Call("pinned_to_gpu", buf, gpu_ptr)             # async H2D transfer
//   .Call("pinned_free", buf)                        # release

struct PinnedBuffer {
  float* cpu_ptr;    // Pinned CPU memory (page-locked)
  size_t n_elements;
};

static std::mutex pinned_mutex;

extern "C" {

// Allocate a pinned buffer for an nrows x ncols float matrix.
// Returns an external pointer to PinnedBuffer.
SEXP pinned_alloc(SEXP nrows_, SEXP ncols_) {
  int nrows = Rcpp::as<int>(nrows_);
  int ncols = Rcpp::as<int>(ncols_);
  if (nrows < 1 || ncols < 1)
    Rcpp::stop("Dimensions must be positive");

  size_t n_elements = static_cast<size_t>(nrows) * static_cast<size_t>(ncols);
  size_t n_bytes = n_elements * sizeof(float);

  float* cpu_ptr = nullptr;
  cudaError_t err = cudaHostAlloc(&cpu_ptr, n_bytes, cudaHostAllocDefault);
  if (err != cudaSuccess)
    Rcpp::stop("cudaHostAlloc failed (%d): %s", err, cudaGetErrorString(err));

  auto* buf = new PinnedBuffer{cpu_ptr, n_elements};
  SEXP xp = R_MakeExternalPtr(buf, R_NilValue, R_NilValue);
  PROTECT(xp);
  R_RegisterCFinalizerEx(xp, [](SEXP xp) {
    auto* b = static_cast<PinnedBuffer*>(R_ExternalPtrAddr(xp));
    if (b) {
      if (b->cpu_ptr) cudaFreeHost(b->cpu_ptr);
      delete b;
      R_SetExternalPtrAddr(xp, NULL);
    }
  }, TRUE);
  UNPROTECT(1);
  return xp;
}

// Fill a pinned buffer from an R matrix. The R matrix must have nrows * ncols
// elements matching the buffer's dimensions. Copy is CPU-side (fast).
// Converts double → float and reorders column-major (R) → row-major (torch).
SEXP pinned_fill(SEXP buf_xp, SEXP r_matrix) {
  if (!Rf_isMatrix(r_matrix) || TYPEOF(r_matrix) != REALSXP)
    Rcpp::stop("Source must be a numeric matrix");

  SEXP dim = Rf_getAttrib(r_matrix, R_DimSymbol);
  int nrow = INTEGER(dim)[0];
  int ncol = INTEGER(dim)[1];

  auto* buf = static_cast<PinnedBuffer*>(R_ExternalPtrAddr(buf_xp));
  if (!buf || !buf->cpu_ptr)
    Rcpp::stop("NULL pinned buffer");
  if (static_cast<size_t>(nrow) * static_cast<size_t>(ncol) > buf->n_elements)
    Rcpp::stop("Matrix too large for buffer (%d > %zu)", nrow * ncol, buf->n_elements);

  double* src = REAL(r_matrix);
  float* dst = buf->cpu_ptr;

  // R stores column-major: element(i,j) at src[i + j * nrow]
  // torch/PyTorch expects row-major: element(i,j) at dst[i * ncol + j]
  // Reorder during copy so the flat buffer is row-major viewable as [nrow, ncol]
  for (int i = 0; i < nrow; i++) {
    for (int j = 0; j < ncol; j++) {
      dst[i * ncol + j] = static_cast<float>(src[i + j * nrow]);
    }
  }
  return R_NilValue;
}

// Free a pinned buffer (usually called via GC finalizer, but can be explicit).
SEXP pinned_free(SEXP buf_xp) {
  auto* buf = static_cast<PinnedBuffer*>(R_ExternalPtrAddr(buf_xp));
  if (buf) {
    if (buf->cpu_ptr) cudaFreeHost(buf->cpu_ptr);
    delete buf;
    R_SetExternalPtrAddr(buf_xp, NULL);
  }
  return R_NilValue;
}

// Async copy from pinned buffer to a new GPU tensor.
// Returns an XPtrTorchTensor compatible with R's torch package.
// Usage from R:
//   tensor <- .Call("pinned_to_gpu_tensor", buf, "cuda")
SEXP pinned_to_gpu_tensor(SEXP buf_xp, SEXP device_sexp) {
  auto* buf = static_cast<PinnedBuffer*>(R_ExternalPtrAddr(buf_xp));
  if (!buf || !buf->cpu_ptr)
    Rcpp::stop("NULL pinned buffer");

  std::string device_str = Rcpp::as<std::string>(device_sexp);
  at::Device device(device_str);

  // Allocate GPU tensor, immediately heap-wrap for XPtrTorchTensor
  auto* tensor_ptr = new at::Tensor(
    at::empty(
      {static_cast<int64_t>(buf->n_elements)},
      at::TensorOptions().device(device).dtype(at::kFloat)
    )
  );

  // Sync H2D copy from pinned memory (caller expects usable tensor immediately)
  cudaError_t err = cudaMemcpy(
    tensor_ptr->data_ptr<float>(),
    buf->cpu_ptr,
    buf->n_elements * sizeof(float),
    cudaMemcpyHostToDevice
  );
  if (err != cudaSuccess) {
    delete tensor_ptr;
    Rcpp::stop("pinned_to_gpu_tensor: cudaMemcpy failed (%d): %s", err, cudaGetErrorString(err));
  }

  XPtrTorchTensor result(tensor_ptr);
  return result.operator SEXP();
}

} // extern "C"
