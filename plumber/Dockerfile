FROM rocker/geospatial:4.4.2

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjq-dev \
    pandoc \
    && rm -rf /var/lib/apt/lists/*

RUN R -e "install.packages(c( \
    'jsonlite', 'plumber', 'httr', 'callr', \
    'randomForest', 'gbm', 'maxnet', 'nnet', \
    'mgcv', 'earth', 'rpart', 'mda', 'gam', 'xgboost', 'ranger', \
    'PresenceAbsence', 'pROC', 'ecospat', \
    'marginaleffects', 'plotrix', 'ggplot2', \
    'CAST', 'blockCV', \
    'CoordinateCleaner', 'rgbif', 'finch', \
    'future', 'future.apply', \
    'testthat', \
    'DBI', 'RPostgres', 'digest' \
  ), repos='https://cloud.r-project.org', Ncpus=4)"

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/

RUN mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim

EXPOSE 8000

CMD ["Rscript", "/app/plumber/R/run_server.R"]
