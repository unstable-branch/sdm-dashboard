ui_header <- function() {
  div(class = "hero",
    div(class = "hero-kicker", "Experimental multi-model SDM workbench"),
    h1("Species Distribution Model"),
    p("Clean occurrence records, compare model backends, and export habitat suitability maps from one local-first dashboard."),
    div(class = "hero-badges",
      span("CSV/data ready"), span("BIO vars configured"), span("GLM ready"), span("Provenance exports")
    )
  )
}