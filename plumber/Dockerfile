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
    SDM_ACCELERATOR=cpu \
    TORCH_HOME=/opt/torch \
    LD_LIBRARY_PATH=/opt/torch/lib:/usr/lib/x86_64-linux-gnu

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git gosu build-essential cmake gfortran pkg-config \
    libcurl4-openssl-dev libssl-dev libxml2-dev libsodium-dev libhiredis-dev \
    libgdal-dev libgeos-dev libproj-dev libsqlite3-dev libudunits2-dev libjq-dev \
    libfontconfig1-dev libfreetype6-dev libharfbuzz-dev libfribidi-dev \
    libpng-dev libtiff-dev libjpeg-dev libuv1-dev \
  && rm -rf /var/lib/apt/lists/*

COPY plumber/install-runtime-packages.R /tmp/install-runtime-packages.R
RUN Rscript --vanilla /tmp/install-runtime-packages.R \
  && rm -f /tmp/install-runtime-packages.R \
  && rm -rf /tmp/downloaded_packages /tmp/Rtmp*

ARG R_TORCH_VERSION=0.17.0
ARG R_CITO_VERSION=1.1
ARG R_TORCH_RUNTIME_SHA256=ae127c985370a1aab2326e705b28d80cfcb5db16940207d4d7f14ad41803534a
ARG R_TORCH_SOURCE_COMMIT=85f1cb4e7af643a666110cbc9a1251b99b682a91
ARG R_TORCH_SOURCE_SHA256=404c5fa6b2d37a58512590f5d075fd79be160b0bb88d77841bdc0176045496cb

# The mlverse CPU archive supplies a matched LibTorch/LibLantern runtime. Build
# its pinned R wrapper commit locally because upstream binaries target newer R.
COPY plumber/install-cpu-dnn-packages.R /tmp/install-cpu-dnn-packages.R
RUN R_TORCH_VERSION=${R_TORCH_VERSION} R_CITO_VERSION=${R_CITO_VERSION} \
    R_TORCH_RUNTIME_SHA256=${R_TORCH_RUNTIME_SHA256} \
    R_TORCH_SOURCE_COMMIT=${R_TORCH_SOURCE_COMMIT} \
    R_TORCH_SOURCE_SHA256=${R_TORCH_SOURCE_SHA256} \
    Rscript --vanilla /tmp/install-cpu-dnn-packages.R \
  && rm -f /tmp/install-cpu-dnn-packages.R \
  && rm -rf /tmp/downloaded_packages /tmp/Rtmp*

# Preserve the optional sdmtorch acceleration files present before the image
# split. DNN remains functional through cito/torch if an extension cannot build.
COPY scripts/build_sdmtorch.R /tmp/sdmtorch-build/
COPY sdmtorch/ /tmp/sdmtorch-build/sdmtorch/
RUN cd /tmp/sdmtorch-build \
  && Rscript --vanilla build_sdmtorch.R \
  && mkdir -p /opt/sdm/sdmtorch \
  && find sdmtorch -maxdepth 1 -type f -name "*.so" -exec cp {} /opt/sdm/sdmtorch/ \; \
  && rm -rf /tmp/sdmtorch-build /opt/torch/include /opt/torch/share

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/
COPY python_models/ /app/python_models/
COPY sdmtorch/ /app/sdmtorch/
RUN find /opt/sdm/sdmtorch -maxdepth 1 -type f -name "*.so" -exec cp {} /app/sdmtorch/ \;

RUN groupadd -g 2000 sdm-shared \
  && useradd -m -s /bin/bash -G sdm-shared sdm \
  && mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim \
  && chown -R sdm:sdm /app /app/outputs /app/covariates /app/Worldclim \
  && chgrp -R sdm-shared /app/data/uploads /app/outputs \
  && chmod 2775 /app/data/uploads /app/outputs

EXPOSE 8000

COPY plumber/docker-entrypoint.sh /usr/local/bin/plumber-entrypoint.sh
RUN chmod 0755 /usr/local/bin/plumber-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/plumber-entrypoint.sh"]
CMD ["Rscript", "/app/plumber/R/entrypoint.R"]
