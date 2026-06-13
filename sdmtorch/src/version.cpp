#include <Rcpp.h>

// Embed the torch version compiled against for ABI compatibility checks.
// Set via -DSDMTORCH_TORCH_VERSION in the Makefile.

#ifndef SDMTORCH_TORCH_VERSION
#define SDMTORCH_TORCH_VERSION "unknown"
#endif

extern "C" {

SEXP sdmtorch_torch_version() {
  return Rcpp::CharacterVector::create(SDMTORCH_TORCH_VERSION);
}

} // extern "C"
