FROM r-ver:4.4.2

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    libproj-dev \
    libgeos-dev \
    libudunits2-dev \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libfontconfig1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libfreetype6-dev \
    libpng-dev \
    libtiff5-dev \
    libjpeg-dev \
    libcairo2-dev \
    libsqlite3-dev \
    libpq-dev \
    pandoc \
    pandoc-citeproc \
    && rm -rf /var/lib/apt/lists/*

RUN R -e "install.packages(c( \
    'terra', 'sf', 'geodata', 'raster', 'sp', 'rgdal', \
    'jsonlite', 'plumber', 'httr', 'callr', \
    'randomForest', 'gbm', 'maxnet', 'nnet', \
    'mgcv', 'earth', 'rpart', 'mda', 'gam', 'xgboost', 'ranger', \
    'PresenceAbsence', 'pROC', 'ecospat', \
    'marginaleffects', 'plotrix', 'ggplot2', \
    'CAST', 'blockCV', \
    'CoordinateCleaner', 'rgbif', 'finch', \
    'future', 'future.apply', \
    'testthat' \
  ), repos='https://cloud.r-project.org', Ncpus=4)"

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/
COPY data/ /app/data/
COPY install_packages.R /app/install_packages.R

RUN mkdir -p /app/data/uploads /app/outputs /app/covariates /app/Worldclim

EXPOSE 8000

CMD ["R", "-e", "pr <- plumber::pr('/app/plumber/R/plumber.R'); plumber::pr_run(pr, host='0.0.0.0', port=8000)"]
