FROM rocker/r-ver:4.4.2

LABEL org.opencontainers.image.title="SDM Dashboard — Shiny"
LABEL org.opencontainers.image.description="Legacy R/Shiny SDM workbench for local/desktop use"
LABEL org.opencontainers.image.source="https://github.com/unstable-branch/sdm-dashboard"

ENV DEBIAN_FRONTEND=noninteractive \
    RENV_CONFIG_AUTOLOADER_ENABLED=FALSE \
    PORT=3838

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

WORKDIR /srv/sdm-dashboard

# Only copy files needed for the Shiny app — not the full project tree
COPY app.R R/ www/ data/examples/ DESCRIPTION /srv/sdm-dashboard/

RUN groupadd --system shiny --gid 999 && \
    useradd --system --create-home --gid shiny --uid 999 shiny && \
    chown -R shiny:shiny /srv/sdm-dashboard

USER shiny

EXPOSE 3838

CMD ["Rscript", "app.R"]
