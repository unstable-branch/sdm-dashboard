ui_header <- function() {
  div(
    class = "hero",
    div(
      class = "hero-top",
      div(
        div(class = "hero-kicker", "Experimental multi-model SDM workbench"),
        h1("Species Distribution Model"),
      ),
      tags$label(
        class = "theme-toggle",
        `for` = "dark_mode",
        title = "Toggle dark/light mode",
        tags$input(type = "checkbox", id = "dark_mode"),
        span(class = "theme-toggle-slider")
      )
    ),
    p("Clean occurrence records, compare model backends, and export habitat suitability maps from one local-first dashboard."),
    div(class = "hero-badges", uiOutput("hero_badges"))
  )
}
