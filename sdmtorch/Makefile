# Build C++ extensions for SDM DNN training
# Usage: make          (build adam_step + fused_adam + cuda_graph)
#        make adam     (build only adam_step_direct — the working one)
#        make clean    (remove build artifacts)

RENV_LIB := ../renv/library/linux-debian-trixie/R-4.5/x86_64-pc-linux-gnu
TORCH_INC := -I$(RENV_LIB)/torch/include -I$(RENV_LIB)/torch/include/torch/csrc/api/include -I$(RENV_LIB)/torch/include/torch/csrc
TORCH_LIB := -L$(RENV_LIB)/torch/lib
TORCH_LIBS := -ltorch -ltorch_cpu -ltorch_cuda -lc10 -lc10_cuda
R_INC := -I/usr/share/R/include
R_LIB := -L/usr/lib/R/lib -lR

SRC_DIR := src

ADAM_SRC := $(SRC_DIR)/train_step_adam.cpp
ADAM_OUT := train_step_adam.so

LIBTORCH_SRC := $(SRC_DIR)/train_step_libtorch.cpp
LIBTORCH_OUT := train_step_libtorch.so

CUDAGRAPH_SRC := $(SRC_DIR)/cuda_graph.cpp
CUDAGRAPH_OUT := cuda_graph.so

all: $(ADAM_OUT) $(LIBTORCH_OUT) $(CUDAGRAPH_OUT)

adam: $(ADAM_OUT)

libtorch: $(LIBTORCH_OUT)

cuda_graph: $(CUDAGRAPH_OUT)

$(ADAM_OUT): $(ADAM_SRC)
	g++ -std=c++17 -shared -fPIC \
		$(TORCH_INC) -I$(RENV_LIB)/Rcpp/include $(R_INC) \
		$(TORCH_LIB) \
		-o $@ $(ADAM_SRC) \
		$(TORCH_LIBS) -Wl,-rpath,$(RENV_LIB)/torch/lib \
		$(R_LIB)
	@echo "Built $@"

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

test-adam: $(ADAM_OUT)
	cd $(CURDIR)/.. && Rscript sdmtorch/test/test_adam.R

test-libtorch: $(LIBTORCH_OUT)
	cd $(CURDIR)/.. && Rscript sdmtorch/test/test_libtorch.R

clean:
	rm -f *.o *.so src/*.o

.PHONY: clean test-adam test-libtorch adam libtorch cuda_graph
