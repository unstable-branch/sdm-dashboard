# syntax=docker/dockerfile:1
FROM rocker/r-ver:4.4.2@sha256:df26749182af64d5263bf64149d51a427b476ed28c4e046997143be3f97fdd7c

LABEL org.opencontainers.image.title="SDM Dashboard — Plumber"
LABEL org.opencontainers.image.description="R/Plumber computation API for SDM model runs"
LABEL org.opencontainers.image.source="https://github.com/unstable-branch/sdm-dashboard"

ARG R_CRAN_REPO=https://packagemanager.posit.co/cran/__linux__/noble/latest

ENV DEBIAN_FRONTEND=noninteractive
ENV R_CRAN_REPO=${R_CRAN_REPO}

RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libsqlite3-dev \
    libudunits2-dev \
    libjq-dev \
    libcurl4-openssl-dev \
    libsodium-dev \
    libhiredis-dev \
    curl \
    cmake \
    build-essential \
    git \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Add NVIDIA CUDA repo for GPU support (installed after system deps above)
RUN curl -sL https://developer.download.nvidia.com/compute/cuda/repos/debian12/x86_64/cuda-keyring_1.1-1_all.deb -o /tmp/cuda-keyring.deb \
  && dpkg -i /tmp/cuda-keyring.deb \
  && apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends cuda-nvcc-12-6 cuda-cudart-12-6 cuda-nvrtc-12-6 \
  && rm -rf /var/lib/apt/lists/* /tmp/cuda-keyring.deb

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

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/
COPY python_models/ /app/python_models/

ENV LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:/usr/lib/x86_64-linux-gnu
ENV TORCH_HOME=/app/outputs/.torch
ENV CUDA_HOME=/usr/local/cuda-12.6
ENV CUDA_PATH=/usr/local/cuda-12.6
ENV TORCH_VERIFY_LOAD=FALSE
ENV TORCH_LOAD=0

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
