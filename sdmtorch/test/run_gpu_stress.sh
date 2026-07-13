#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GPU stress test wrapper — sets LD_LIBRARY_PATH for torch's CUDA JIT libraries
# before launching R. Required because R's Sys.setenv(LD_LIBRARY_PATH) does not
# affect dlopen() calls in the same process (Linux ld.so reads it at startup).
#
# Usage:
#   ./sdmtorch/test/run_gpu_stress.sh              # run the full stress test
#   ./sdmtorch/test/run_gpu_stress.sh bench_e2e    # run the e2e benchmark instead
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Find torch's lib directory containing libnvrtc, libcudart, etc.
TORCH_LIB="$PROJECT_DIR/renv/library/linux-debian-trixie/R-4.5/x86_64-pc-linux-gnu/torch/lib"

if [ ! -d "$TORCH_LIB" ]; then
  # Try alternative location via R
  TORCH_LIB=$(Rscript -e 'cat(system.file(package = "torch", lib.loc = .libPaths()))' 2>/dev/null)/lib
fi

if [ ! -d "$TORCH_LIB" ]; then
  echo "Error: Cannot find torch lib directory" >&2
  exit 1
fi

echo "Using torch lib dir: $TORCH_LIB"
export LD_LIBRARY_PATH="$TORCH_LIB:$LD_LIBRARY_PATH"

if [ "${1:-stress}" = "bench_e2e" ]; then
  exec Rscript "$PROJECT_DIR/sdmtorch/test/bench_e2e.R"
else
  exec Rscript "$PROJECT_DIR/sdmtorch/test/stress_multispecies.R"
fi
