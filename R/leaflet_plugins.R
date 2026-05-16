# Leaflet plugin CDN resources for SDM Dashboard
# These plugins extend the Leaflet map with SDM-relevant features

get_leaflet_plugin_deps <- function() {
  list(
    htmltools::htmlDependency(
      name = "leaflet-side-by-side",
      version = "2.0.0",
      src = c(href = "https://unpkg.com/leaflet-side-by-side/"),
      stylesheet = "leaflet-side-by-side.css",
      script = "leaflet-side-by-side.js"
    ),
    htmltools::htmlDependency(
      name = "leaflet-draw",
      version = "1.0.4",
      src = c(href = "https://unpkg.com/leaflet-draw@1.0.4/dist/"),
      stylesheet = "leaflet.draw.css",
      script = "leaflet.draw.js"
    ),
    htmltools::htmlDependency(
      name = "leaflet.markercluster",
      version = "1.5.1",
      src = c(href = "https://unpkg.com/leaflet.markercluster@1.5.1/dist/"),
      stylesheet = "MarkerCluster.css",
      script = "leaflet.markercluster.js",
      all_files = FALSE
    ),
    htmltools::htmlDependency(
      name = "leaflet-heat",
      version = "0.2.0",
      src = c(href = "https://unpkg.com/leaflet-heat@0.2.0/"),
      script = "leafletheat.js",
      all_files = FALSE
    )
  )
}