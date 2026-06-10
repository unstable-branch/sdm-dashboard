#!/usr/bin/env bash
# Build the fused training step shared library.
# Usage: bash build.sh [output_dir]
set -euo pipefail

OUTPUT_DIR="${1:-.}"

# Find torch include directory from the installed torch R package
TORCH_DIR=$(Rscript -e 'cat(system.file(package = "torch"))' 2>/dev/null)
if [ -z "$TORCH_DIR" ]; then
  echo "Error: torch R package not found. Install with: install.packages('torch')"
  exit 1
fi

INCLUDE_DIR="$TORCH_DIR/include"
if [ ! -f "$INCLUDE_DIR/lantern.h" ]; then
  echo "Error: torch headers not found at $INCLUDE_DIR"
  exit 1
fi

echo "Compiling with torch headers from: $INCLUDE_DIR"

# Compile the shared library
R CMD SHLIB -o "$OUTPUT_DIR/fused_step.so" \
  -I"$INCLUDE_DIR" \
  src/train_step.cpp \
  2>&1

echo "Build complete: $OUTPUT_DIR/fused_step.so"
