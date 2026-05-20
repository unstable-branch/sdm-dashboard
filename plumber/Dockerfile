FROM rocker/r-ver:4.4.2

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev libproj-dev libgeos-dev libudunits2-dev \
    libcurl4-openssl-dev libssl-dev libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

RUN R -e "install.packages(c('plumber', 'terra', 'sf', 'jsonlite', 'geodata'), repos='https://cloud.r-project.org')"

WORKDIR /app

COPY R/ /app/R/
COPY plumber/ /app/plumber/

EXPOSE 8000

CMD ["Rscript", "-e", "plumber::pr_run(plumber::pr('/app/plumber/R/plumber.R'), host='0.0.0.0', port=8000)"]
