# Build C++ extensions for SDM DNN training
# Usage: make          (build adam_step + fused_adam + cuda_graph)
#        make adam     (build only adam_step_direct — the working one)
#        make clean    (remove build artifacts)
#
# Paths are resolved dynamically from the installed torch R package.
# If torch is not installed, set TORCH_HOME to the libtorch root.

# Resolve torch package path — search common renv library locations
TORCH_PKG := $(shell ls -d ../renv/library/*/*/*/torch 2>/dev/null | head -1)
ifeq ($(strip $(TORCH_PKG)),)
  TORCH_PKG := $(shell ls -d ../../renv/library/*/*/*/torch 2>/dev/null | head -1)
endif
ifeq ($(strip $(TORCH_PKG)),)
  TORCH_PKG := $(shell Rscript -e 'if (requireNamespace("torch", quietly=TRUE)) cat(system.file(package="torch"))' 2>/dev/null)
endif
ifeq ($(strip $(TORCH_PKG)),)
  $(error sdmtorch: torch R package not found. Run renv::restore() first, or set TORCH_HOME env var.)
endif

TORCH_HOME := $(TORCH_PKG)

TORCH_INC := -I$(TORCH_HOME)/include -I$(TORCH_HOME)/include/torch/csrc/api/include -I$(TORCH_HOME)/include/torch/csrc
TORCH_R_INC := -I$(TORCH_PKG)/include
TORCH_LIB := -L$(TORCH_HOME)/lib
R_INC := -I/usr/share/R/include
R_LIB := -L/usr/lib/R/lib -lR
RCPP_INC := $(shell Rscript -e 'cat(system.file("include", package="Rcpp"))' 2>/dev/null)
ifneq ($(strip $(RCPP_INC)),)
  RCPP_INC := -I$(RCPP_INC)
else
  RCPP_INC := -I/usr/share/R/include
endif

# Auto-detect CUDA include path for pinned_alloc and cuda_graph builds
CUDA_INC := $(shell nvcc --print-search-dirs 2>/dev/null | sed -n 's/program: *//p' | xargs dirname 2>/dev/null | xargs -I{} dirname {} 2>/dev/null | xargs -I{} echo "-I{}/include" 2>/dev/null)
ifeq ($(strip $(CUDA_INC)),)
  CUDA_INC := $(shell test -n "$(CUDA_HOME)" -a -d "$(CUDA_HOME)/include" && echo "-I$(CUDA_HOME)/include" || echo "")
endif
ifeq ($(strip $(CUDA_INC)),)
  CUDA_INC := $(shell test -d /usr/local/cuda/include && echo "-I/usr/local/cuda/include" || echo "")
endif

# Conditionally link CUDA libs only if they exist
TORCH_CUDA_LIBS := $(shell ls $(TORCH_HOME)/lib/libtorch_cuda.so 2>/dev/null || echo "")
ifneq ($(strip $(TORCH_CUDA_LIBS)),)
  CUDA_LIBS := -ltorch_cuda -lc10_cuda
else
  CUDA_LIBS :=
endif

TORCH_LIBS := -ltorch -ltorch_cpu -lc10 $(CUDA_LIBS)
RPATH := -Wl,-rpath,$(TORCH_HOME)/lib

SRC_DIR := src
VERSION_SRC := $(SRC_DIR)/version.cpp

ADAM_SRC := $(SRC_DIR)/train_step_adam.cpp
ADAM_OUT := train_step_adam.so

LIBTORCH_SRC := $(SRC_DIR)/train_step_libtorch.cpp
LIBTORCH_OUT := train_step_libtorch.so

CUDAGRAPH_SRC := $(SRC_DIR)/cuda_graph.cpp
CUDAGRAPH_OUT := cuda_graph.so

TENSORVIEW_SRC := $(SRC_DIR)/tensor_view.cpp
TENSORVIEW_OUT := tensor_view.so

PINNEDALLOC_SRC := $(SRC_DIR)/pinned_alloc.cpp
PINNEDALLOC_OUT := pinned_alloc.so

# Resolve torch version for ABI check at compile time
TORCH_VERSION := $(shell Rscript -e 'if (requireNamespace("torch", quietly=TRUE)) cat(as.character(packageVersion("torch")))' 2>/dev/null)
ifeq ($(strip $(TORCH_VERSION)),)
  TORCH_VERSION := $(shell grep -m1 '^Version:' $(TORCH_HOME)/DESCRIPTION 2>/dev/null | sed 's/Version: //')
endif
ifeq ($(strip $(TORCH_VERSION)),)
  TORCH_VERSION := unknown
endif
VERSION_FLAG := -DSDMTORCH_TORCH_VERSION=\"$(TORCH_VERSION)\"

CFLAGS := -std=c++17 -shared -fPIC -O3 -march=native -flto -funroll-loops -DNDEBUG $(VERSION_FLAG)
INCLUDES := $(TORCH_INC) $(TORCH_R_INC) $(RCPP_INC) $(R_INC)

# pinned_alloc is an optional optimization. Its R/libtorch ABI bridge is not
# release-safe yet, so CUDA builds use the tested tensor fallback unless a
# developer explicitly opts in.
SDMTORCH_ENABLE_PINNED_ALLOC ?= 0

all: $(ADAM_OUT) $(LIBTORCH_OUT) $(TENSORVIEW_OUT)
	@if [ -n "$(TORCH_CUDA_LIBS)" ]; then $(MAKE) $(CUDAGRAPH_OUT); fi
	@if [ "$(SDMTORCH_ENABLE_PINNED_ALLOC)" = "1" ]; then $(MAKE) $(PINNEDALLOC_OUT); fi

adam: $(ADAM_OUT)

libtorch: $(LIBTORCH_OUT)

cuda_graph: $(CUDAGRAPH_OUT)

tensor_view: $(TENSORVIEW_OUT)

$(ADAM_OUT): $(ADAM_SRC) $(VERSION_SRC) $(SRC_DIR)/common.h
	$(CXX) $(CFLAGS) $(INCLUDES) $(TORCH_LIB) \
		-o $@ $(ADAM_SRC) $(VERSION_SRC) $(TORCH_LIBS) $(RPATH) $(R_LIB)
	@echo "Built $@"

$(LIBTORCH_OUT): $(LIBTORCH_SRC) $(VERSION_SRC) $(SRC_DIR)/common.h
	$(CXX) $(CFLAGS) $(INCLUDES) $(TORCH_LIB) \
		-o $@ $(LIBTORCH_SRC) $(VERSION_SRC) $(TORCH_LIBS) $(RPATH) $(R_LIB)
	@echo "Built $@"

$(CUDAGRAPH_OUT): $(CUDAGRAPH_SRC) $(VERSION_SRC) $(SRC_DIR)/common.h
	$(CXX) $(CFLAGS) $(INCLUDES) $(TORCH_LIB) \
		-o $@ $(CUDAGRAPH_SRC) $(VERSION_SRC) $(TORCH_LIBS) $(RPATH) $(R_LIB)
	@echo "Built $@"

$(TENSORVIEW_OUT): $(TENSORVIEW_SRC) $(SRC_DIR)/common.h
	$(CXX) $(CFLAGS) $(INCLUDES) $(TORCH_LIB) \
		-o $@ $(TENSORVIEW_SRC) $(TORCH_LIBS) $(RPATH) $(R_LIB)
	@echo "Built $@"

pinned_alloc: $(PINNEDALLOC_OUT)

$(PINNEDALLOC_OUT): $(PINNEDALLOC_SRC) $(SRC_DIR)/common.h
	$(CXX) $(CFLAGS) $(INCLUDES) $(CUDA_INC) $(TORCH_LIB) \
 		-o $@ $(PINNEDALLOC_SRC) $(TORCH_LIBS) $(RPATH) $(R_LIB) -lcudart
	@echo "Built $@"

test-adam: $(ADAM_OUT)
	cd $(CURDIR)/.. && Rscript sdmtorch/test/test_adam.R

test-libtorch: $(LIBTORCH_OUT)
	cd $(CURDIR)/.. && Rscript sdmtorch/test/test_libtorch.R

check:
	@Rscript -e '
	  so_dir <- file.path(getwd(), "sdmtorch")
	  for (so in c("train_step_adam.so", "train_step_libtorch.so", "cuda_graph.so", "pinned_alloc.so", "tensor_view.so")) {
	    path <- file.path(so_dir, so)
	    if (file.exists(path)) {
	      cat(so, ": OK\n")
	    } else {
	      cat(so, ": MISSING\n")
	    }
	  }
	'

clean:
	rm -f *.o *.so src/*.o

.PHONY: clean test-adam test-libtorch adam libtorch cuda_graph tensor_view pinned_alloc check
