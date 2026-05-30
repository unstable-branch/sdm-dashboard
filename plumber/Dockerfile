FROM rocker/geospatial:4.4.2

ARG R_CRAN_REPO=https://packagemanager.posit.co/cran/__linux__/noble/latest

ENV DEBIAN_FRONTEND=noninteractive
ENV R_CRAN_REPO=${R_CRAN_REPO}

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjq-dev \
    pandoc \
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
    'testthat', \
    'DBI', 'RPostgres', 'digest', \
    'Rook', 'openssl' \
  ), Ncpus=4)"

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/

RUN groupadd -g 2000 uploadgroup && \
    useradd -m -s /bin/bash -G uploadgroup sdm && \
    mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim && \
    chown -R sdm:sdm /app /app/outputs /app/covariates /app/Worldclim && \
    chown root:uploadgroup /app/data/uploads && \
    chmod 775 /app/data/uploads

USER sdm

EXPOSE 8000

CMD ["Rscript", "/app/plumber/R/run_server.R"]
