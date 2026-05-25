FROM rocker/r-ver:4.4.2

ARG R_CRAN_REPO=https://packagemanager.posit.co/cran/__linux__/noble/latest

ENV DEBIAN_FRONTEND=noninteractive
ENV R_CRAN_REPO=${R_CRAN_REPO}

# System deps: terra + sf need GDAL, GEOS, PROJ; httr/rgbif/finch need libcurl
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libsqlite3-dev \
    libudunits2-dev \
    libjq-dev \
    libcurl4-openssl-dev \
    pandoc \
    && rm -rf /var/lib/apt/lists/*

# Stage 1: Core packages (must succeed)
RUN R -e "options(repos = c(CRAN = Sys.getenv('R_CRAN_REPO'))); \
  install.packages(c( \
    'jsonlite', 'plumber', 'httr', 'callr', \
    'randomForest', 'gbm', 'maxnet', 'nnet', \
    'mgcv', 'earth', 'rpart', 'mda', 'gam', \
    'PresenceAbsence', 'pROC', 'ecospat', 'plotrix', \
    'ggplot2', 'DBI', 'RPostgres', 'digest', 'Rook' \
  ), Ncpus=2); \
  rm -rf /tmp/downloaded_packages /tmp/R*"

# Stage 2: Spatial packages (hard deps)
RUN R -e "options(repos = c(CRAN = Sys.getenv('R_CRAN_REPO'))); \
  install.packages(c('terra', 'sf'), Ncpus=2); \
  rm -rf /tmp/downloaded_packages /tmp/R*"

# Stage 3: Optional packages (fail gracefully with hints)
RUN R -e "options(repos = c(CRAN = Sys.getenv('R_CRAN_REPO'))); \
  optional <- c('xgboost', 'ranger', 'CAST', 'blockCV', \
    'CoordinateCleaner', 'rgbif', 'finch', 'future', 'future.apply', \
    'testthat', 'marginaleffects'); \
  for (pkg in optional) { \
    tryCatch({ \
      message('Installing: ', pkg); \
      install.packages(pkg, Ncpus=2); \
    }, error = function(e) \
      message('SKIP: ', pkg, ' - ', conditionMessage(e))) \
  }; \
  rm -rf /tmp/downloaded_packages /tmp/R*"

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
