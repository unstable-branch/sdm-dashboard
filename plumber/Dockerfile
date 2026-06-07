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
    && rm -rf /var/lib/apt/lists/*

RUN R -e "options(repos = c(CRAN = Sys.getenv('R_CRAN_REPO'))); install.packages(c( \
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
  && R -e "library(torch); torch::install_torch()" \
  && rm -rf /tmp/downloaded_packages /tmp/Rtmp*

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/
COPY python_models/ /app/python_models/

RUN groupadd -g 2000 uploadgroup && \
    useradd -m -s /bin/bash -G uploadgroup sdm && \
    mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim && \
    chown -R sdm:sdm /app /app/outputs /app/covariates /app/Worldclim && \
    chown root:uploadgroup /app/data/uploads && \
    chmod 775 /app/data/uploads

USER sdm

EXPOSE 8000

CMD ["Rscript", "/app/plumber/R/run_server.R"]
