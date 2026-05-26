# syntax=docker/dockerfile:1
FROM rocker/r-ver:4.4.2

ARG R_CRAN_REPO=https://packagemanager.posit.co/cran/__linux__/noble/latest

ENV DEBIAN_FRONTEND=noninteractive
ENV R_CRAN_REPO=${R_CRAN_REPO}

# System deps: terra + sf need GDAL, GEOS, PROJ; httr/rgbif/finch need libcurl;
# plumber 1.3.3 needs sodium which needs libsodium-dev
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libsqlite3-dev \
    libudunits2-dev \
    libjq-dev \
    libcurl4-openssl-dev \
    libsodium-dev \
    pandoc \
    && rm -rf /var/lib/apt/lists/*

# Stage 1: Spatial packages (hard deps — must be installed before model backends)
RUN R --no-save --no-restore <<'EOF'
options(repos = c(CRAN = Sys.getenv("R_CRAN_REPO")))
for (pkg in c("terra", "sf")) {
  message("Installing: ", pkg)
  install.packages(pkg, Ncpus=1, INSTALL_opts = c("--no-test-load"))
}
unlink("/tmp/downloaded_packages", recursive = TRUE)
unlink(list.files("/tmp", pattern = "^Rtmp", full.names = TRUE), recursive = TRUE)
EOF

# Stage 2: All packages needed for model backends (must succeed).
# pkgType="both" uses pre-compiled binaries from Posit PGM when available,
# falling back to source compilation. Ncpus=1 avoids OOM on the few packages
# that need source compilation. --no-test-load prevents crash-on-load.
RUN R --no-save --no-restore <<'EOF'
options(repos = c(CRAN = Sys.getenv("R_CRAN_REPO")))
pkgs <- c(
  "jsonlite", "sodium", "plumber", "httr", "callr",
  "randomForest", "gbm", "maxnet", "nnet",
  "mgcv", "earth", "rpart", "mda", "gam",
  "xgboost", "ranger", "CAST", "blockCV",
  "PresenceAbsence", "pROC", "ecospat", "plotrix",
  "ggplot2", "DBI", "RPostgres", "digest", "Rook",
  "CoordinateCleaner", "rgbif", "finch",
  "future", "future.apply", "marginaleffects"
)
for (pkg in pkgs) {
  message("Installing: ", pkg)
  install.packages(pkg, Ncpus=1, INSTALL_opts = c("--no-test-load"))
}
unlink("/tmp/downloaded_packages", recursive = TRUE)
unlink(list.files("/tmp", pattern = "^Rtmp", full.names = TRUE), recursive = TRUE)
EOF

# Stage 3: dev-only packages (fail gracefully)
RUN R --no-save --no-restore <<'EOF'
options(repos = c(CRAN = Sys.getenv("R_CRAN_REPO")))
for (pkg in c("testthat")) {
  tryCatch({
    message("Installing: ", pkg)
    install.packages(pkg, Ncpus=1, INSTALL_opts = c("--no-test-load"))
  }, error = function(e) {
    message("SKIP: ", pkg, " - ", conditionMessage(e))
  })
}
unlink("/tmp/downloaded_packages", recursive = TRUE)
unlink(list.files("/tmp", pattern = "^Rtmp", full.names = TRUE), recursive = TRUE)
EOF

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
