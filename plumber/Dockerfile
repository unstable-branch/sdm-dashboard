# syntax=docker/dockerfile:1
# Multi-stage build: stage 1 compiles libtorch + lantern, stage 2 builds the runtime image.
FROM rocker/r-ver:4.4.2@sha256:df26749182af64d5263bf64149d51a427b476ed28c4e046997143be3f97fdd7c AS torch-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip cmake build-essential git \
    && rm -rf /var/lib/apt/lists/*

# Add NVIDIA CUDA repo for GPU support in lantern build
RUN curl -sL https://developer.download.nvidia.com/compute/cuda/repos/debian12/x86_64/cuda-keyring_1.1-1_all.deb -o /tmp/cuda-keyring.deb \
  && dpkg -i /tmp/cuda-keyring.deb \
  && apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends cuda-nvcc-12-8 cuda-cudart-12-8 cuda-nvrtc-12-8 cuda-nvrtc-dev-12-8 \
  && rm -rf /var/lib/apt/lists/* /tmp/cuda-keyring.deb

# Create versionless CUDA symlink so cmake can find nvcc
RUN ln -sf /usr/local/cuda-12.8 /usr/local/cuda

ENV CUDA_HOME=/usr/local/cuda
ENV PATH=/usr/local/cuda/bin:${PATH}

ARG TORCH_HOME=/opt/torch

# Download libtorch 2.8.0+cu128 (pinned, matches torch R package v0.17.0)
# mv avoids doubling disk usage during copy (peak: zip+extract < 9 GB)
RUN curl -L -o /tmp/libtorch.zip \
       "https://download.pytorch.org/libtorch/cu128/libtorch-shared-with-deps-2.8.0%2Bcu128.zip" \
    && unzip -q /tmp/libtorch.zip -d /tmp/libtorch-extract \
    && rm /tmp/libtorch.zip \
    && mv /tmp/libtorch-extract/libtorch ${TORCH_HOME} \
    && rm -rf /tmp/libtorch-extract

# Build lantern from pinned mlverse/torch v0.17.0 (commit 85f1cb4)
# Lantern is built as CPU-only — CUDA support comes from the CUDA-enabled
# libtorch .so files linked at runtime via dlopen. This avoids requiring the
# full CUDA development toolkit (nvrtc-dev, cublas-dev, etc.) during build.
RUN git clone https://github.com/mlverse/torch.git /tmp/torch-src \
    && cd /tmp/torch-src \
    && git checkout v0.17.0 \
    && cd src/lantern \
    && mkdir build && cd build \
    && cmake .. \
       -DTORCH_PATH=${TORCH_HOME} \
       -DCMAKE_INSTALL_PREFIX=${TORCH_HOME} \
    && cmake --build . --parallel $(nproc) --target install --config Release \
    && rm -rf /tmp/torch-src

# Strip headers and build artifacts — only the .so files are needed at runtime
RUN rm -rf ${TORCH_HOME}/include ${TORCH_HOME}/share ${TORCH_HOME}/bin

# Verify liblantern.so is in the correct location
RUN ls -la ${TORCH_HOME}/lib/liblantern.so && ls -la ${TORCH_HOME}/lib/libtorch.so

# ─── Stage 2: Runtime image ────────────────────────────────────────
FROM rocker/r-ver:4.4.2@sha256:df26749182af64d5263bf64149d51a427b476ed28c4e046997143be3f97fdd7c

LABEL org.opencontainers.image.title="SDM Dashboard — Plumber"
LABEL org.opencontainers.image.description="R/Plumber computation API for SDM model runs"
LABEL org.opencontainers.image.source="https://github.com/unstable-branch/sdm-dashboard"

ARG R_CRAN_REPO=https://packagemanager.posit.co/cran/__linux__/noble/latest

ENV DEBIAN_FRONTEND=noninteractive
ENV R_CRAN_REPO=${R_CRAN_REPO}

# Copy pre-built libtorch + lantern .so files from builder stage
# Only the lib/ directory is needed — headers/share/bin are stripped at build.
ARG TORCH_HOME=/opt/torch
COPY --from=torch-builder ${TORCH_HOME}/lib ${TORCH_HOME}/lib

ENV TORCH_HOME=${TORCH_HOME}

# Add NVIDIA CUDA repo for runtime libraries, then install all system deps in one layer.
# nvcc (compiler) is intentionally excluded — only cudart + nvrtc are needed at runtime.
# ADD fetches the keyring before any RUN commands, so curl is not required.
ADD https://developer.download.nvidia.com/compute/cuda/repos/debian12/x86_64/cuda-keyring_1.1-1_all.deb /tmp/cuda-keyring.deb
RUN dpkg -i /tmp/cuda-keyring.deb \
  && apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libsqlite3-dev \
    libudunits2-dev \
    libjq-dev \
    libcurl4-openssl-dev \
    libsodium-dev \
    libhiredis-dev \
    cmake \
    build-essential \
    curl \
    git \
    libssl-dev \
    cuda-cudart-12-8 \
    cuda-nvrtc-12-8 \
  && rm -rf /var/lib/apt/lists/* /tmp/cuda-keyring.deb

ENV LD_LIBRARY_PATH=${TORCH_HOME}/lib:/usr/local/cuda-12.8/lib64:/usr/lib/x86_64-linux-gnu
ENV CUDA_HOME=/usr/local/cuda-12.8
ENV CUDA_PATH=/usr/local/cuda-12.8

# Install R packages
# torch loads libtorch via TORCH_HOME — no runtime download needed
RUN R -e "options(timeout = 900, repos = c(CRAN = Sys.getenv('R_CRAN_REPO'))); install.packages(c( \
    'jsonlite', 'plumber', 'httr', 'callr', \
    'randomForest', 'gbm', 'maxnet', 'nnet', \
    'mgcv', 'earth', 'rpart', 'mda', 'gam', 'xgboost', 'ranger', \
    'PresenceAbsence', 'pROC', 'ecospat', \
    'marginaleffects', 'plotrix', 'ggplot2', \
    'CAST', 'blockCV', \
    'CoordinateCleaner', 'rgbif', 'finch', \
    'future', 'future.apply', \
    'DBI', 'RPostgres', 'digest', \
    'Rook', 'openssl', 'pool', 'uuid', \
    'targets', 'tarchetypes', 'geotargets', \
    'cito', 'torch' \
  ), Ncpus=4)" \
  && rm -rf /tmp/downloaded_packages /tmp/Rtmp*

# Build sdmtorch C++ extensions against installed torch
COPY scripts/build_sdmtorch.R sdmtorch/ /tmp/sdmtorch-build/
RUN cd /tmp/sdmtorch-build && Rscript build_sdmtorch.R && cp *.so /usr/local/lib/ 2>/dev/null; rm -rf /tmp/sdmtorch-build

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/
COPY python_models/ /app/python_models/
# Copy sdmtorch source + pre-built .so files (or freshly built ones from step above)
COPY sdmtorch/ /app/sdmtorch/

RUN groupadd -g 2000 uploadgroup && \
    useradd -m -s /bin/bash -G uploadgroup sdm && \
    mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim && \
    chown -R sdm:sdm /app /app/outputs /app/covariates /app/Worldclim && \
    chown root:uploadgroup /app/data/uploads && \
    chmod 775 /app/data/uploads

USER sdm

EXPOSE 8000

COPY plumber/R/entrypoint.R /app/plumber/R/entrypoint.R

CMD ["Rscript", "/app/plumber/R/entrypoint.R"]
