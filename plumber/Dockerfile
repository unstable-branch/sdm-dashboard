# syntax=docker/dockerfile:1
# CPU-first Plumber runtime. Accelerator-specific builds live in
# Dockerfile.cuda and Dockerfile.rocm.
FROM rocker/r-ver:4.4.2@sha256:df26749182af64d5263bf64149d51a427b476ed28c4e046997143be3f97fdd7c

LABEL org.opencontainers.image.title="SDM Dashboard — Plumber (CPU)"
LABEL org.opencontainers.image.description="CPU R/Plumber computation API for SDM model runs"
LABEL org.opencontainers.image.source="https://github.com/unstable-branch/sdm-dashboard"
LABEL org.opencontainers.image.accelerator="cpu"

ARG R_CRAN_SNAPSHOT=2026-07-12
ARG R_CRAN_REPO=https://packagemanager.posit.co/cran/__linux__/noble/${R_CRAN_SNAPSHOT}

ENV DEBIAN_FRONTEND=noninteractive \
    RENV_CONFIG_AUTOLOADER_ENABLED=FALSE \
    R_CRAN_REPO=${R_CRAN_REPO} \
    SDM_ACCELERATOR=cpu

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential cmake gfortran pkg-config \
    libcurl4-openssl-dev libssl-dev libxml2-dev libsodium-dev libhiredis-dev \
    libgdal-dev libgeos-dev libproj-dev libsqlite3-dev libudunits2-dev libjq-dev \
    libfontconfig1-dev libfreetype6-dev libharfbuzz-dev libfribidi-dev \
    libpng-dev libtiff-dev libjpeg-dev libuv1-dev \
  && rm -rf /var/lib/apt/lists/*

COPY plumber/install-runtime-packages.R /tmp/install-runtime-packages.R
RUN Rscript --vanilla /tmp/install-runtime-packages.R \
  && rm -f /tmp/install-runtime-packages.R \
  && rm -rf /tmp/downloaded_packages /tmp/Rtmp*

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/
COPY python_models/ /app/python_models/

RUN groupadd -g 2000 uploadgroup \
  && useradd -m -s /bin/bash -G uploadgroup sdm \
  && mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim \
  && chown -R sdm:sdm /app /app/outputs /app/covariates /app/Worldclim \
  && chown root:uploadgroup /app/data/uploads \
  && chmod 775 /app/data/uploads

USER sdm
EXPOSE 8000
CMD ["Rscript", "/app/plumber/R/entrypoint.R"]
