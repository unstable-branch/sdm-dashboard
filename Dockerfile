# syntax=docker/dockerfile:1
# Multi-stage build: stage 1 installs R packages, stage 2 builds the runtime image.
FROM rocker/r-ver:4.4.2@sha256:df26749182af64d5263bf64149d51a427b476ed28c4e046997143be3f97fdd7c AS r-deps

ENV DEBIAN_FRONTEND=noninteractive \
    RENV_CONFIG_AUTOLOADER_ENABLED=FALSE

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    gdal-bin \
    libcurl4-openssl-dev \
    libfontconfig1-dev \
    libfreetype6-dev \
    libfribidi-dev \
    libgdal-dev \
    libgeos-dev \
    libharfbuzz-dev \
    libjpeg-dev \
    libpng-dev \
    libproj-dev \
    libssl-dev \
    libtiff-dev \
    libudunits2-dev \
    libuv1-dev \
    libxml2-dev \
    make \
    pandoc \
    proj-data \
    && rm -rf /var/lib/apt/lists/*

RUN R -e "pkgs <- c('shiny', 'bslib', 'terra', 'geodata', 'leaflet', 'sf', 'DT', 'ggplot2', 'callr', 'curl', 'maxnet', 'mgcv', 'shinyjs', 'future', 'future.apply', 'marginaleffects', 'mapview'); install.packages(pkgs, repos = 'https://cloud.r-project.org', Ncpus = max(1, parallel::detectCores() - 1)); missing <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]; if (length(missing)) stop('Package installation failed: ', paste(missing, collapse = ', '))" \
    && rm -rf /tmp/downloaded_packages /tmp/Rtmp*

# ─── Stage 2: Runtime image ────────────────────────────────────────
FROM rocker/r-ver:4.4.2@sha256:df26749182af64d5263bf64149d51a427b476ed28c4e046997143be3f97fdd7c

ENV DEBIAN_FRONTEND=noninteractive \
    RENV_CONFIG_AUTOLOADER_ENABLED=FALSE \
    PORT=3838

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    gdal-bin \
    libcurl4-openssl-dev \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libssl-dev \
    libudunits2-dev \
    libxml2-dev \
    proj-data \
    && rm -rf /var/lib/apt/lists/*

COPY --from=r-deps /usr/local/lib/R /usr/local/lib/R

WORKDIR /srv/sdm-dashboard

# Only copy files needed for the Shiny app — not the full project tree
COPY app.R R www data/examples DESCRIPTION /srv/sdm-dashboard/

RUN groupadd --system shiny --gid 999 && \
    useradd --system --create-home --gid shiny --uid 999 shiny && \
    chown -R shiny:shiny /srv/sdm-dashboard

USER shiny

EXPOSE 3838

CMD ["Rscript", "app.R"]
