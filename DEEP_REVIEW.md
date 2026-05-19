# SDM Dashboard — Deep Review (2026-05-19)

Beyond the bug fixes in the first review, here's a comprehensive analysis of
UI/UX, models, architecture, and improvement opportunities based on existing
plans in the repo.

---

## Existing Improvement Plans Found

The repo contains several detailed implementation plans:

1. **`SPEC.md`** — Full project specification, architecture, and v0.3.0-beta target
2. **`SDM_DASHBOARD_ESM_IMPLEMENTATION.txt`** (700 lines) — Complete ESM implementation plan with code, tests, acceptance criteria. **ESM is already fully implemented** in `R/model_esm.R` — this plan was executed.
3. **`BIOMOD2_ADAPTER_NOTES.md`** — biomod2 gating strategy (implemented)
4. **`INTERPRETATION.md`** — User-facing output interpretation guide
5. **`METHODS.md`** — Statistical methods documentation

**Status:** ESM, biomod2 gating, multi-model ensemble, and all planned covariate
modules are implemented. The SPEC.md "v0.3.0-beta" targets (distance thinning,
spatial-block CV, expanded diagnostics) are all done. The dashboard is closer
to v0.5.0+.

---

## Model Architecture Review

### Model Registry — Well Designed
The `sdm_model_registry` pattern is clean. Models self-register at load time,
conditional on package availability. This is the right approach.

**Registered models (conditional on packages):**

| Model | Maturity | Packages | Notes |
|-------|----------|----------|-------|
| GLM | Stable | stats | Default, solid |
| GAM | Experimental | mgcv | Smooth response curves |
| Rangebagging | Experimental | terra | No external deps |
| Ensemble GLM+Rangebag | Experimental | terra | Simple 2-model |
| MaxEnt (maxnet) | Experimental | maxnet, glmnet | No Java needed |
| Multi-Model Ensemble | Experimental | terra | Any 2+ standalone + biomod2 |
| biomod2 | Experimental | biomod2 | Gated behind option |
| ESM-GLM | Experimental | ecospat, biomod2 | Rare species, <30 records |
| ESM-MaxEnt | Experimental | ecospat, biomod2, maxnet | Rare species, nonlinear |
| DNN | **Dormant** | cito, torch | Not wired to UI |

### Multi-Model Ensemble — Solid Implementation

`R/model_multi_ensemble.R` is thorough:
- Combines any standalone (GLM, GAM, MaxNet, Rangebag) + biomod2 algorithms
- AUC/TSS/equal weighting with configurable power exponent
- Min AUC/TSS thresholds filter weak models
- Produces: weighted mean, median, committee (binary agreement), SD (uncertainty)
- Component predictions can be exported individually
- Clean separation: `fit_multi_model_ensemble` → `predict_multi_model_ensemble`

**Issues found:**
1. **`predict_multi_model_ensemble` writes 4-6 rasters unconditionally.** Even if the user only needs the weighted output, it writes mean, median, committee, SD, and all component rasters. This is wasteful for large extents. Consider making these optional via config.
2. **Ensemble committee uses per-component CV threshold** (`comp_cv$threshold %||% 0.5`) which may not match the user's chosen threshold. The committee binary conversion should use the global `input$threshold`.
3. **`extract_biomod2_algorithm_files` has a fragile pattern match** (`paste0("_", algo, "[^a-zA-Z]")`) that could match wrong files if algo names overlap.
4. **No parallel prediction of components.** Components are predicted sequentially. For 5+ models, this could be parallelized with `future`/`parallel`.

### ESM — Complete and Well-Documented

`R/model_esm.R` follows the Breiner et al. 2015/2018 methodology correctly:
- Bivariate model decomposition via `ecospat::ecospat.ESM.Modeling`
- AUC-weighted ensemble with configurable min_auc filter
- Variable importance derived from pair weights
- Pair heatmap visualization via ggplot2
- Clean contract matching other models

**Issues found:**
1. **ESM suitability divided by 1000** (line from `predict_esm_suitability`): `suit_values <- unname(ens_proj) / 1000`. The scaling assumption (ecospat outputs 0-1000) should be validated against current ecospat version — if ecospat changes this, suitability values will be wrong.
2. **`extract_esm_importance` pattern matching** uses `grep(paste0("(^|_)", v, "(_|$)"), names(w))`. If variable names contain underscores (e.g., `bio_12`), the pattern `bio_12` would match `bio_12_bio_15` but NOT `bio1_bio12`. The current naming convention (`bio1`, `bio4`, etc.) avoids this, but it's fragile.

---

## UI/UX Review

### Strengths
- **Get Data tab** is comprehensive — one-stop covariate management with download, verify, cache summary, and activity log
- **Dark/light theme** toggle is smooth with CSS variables
- **Readiness panel** gives clear pre-flight checks before running
- **Welcome panel** with 4-step onboarding is helpful for new users
- **Interactive occurrence map** with click-to-flag records is excellent for data cleaning
- **Ensemble diagnostics** show weights table, ESM pair heatmap, variable importance

### UX Issues

#### 1. Sidebar is Overwhelming
The sidebar has 7+ collapsible sections, some with multiple nested `conditionalPanel`s. Key issues:
- **Model settings is collapsed by default** — new users won't discover ESM, MaxEnt, or ensemble options
- **Optional covariates is also collapsed** — elevation, soil, vegetation are hidden
- **Advanced settings** contains important options (VIF reduction, bias correction, thinning) that are buried

**Suggestion:** Show a simplified sidebar by default with just: Species, Data Source, Model (with smart recommendation), BIO variables, Run button. Put everything else behind an "Advanced" toggle.

#### 2. No Model Comparison View
After running a model, there's no way to compare it against a previous run. Users can't see side-by-side GLM vs MaxEnt vs Ensemble results.

**Suggestion:** Store last N runs and add a "Compare runs" tab or dropdown.

#### 3. Future Projection Tab Shows Empty Plots Before Run
The "Future projection" tab shows two placeholder plots even when future projection is off. This is wasted space and confusing.

**Suggestion:** Hide the tab entirely when `input$future_projection == FALSE`, or show a clear "Enable future projection in sidebar" message.

#### 4. Run Log is Plain Text
The run log in Model Diagnostics is a scrolling div of timestamped text. For multi-model ensemble runs with 5+ components, this becomes a wall of text.

**Suggestion:** Parse the log into structured sections (Data → Covariates → Model → CV → Projection) with collapsible detail.

#### 5. No Progress Bar During Model Run
There's a Shiny `Progress` bar but the actual model run blocks the R session. For large rasters or multi-model ensembles, the UI appears frozen.

**Suggestion:** Consider running the model in a `future` or `callr` background process (like Get Data downloads already do), with a reactive polling pattern.

#### 6. Download Buttons Are Disabled Without Visual Feedback
Download buttons appear greyed out before a run, but there's no tooltip explaining why. The "Downloads are enabled after a successful run" text is easy to miss.

#### 7. Metric Cards Show "-" Before Run
The 4 metric cards at the top show dash placeholders. This is functional but could show more useful pre-run state (e.g., "Select data and click Run SDM").

#### 8. No Persistent Settings
All sidebar settings reset on page refresh. For iterative modelling workflows, this is painful.

**Suggestion:** Save last-used settings to `localStorage` or a config file and restore on load.

### Visual Design
- The dark theme is polished with good contrast
- CSS variable system (`--sdm-*`) is well-structured
- Card-based layout is clean
- The hero header is nice but takes vertical space — consider a compact mode

---

## Architecture & Code Quality

### Module Coupling
The 4 Shiny modules (`mod_get_data`, `mod_model_run`, `mod_results`, `mod_readiness`) all receive `rv` and `input` directly. This is a shared-state architecture — not terrible for a single-page app, but:
- Any module can read/write any `rv$` field
- Changes in one module can cause unexpected reactivity in another
- Hard to test modules in isolation

### `run_sdm.R` — The Orchestrator
This is a 480-line function that does everything: load data → build covariates → fit model → predict → compute metrics → write outputs → generate reports. It's well-structured but monolithic. Breaking it into smaller pipeline stages would improve testability and error recovery.

### Dependency on `geodata`
WorldClim downloads depend entirely on `geodata::worldclim_global()`. If geodata's API changes or WorldClim's server is down, the app has no fallback. Consider caching the zip download and reusing it.

### File Organization
The `R/` directory has 60+ files all at one level. Consider grouping:
```
R/
  core/     (bootstrap, config, packages, load, logging)
  data/     (occurrences, occurrences_dwca, download_helper)
  covariates/  (climate, elevation, soil, vegetation, ...)
  models/   (glm, gam, maxnet, rangebag, ensemble, esm, biomod2, dnn, registry)
  ui/       (header, sidebar, tabs, helpers)
  modules/  (mod_get_data, mod_model_run, mod_results, mod_readiness)
```

---

## Feature Gaps (Relative to SPEC.md and ESM Plan)

1. **DNN models are dormant** — `model_dnn.R` exists (668 lines) but is not wired to UI. `torch_setup.R` handles GPU/CPU detection. If torch isn't installed, DNN is invisible.

2. **No model comparison across runs** — SPEC doesn't mention this but it's the most common SDM workflow (run GLM, run MaxEnt, compare AUC/maps).

3. **Spatial-block CV only for GLM** — Other backends use their own default CV. The `cv_strategy = "spatial_blocks"` option is ignored for MaxNet, GAM, Rangebagging.

4. **No response curve plots in results tab** — `R/response_curves.R` exists but isn't rendered in the UI. Users can't see marginal response curves.

5. **Script export doesn't include ESM/multi-ensemble** — `R/script_export.R` generates reproducible R scripts but may not cover newer backends.

6. **No batch results summary** — Batch mode runs multiple species but there's no summary table comparing results across species.

---

## Priority Improvement Recommendations

### High Impact
1. **Wire response curve plots into the Diagnostics tab** — code exists, just needs UI
2. **Add model comparison** (store results, side-by-side maps/AUC)
3. **Break `run_sdm.R` into pipeline stages** for better error recovery
4. **Run model in background process** (like Get Data downloads) to prevent UI freeze
5. **Persistent settings via localStorage** or project config file

### Medium Impact
6. **Parallel component prediction** in multi-model ensemble
7. **Group R/ into subdirectories** for maintainability
8. **Add "smart model" recommendation** based on record count (partially done via ESM recommendation)
9. **Hide/show tabs based on context** (Future tab only when enabled)
10. **Add spatial-block CV to MaxNet and GAM**

### Low Impact / Polish
11. **Compact hero header option**
12. **Structured run log** with sections
13. **Download button tooltips** explaining prerequisites
14. **Better pre-run metric card state**
15. **Add batch results summary table**

---

## Files Worth Reading

If you want to understand specific areas:
- **ESM implementation plan:** `SDM_DASHBOARD_ESM_IMPLEMENTATION.txt` (700 lines, very detailed)
- **Project spec:** `SPEC.md` (complete architecture + functionality spec)
- **Methods documentation:** `METHODS.md` (cited methods for papers)
- **Output interpretation:** `INTERPRETATION.md` (what AUC/TSS/suitability actually mean)
