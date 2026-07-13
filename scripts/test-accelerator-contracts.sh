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
require scripts/docker-compose.gpu.yml 'NVIDIA_VISIBLE_DEVICES'
require scripts/docker-compose.gpu.yml 'CUDA_VISIBLE_DEVICES'
require scripts/docker-compose.gpu.yml 'PYTORCH_CUDA_ALLOC_CONF'

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
forbid plumber/Dockerfile.rocm 'COPY sdmtorch/'
forbid plumber/Dockerfile.rocm 'build_sdmtorch.R'
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

Rscript --vanilla -e "parse('plumber/install-runtime-packages.R'); parse('scripts/smoke-rocm-model.R')" >/dev/null

echo "accelerator contracts: ok"
