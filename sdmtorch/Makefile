# Build C++ extensions for fused Adam + CUDA Graphs
# Usage: make          (build libtorch + cuda_graph)
#        make libtorch (build only fused_adam_step_direct)
#        make cuda_graph (build only CUDA Graph wrapper)
#        make test     (build + quick test)
#        make clean    (remove build artifacts)

RENV_LIB := ../renv/library/linux-debian-trixie/R-4.5/x86_64-pc-linux-gnu
TORCH_INC := -I$(RENV_LIB)/torch/include -I$(RENV_LIB)/torch/include/torch/csrc/api/include -I$(RENV_LIB)/torch/include/torch/csrc
TORCH_LIB := -L$(RENV_LIB)/torch/lib
TORCH_LIBS := -ltorch -ltorch_cpu -ltorch_cuda -lc10 -lc10_cuda
R_INC := -I/usr/share/R/include
R_LIB := -L/usr/lib/R/lib -lR

SRC_DIR := src

LIBTORCH_SRC := $(SRC_DIR)/train_step_libtorch.cpp
LIBTORCH_OUT := train_step_libtorch.so

CUDAGRAPH_SRC := $(SRC_DIR)/cuda_graph.cpp
CUDAGRAPH_OUT := cuda_graph.so

all: $(LIBTORCH_OUT) $(CUDAGRAPH_OUT)

libtorch: $(LIBTORCH_OUT)

cuda_graph: $(CUDAGRAPH_OUT)

$(LIBTORCH_OUT): $(LIBTORCH_SRC)
	g++ -std=c++17 -shared -fPIC \
		$(TORCH_INC) -I$(RENV_LIB)/Rcpp/include $(R_INC) \
		$(TORCH_LIB) \
		-o $@ $(LIBTORCH_SRC) \
		$(TORCH_LIBS) -Wl,-rpath,$(RENV_LIB)/torch/lib \
		$(R_LIB)
	@echo "Built $@"

$(CUDAGRAPH_OUT): $(CUDAGRAPH_SRC)
	g++ -std=c++17 -shared -fPIC \
		$(TORCH_INC) -I$(RENV_LIB)/Rcpp/include $(R_INC) \
		$(TORCH_LIB) \
		-o $@ $(CUDAGRAPH_SRC) \
		$(TORCH_LIBS) -Wl,-rpath,$(RENV_LIB)/torch/lib \
		$(R_LIB)
	@echo "Built $@"

test-libtorch: $(LIBTORCH_OUT)
	cd $(CURDIR)/.. && Rscript sdmtorch/test/test_libtorch.R

clean:
	rm -f *.o *.so src/*.o

.PHONY: clean test-libtorch libtorch cuda_graph
