#!/usr/bin/env bash
# Static accelerator selection and Compose contract tests. No Docker/GPU needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

require() {
  grep -Fq -- "$2" "$1" || { echo "missing $2 in $1" >&2; exit 1; }
}
forbid() {
  if grep -Fq -- "$2" "$1"; then
    echo "forbidden $2 in $1" >&2
    exit 1
  fi
}

bash -n scripts/dev-start.sh
bash -n plumber/docker-entrypoint.sh
bash -n "$0"

# Source only the helper definitions; dev-start runs main solely when executed.
# shellcheck source=/dev/null
source scripts/dev-start.sh

amd_host_usable() { return 0; }
nvidia_host_usable() { return 1; }
ACCELERATOR_REQUEST=auto
select_accelerator
[[ "$ACCELERATOR_SELECTED" == amd ]] || { echo "auto should select AMD" >&2; exit 1; }

amd_host_usable() { return 1; }
nvidia_host_usable() { return 0; }
ACCELERATOR_REQUEST=auto
select_accelerator
[[ "$ACCELERATOR_SELECTED" == nvidia ]] || { echo "auto should select NVIDIA" >&2; exit 1; }

amd_host_usable() { return 1; }
nvidia_host_usable() { return 0; }
ACCELERATOR_REQUEST=amd
if select_accelerator >/dev/null 2>&1; then
  echo "explicit unavailable AMD request must fail" >&2
  exit 1
fi

amd_host_usable() { return 0; }
nvidia_host_usable() { return 0; }
ACCELERATOR_REQUEST=auto
if select_accelerator >/dev/null 2>&1; then
  echo "ambiguous auto selection must fail" >&2
  exit 1
fi

require scripts/docker-compose.rocm.yml 'dockerfile: plumber/Dockerfile.rocm'
require scripts/docker-compose.rocm.yml '/dev/kfd'
require scripts/docker-compose.rocm.yml '/dev/dri'
require scripts/docker-compose.rocm.yml 'AMD_VIDEO_GID:?set to the host video group GID'
require scripts/docker-compose.rocm.yml 'AMD_RENDER_GID:?set to the host render group GID'
require scripts/docker-compose.rocm.yml 'ROCR_VISIBLE_DEVICES'
require scripts/docker-compose.rocm.yml 'torch.version.hip'
require scripts/docker-compose.rocm.yml '"vendor") == "AMD"'
require scripts/docker-compose.rocm.yml '"backend") == "rocm"'
forbid scripts/docker-compose.rocm.yml 'privileged:'
forbid scripts/docker-compose.rocm.yml 'ipc: host'
forbid scripts/docker-compose.rocm.yml 'SYS_PTRACE'
forbid scripts/docker-compose.rocm.yml 'seccomp=unconfined'

for common in docker-compose.dev.yml docker-compose.yml docker-compose.prod.yml; do
  forbid "$common" 'NVIDIA_VISIBLE_DEVICES'
  forbid "$common" 'CUDA_VISIBLE_DEVICES'
  forbid "$common" 'PYTORCH_CUDA_ALLOC_CONF'
done
require scripts/docker-compose.gpu.yml 'NVIDIA compatibility overlay'
require scripts/docker-compose.gpu.yml 'dockerfile: plumber/Dockerfile.cuda'
require scripts/docker-compose.gpu.yml 'image: sdm-dashboard-plumber:cuda'
require scripts/docker-compose.gpu.yml 'NVIDIA_VISIBLE_DEVICES'
require scripts/docker-compose.gpu.yml 'CUDA_VISIBLE_DEVICES'
require scripts/docker-compose.gpu.yml 'PYTORCH_CUDA_ALLOC_CONF'

require plumber/Dockerfile 'org.opencontainers.image.accelerator="cpu"'
require plumber/Dockerfile 'R_TORCH_VERSION=0.17.0'
require plumber/Dockerfile 'R_CITO_VERSION=1.1'
require plumber/Dockerfile 'R_TORCH_RUNTIME_SHA256=ae127c985370a1aab2326e705b28d80cfcb5db16940207d4d7f14ad41803534a'
require plumber/Dockerfile 'R_TORCH_SOURCE_COMMIT=85f1cb4e7af643a666110cbc9a1251b99b682a91'
require plumber/Dockerfile 'R_TORCH_SOURCE_SHA256=404c5fa6b2d37a58512590f5d075fd79be160b0bb88d77841bdc0176045496cb'
require plumber/Dockerfile 'install-cpu-dnn-packages.R'
require plumber/Dockerfile 'COPY scripts/build_sdmtorch.R /tmp/sdmtorch-build/'
require plumber/Dockerfile 'COPY sdmtorch/ /tmp/sdmtorch-build/sdmtorch/'
require plumber/Dockerfile 'COPY sdmtorch/ /app/sdmtorch/'
require plumber/install-cpu-dnn-packages.R 'torch-cdn.mlverse.org/packages/cpu/'
require plumber/install-cpu-dnn-packages.R 'check_sha256(runtime_archive, runtime_sha256)'
require plumber/install-cpu-dnn-packages.R 'c("CMD", "INSTALL", "--no-multiarch"'
require plumber/install-cpu-dnn-packages.R '/opt/torch/lib/libtorch.so'
require plumber/install-cpu-dnn-packages.R '/opt/torch/lib/liblantern.so'
require plumber/install-cpu-dnn-packages.R 'install.packages("cito"'
require plumber/install-cpu-dnn-packages.R 'torch::torch_is_installed()'
require plumber/install-cpu-dnn-packages.R 'torch::torch_tensor'
require scripts/build_sdmtorch.R 'LibTorch build root:'
require plumber/Dockerfile.cuda 'org.opencontainers.image.accelerator="nvidia-cuda"'
require plumber/Dockerfile.cuda 'LIBTORCH_CU128_SHA256=a7ae18620b36fa91a4cc83dad0d69287804ba3e5b9f26e5db5cab10c27e84e17'
require plumber/Dockerfile.cuda 'CUDA_KEYRING_SHA256=e7f219eab6fe4819cdb5c15b98233dc3420302d9c00883219cd3d896857cf48d'
require plumber/Dockerfile.cuda 'R_TORCH_SOURCE_COMMIT=85f1cb4e7af643a666110cbc9a1251b99b682a91'
require plumber/Dockerfile.cuda 'cuda-nvcc-12-8=12.8.93-1'
require plumber/Dockerfile.cuda 'cuda-cudart-12-8=12.8.90-1'
require sdmtorch/Makefile 'test -n "$(CUDA_HOME)" -a -d "$(CUDA_HOME)/include"'
require sdmtorch/Makefile 'TORCH_R_INC := -I$(TORCH_PKG)/include'
require sdmtorch/Makefile 'INCLUDES := $(TORCH_INC) $(TORCH_R_INC) $(RCPP_INC) $(R_INC)'
require sdmtorch/Makefile 'SDMTORCH_ENABLE_PINNED_ALLOC ?= 0'
require sdmtorch/Makefile '$(MAKE) $(CUDAGRAPH_OUT)'
require sdmtorch/Makefile 'if [ "$(SDMTORCH_ENABLE_PINNED_ALLOC)" = "1" ]'
require plumber/Dockerfile.cuda "packageVersion('torch')"
require plumber/Dockerfile.cuda "packageVersion('cito')"
require plumber/Dockerfile.cuda 'install-runtime-packages.R'
require plumber/Dockerfile.cuda 'COPY --from=torch-builder ${TORCH_HOME}/include ${TORCH_HOME}/include'
require plumber/Dockerfile.cuda 'install -m 0755 sdmtorch/*.so /usr/local/lib/'
require plumber/Dockerfile.cuda 'COPY sdmtorch/ /tmp/sdmtorch-build/sdmtorch/'
require plumber/Dockerfile.cuda 'COPY --from=torch-builder /usr/local/cuda-12.8/targets/x86_64-linux/include/ /usr/local/cuda-12.8/include/'
require scripts/build_sdmtorch.R 'stop("sdmtorch build failed with exit code "'
require scripts/build_sdmtorch.R 'stop("sdmtorch build produced no shared libraries")'
require plumber/Dockerfile.cuda 'HTTPUserAgent'
forbid plumber/Dockerfile.cuda 'apt-get upgrade'
forbid plumber/Dockerfile.cuda 'git checkout v0.17.0'
forbid plumber/Dockerfile.cuda 'rm -rf ${TORCH_HOME}/include'
require plumber/Dockerfile.rocm 'FROM docker.io/rocm/pytorch:rocm7.2.4_ubuntu24.04_py3.12_pytorch_release_2.9.1@sha256:7fe531fa185af260352fe7fbb3fa64ad749abe72adf0600a648c4692801b125a'
require plumber/Dockerfile.rocm 'requirements-rocm.txt'
require plumber/Dockerfile.rocm 'pip check'
require plumber/Dockerfile.rocm 'torch.version.hip'
require plumber/Dockerfile.rocm 'R_CRAN_SNAPSHOT=2026-07-12'
require plumber/Dockerfile.rocm 'install-runtime-packages.R'
require plumber/Dockerfile.rocm 'smoke-rocm-model.R'
require plumber/Dockerfile.rocm 'R_LD_LIBRARY_PATH=/opt/rocm/lib'
require plumber/Dockerfile.rocm 'SDM_PYTHON=/opt/venv/bin/python3'
require plumber/install-runtime-packages.R '"arrow"'
require plumber/install-runtime-packages.R 'HTTPUserAgent'
require plumber/install-runtime-packages.R 'missing_after'
forbid plumber/install-runtime-packages.R '"torch"'
forbid plumber/install-runtime-packages.R '"cito"'
require docker-compose.dev.yml './python_models:/app/python_models:ro'
forbid deploy/compose.cuda.yml 'build:'
forbid deploy/compose.rocm.yml 'build:'
require deploy/compose.cuda.yml 'NVIDIA_VISIBLE_DEVICES'
require deploy/compose.rocm.yml '/dev/kfd'
forbid plumber/Dockerfile.rocm 'COPY sdmtorch/'
forbid plumber/Dockerfile.rocm 'build_sdmtorch.R'

# Every R computation image must enter as root long enough to repair fresh
# named-volume permissions, then drop to sdm through the shared entrypoint.
for dockerfile in plumber/Dockerfile plumber/Dockerfile.cuda plumber/Dockerfile.rocm; do
  require "$dockerfile" 'gosu'
  require "$dockerfile" 'groupadd -g 2000 sdm-shared'
  require "$dockerfile" 'chgrp -R sdm-shared /app/data/uploads /app/outputs'
  require "$dockerfile" 'chmod 2775 /app/data/uploads /app/outputs'
  require "$dockerfile" 'COPY plumber/docker-entrypoint.sh /usr/local/bin/plumber-entrypoint.sh'
  require "$dockerfile" 'ENTRYPOINT ["/usr/local/bin/plumber-entrypoint.sh"]'
  forbid "$dockerfile" 'USER sdm'
  for runtime_copy in 'COPY R/ /app/R/' 'COPY plumber/ /app/plumber/' 'COPY data/ /app/data/' 'COPY python_models/ /app/python_models/'; do
    require "$dockerfile" "$runtime_copy"
  done
done
require plumber/docker-entrypoint.sh 'prepare_shared_dir /app/data/uploads'
require plumber/docker-entrypoint.sh 'prepare_shared_dir /app/outputs'
require plumber/docker-entrypoint.sh 'prepare_runtime_dir /app/covariates'
require plumber/docker-entrypoint.sh 'prepare_runtime_dir /app/Worldclim'
require plumber/docker-entrypoint.sh 'prepare_runtime_dir /app/chelsa'
require plumber/docker-entrypoint.sh 'prepare_runtime_dir /app/Worldclim_future'
require plumber/docker-entrypoint.sh 'chown -R sdm:sdm "$dir"'
require plumber/docker-entrypoint.sh 'find "$dir" -xdev -type d -exec chmod g+s {} +'
require plumber/docker-entrypoint.sh 'exec gosu sdm "$@"'
if grep -Eq '^[[:space:]]*torch([<=>!~ ]|$)' python_models/torch_dnn/requirements-rocm.txt; then
  echo 'torch must remain owned by the ROCm base image' >&2
  exit 1
fi
require python_models/torch_dnn/requirements-rocm.txt 'numpy=='
require python_models/torch_dnn/requirements-rocm.txt 'pandas=='
require python_models/torch_dnn/requirements-rocm.txt 'pyarrow=='
require scripts/smoke-rocm-model.R 'device = "rocm"'
require scripts/smoke-rocm-model.R 'predict_batch_size = 37L'
python_setup_line="$(grep -nF '"python_setup.R"' R/load_compute.R | cut -d: -f1)"
model_registry_line="$(grep -nF '"model_registry.R"' R/load_compute.R | cut -d: -f1)"
if (( python_setup_line >= model_registry_line )); then
  echo 'python_setup.R must load before model_registry.R in compute workers' >&2
  exit 1
fi

Rscript --vanilla -e "parse('plumber/install-runtime-packages.R'); parse('plumber/install-cpu-dnn-packages.R'); parse('scripts/smoke-rocm-model.R')" >/dev/null

echo "accelerator contracts: ok"
