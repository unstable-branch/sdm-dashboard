# SDM Benchmark Design

## Objective

Quantitatively compare sdm-dashboard's model outputs against established SDM platforms (biomod2, flexsdm, Wallace/ENMeval) on a published benchmark dataset to validate prediction quality, identify systematic biases, and produce confidence metrics for the platform.

## Dataset

**Primary:** Valavi et al. 2022 presence-absence benchmark dataset ("bmcomm").

- 226 species across Australia
- Environmental predictors: 19 BIOCLIM + elevation
- GBIF occurrences + survey absences
- Published: https://doi.org/10.6084/m9.figshare.14212589
- R package: `bmcomm`

**Backup:** NCEAS SDM Workshop dataset (smaller, 12 species, global coverage).

## Species Subset

Select 15 species across three prevalence classes:

| Class | Prevalence | Count | Examples |
|-------|-----------|-------|----------|
| Common | ≥500 records | 5 | *Acacia longifolia*, *Eucalyptus camaldulensis* |
| Moderate | 100-500 records | 5 | *Calytrix tetragona*, *Hakea sericea* |
| Rare | <100 records | 5 | *Phebalium stenophyllum*, *Prostanthera spinosa* |

Selection criteria: geographic spread, environmental range coverage, at least one from each major Australian biome.

## Comparator Platforms

| Platform | Version | Algorithm(s) | Citation |
|----------|---------|-------------|----------|
| biomod2 | 4.3-4-6 | GLM, GAM, RF, MaxEnt, XGBoost, ensemble | Thuiller et al. 2024 |
| flexsdm | 1.3.9 | GLM, GAM, MaxEnt, RF, ensemble, ESM | Velazco et al. 2022 |
| Wallace / ENMeval | 2.2.1 / 2.0.5.2 | MaxEnt tuning | Kass et al. 2023, 2021 |

## Metrics

| Metric | What it measures | Used by |
|--------|-----------------|---------|
| AUC (ROC) | Discrimination rank | All platforms |
| TSS (max) | Optimal binarisation accuracy | All platforms |
| CBI (Continuous Boyce Index) | Predicted vs. expected ratio | sdm-dashboard, flexsdm |
| Spatial correlation | Spatial pattern similarity | Custom |
| Prediction raster correlation (Pearson) | Numerical agreement | Custom |
| Computation time | Performance | Custom |

## Test Harness Architecture

```
run_benchmark.R  (standalone R script)
├── 1. Install/load packages
├── 2. Load benchmark dataset
├── 3. For each species:
│   ├── a. Extract env data
│   ├── b. Run sdm-dashboard (via callr or direct module call)
│   ├── c. Run biomod2
│   ├── d. Run flexsdm
│   ├── e. Run ENMeval (for MaxEnt comparison)
│   ├── f. Collect metrics
│   └── g. Generate per-species report
├── 4. Aggregate metrics across species
└── 5. Generate comparison report (R Markdown → HTML)
```

### Parameter Canon

Parameter values mapped to enable comparable (not identical) model specifications:

| Parameter | sdm-dashboard | biomod2 | flexsdm | Notes |
|-----------|--------------|---------|---------|-------|
| Background points | 10,000 | 10,000 | 10,000 | Same PA set across platforms |
| CV folds | 5 | 5 | 5 | Standard 5-fold |
| CV strategy | random | random | random | For comparability |
| Seed | 42 | 42 | 42 | Same seed across runs |
| MaxEnt features | lqp | lqp | lqp | Default for all |
| MaxEnt regmult | 1.0 | 1.0 | 1.0 | Default for all |
| RF trees | 500 | 500 | 500 | Default |
| Threshold | max-TSS | max-TSS | max-TSS | Auto-selected |
| PA/species | presence/background | presence/background | presence/background | Same PA set |

## Known Confounds

1. **PA set consistency.** sdm-dashboard uses a uniform background (default). biomod2 uses pseudo-absences. For PA methods, we must ensure the exact same background/absence locations are used across platforms. This requires extracting the PA locations from sdm-dashboard and passing them to comparators.

2. **Algorithm implementation differences.** ranger (sdm-dashboard RF) vs. randomForest (biomod2 RF) may produce different results even with the same hyperparameters due to implementation details. These differences are expected and documented.

3. **MaxNet vs. maxent.jar.** sdm-dashboard uses maxnet (R/glmnet). ENMeval offers both maxnet and rJava-based maxent. We'll compare maxnet-to-maxnet where possible.

4. **Ensemble methods differ.** sdm-dashboard uses AUC-weighted averaging. biomod2 uses a broader set of ensemble methods (mean, median, committee averaging, weighted mean). We'll document the method used for each comparison.

## Outputs

| Artefact | Format | Consumer |
|----------|--------|----------|
| Per-species metric table | CSV | Analysis |
| Aggregate comparison table | CSV | Publication |
| Prediction raster correlation matrix | PNG/CSV | Spatial comparison |
| Benchmark report | R Markdown → HTML | Publication |
| Side-by-side prediction maps | PNG | Visual comparison |

## Execution Requirements

- R 4.3+ with all comparator packages installed (biomod2, flexsdm, ENMeval, bmcomm)
- 8+ GB RAM (226-species dataset is large)
- 2-4 hours runtime for full benchmark
- OR: run in Docker Plumber container for sdm-dashboard component

## Next Steps

1. Install R + required packages on a suitable host
2. Create `scripts/run_benchmark.R` per the architecture above
3. Execute on the 15-species subset
4. Review results and expand to full dataset if warranted
5. Publish as `docs/BENCHMARK_RESULTS.md` and optionally as a short paper
