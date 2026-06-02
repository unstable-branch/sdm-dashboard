# Phase 8 Prep — Benchmark Groundwork (Feasibility Assessment)

## Assessment: FEASIBLE as a design artifact, NOT feasible for execution

### What can be done now (read-only):

| Component | Feasible? | Deliverable |
|-----------|-----------|-------------|
| Benchmark dataset identification | ✓ | Valavi et al. 2022 dataset (226 species, presence-absence) — publicly available at https://doi.org/10.6084/m9.figshare.14212589 |
| Species selection protocol | ✓ | Choose 10-20 species across prevalence range (rare, common, widespread) |
| Metric comparison design | ✓ | AUC, TSS, CBI (Boyce), spatial prediction maps, ODMAP comparison |
| Test harness architecture | ✓ | R script that calls both sdm-dashboard's `run_fast_sdm()` and comparator packages with the same inputs |
| Integration spec for Plumber API | ✓ | Endpoint mapping for parameter translation (camelCase ↔ snake_case) |
| Parameter canon | ✓ | Which sdm-dashboard defaults map to which comparator defaults |

### What cannot be done:

| Component | Why blocked |
|-----------|-------------|
| Run models | No R on host |
| Numerical diff of outputs | No R, no Plumber container |
| Performance comparison | No R |
| Cross-backend consistency check | No R |

## Recommended Groundwork Deliverable

A design document at `docs/BENCHMARK_DESIGN.md` containing:

1. **Dataset selection** — Valavi et al. 2022 "bmcomm" dataset (tidy presence-absence for 226 species across Australia). Sourced from GBIF + BIOCLIM + SRTM. Rationale: published, benchmarked, multi-species, covers both common and rare species.

2. **Species subset** (example — 10 species):
   - Common (≥500 records): *Acacia longifolia*, *Eucalyptus camaldulensis*
   - Moderate (100-500 records): *Calytrix tetragona*, *Hakea sericea*
   - Rare (<50 records): *Phebalium stenophyllum*, *Prostanthera spinosa*

3. **Comparator platforms:**
   - biomod2 v4.3-4-6 (10 algorithms, ensemble)
   - flexsdm v1.3.9 (GLM, GAM, MaxEnt, RF, ensemble, ESM)
   - Wallace v2.2.1 (MaxEnt tuning via ENMeval)

4. **Metrics:** AUC, TSS, CBI, spatial correlation (Iverson's), prediction raster pair-wise correlation

5. **Test harness architecture:**
   ```
   R script
   ├── 1. Load benchmark data
   ├── 2. Run sdm-dashboard (via callr or direct module call)
   ├── 3. Run biomod2
   ├── 4. Run flexsdm
   ├── 5. Run Wallace (via ENMeval for MaxEnt)
   ├── 6. Compare metrics
   └── 7. Generate comparison report (R Markdown)
   ```

6. **Parameter canon:** Defaults per platform mapped to equivalent sdm-dashboard config values — to ensure comparable (not identical) parameterisation.

7. **Known confounds:**
   - sdm-dashboard uses presence/background, others use presence/absence (biomod2, flexsdm accept PA with weights). Need to ensure same PA set across platforms.
   - Random forest implementations differ (ranger vs. randomForest vs. h2o)
   - PA sampling strategy: sdm-dashboard uses uniform by default; others may use different strategies

Would you like me to write the full `BENCHMARK_DESIGN.md` file with all those sections fleshed out?
