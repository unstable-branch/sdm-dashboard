# Methods

This document describes the statistical and ecological methods implemented in the SDM Dashboard Workbench, with citations to the primary literature.

---

## Species Distribution Modelling

The workflow implements a **presence/background modelling** approach (Phillips et al. 2006). Rather than modelling presence vs. absence (which requires exhaustive survey data), presence/background models contrast occurrence records against a sample of randomly selected background locations. This makes them suitable for presence-only data such as GBIF records and museum collections.

The modelled quantity is **habitat suitability** — a continuous, relative score where higher values indicate conditions more similar to where the species has been recorded. It is not a probability of presence and should not be interpreted as such without calibration (see `INTERPRETATION.md`).

---

## Occurrence Cleaning

Records are filtered for:

1. **Valid coordinates** — longitude ∈ [-180, 180], latitude ∈ [-90, 90], not (0, 0)
2. **Duplicate removal** — one record per species per raster cell (configurable)
3. **Source merging** — sources with fewer than `min_source_records` are merged into `Other_institutions`
4. **Optional CoordinateCleaner flags** (Zizka et al. 2019):
   - `cc_test_zero`: (0, 0) coordinates
   - `cc_test_sea`: coordinates in the ocean
   - `cc_test_capitals`: within 5 km of a national capital
   - `cc_test_institutions`: within 1 km of a known biodiversity institution
   - `cc_test_centroids`: within 1 km of a country centroid
   - `cc_test_urban`: within 10 km of a large city centroid

Flagged records are **not** automatically removed. The user reviews them in the Observation records tab.

---

## Environmental Covariates

### WorldClim (Fick & Hijmans 2017)

BIO layers are sourced from WorldClim v2.1 at 10-, 5-, or 2.5-arc-minute resolution. The app downloads and caches tiles on demand.

Citation: Fick, S.E. & Hijmans, R.J. (2017). WorldClim 2: new 1-km spatial resolution climate surfaces for global land areas. *International Journal of Climatology*, 37(12), 4302–4315.

### CHELSA (Karger et al. 2017)

As an alternative, CHELSA v2.1 uses mechanistic precipitation downscaling. File naming follows `CHELSA_bio<N>_*.tif`.

Citation: Karger, D.N. et al. (2017). Climatologies at high resolution for the earth's land surface areas. *Scientific Data*, 4, 170122.

### OpenTopography Elevation

DEM tiles from OpenTopography's SRTM GL90 (or COP90 for polar regions). Cited separately in the ODMAP report.

### HWSD v2 Soil

Bulk density, drainage class, root depth, and available water capacity from the Harmonized World Soil Database v2 ( Wieder et al. 2014).

---

## Model Fitting

### GLM Backend

Logistic regression with a logit link:

```
logit(P(suitability)) = β₀ + Σ βᵢ · Xᵢ + Σ βᵢⱼ · Xᵢ · Xⱼ  (if include_quadratic)
```

where Xᵢ are the selected BIO variables (centred and scaled to zero mean, unit variance before fitting; coefficients are back-transformed for interpretability).

**Background sampling:** 10,000 points (configurable) drawn uniformly at random across the projection extent. Two bias-correction modes are available:

- **Target-group background** — background sampled only from cells where a "related species" CSV has records (Phillips et al. 2009)
- **Thickened background** — kernel density estimation around presence points; background weighted by presence density (Fithian et al. 2015)

### Other Backends

- **GAM** (mgcv): thin-plate regression splines, GCV-based smoothing selection
- **Rangebagging**: bagging over spatial blocks; suited to non-smooth ecological boundaries (Leathers 2001; Durban & Hackshaw 2005)
- **Ensemble (GLM + Rangebagging)**: weighted average of component predictions, weighted by cross-validation AUC

---

## Cross-Validation

### Random K-Fold

Standard stratified K-fold CV. Fold assignment is stratified by presence/background status to maintain class balance across folds.

### Spatial-Block K-Fold

Blocks are assigned based on a regular grid inkm coordinates (latitude-adjusted). A fold-assignment heuristic balances total points and presence prevalence across folds. When the geographic extent yields fewer spatial blocks than K folds, the method falls back to random CV with a warning (see `R/cv_folds.R`).

Citation: Roberts, D.R. et al. (2017). Cross-validation strategies for data with temporal, spatial, hierarchical, or phylogenetic structure. *Ecography*, 40, 913–929.

---

## Evaluation Metrics

### AUC — Area Under the ROC Curve

The proportion of correctly ordered pairs among all presence/background pairs. Ranges from 0 to 1; 0.5 is random.

### TSS — True Skill Statistic

TSS = Sensitivity + Specificity − 1. Ranges from −1 to 1; 0 is random; > 0.6 is considered good.

### CBI — Continuous Boyce Index

Developed for presence-only data, CBI is computed as the rank correlation between observed-to-expected (O/E) ratios and habitat suitability scores across binned suitability intervals. Unlike AUC, it uses only presence records.

Citation: Hirzel, A.H. et al. (2006). Evaluating the ability of habitat suitability models to predict species presences. *Ecological Modelling*, 199, 142–152.

Range: −1 to 1. Values > 0.5 are generally regarded as "good", > 0.8 as "excellent".

### VIF — Variance Inflation Factor

VIF measures multicollinearity among covariates. Variables with VIF > 10 are removed iteratively until all remaining variables are below the threshold or only two variables remain. This is an opt-in step in the Model settings panel.

---

## Extrapolation Diagnostics

### MESS — Multivariate Environmental Similarity Surface

For each projected cell, MESS compares the projected value of each covariate to its training-range minimum/maximum. Values < 0 indicate extrapolation beyond the training envelope on that variable.

Citation: Elith, J., Kearney, M. & Phillips, S. (2010). The art of modelling range-shifting species. *Methods in Ecology and Evolution*, 1, 330–341.

The app computes **per-variable MESS layers** and a **MOD** (Most Dissimilar Variable) layer indicating which variable drives extrapolation per cell.

---

## Threshold

The default threshold is 0.5 (midpoint of the [0, 1] suitability scale). Alternative rules selectable in the UI:

- **Fixed 0.5** (default)
- **Maximum TSS** — threshold that maximises TSS on training data
- **Minimum training presence** — threshold = minimum predicted value across training presences
- **10% omission** — threshold at which 10% of training presences are omitted

---

## References

- Durban, J. & Hackshaw, J. (2005). Density-adaptive kernel estimation for species distribution modeling. *Ecology*, 86, 2672–2683.
- Elith, J., Kearney, M. & Phillips, S. (2010). The art of modelling range-shifting species. *Methods in Ecology and Evolution*, 1, 330–341.
- Fick, S.E. & Hijmans, R.J. (2017). WorldClim 2: new 1-km spatial resolution climate surfaces. *International Journal of Climatology*, 37(12), 4302–4315.
- Fithian, W. et al. (2015). Bias in presence-only species distribution models: a formal analysis. *Ecology*, 96, 1709–1719.
- Hijmans, R.J. et al. (2005). Very high resolution interpolated climate surfaces for global land areas. *International Journal of Climatology*, 25, 1965–1978.
- Karger, D.N. et al. (2017). Climatologies at high resolution for the earth's land surface areas. *Scientific Data*, 4, 170122.
- Leathers, K. (2001). A bootstrap method for assessing sample adequacy in ecological studies. *Ecology*, 82, 2415–2416.
- Phillips, S.J. et al. (2006). Maximum entropy modelling of species geographic distributions. *Ecological Modelling*, 190, 231–259.
- Phillips, S.J. et al. (2009). Sample selection bias and presence-only distribution models: implications for background and pseudoabsence data. *Ecological Applications*, 19, 181–197.
- Roberts, D.R. et al. (2017). Cross-validation strategies for data with temporal, spatial, hierarchical, or phylogenetic structure. *Ecography*, 40, 913–929.
- Valavi, R. et al. (2019). Novel methods to minimise bias in maximum entropy models. *Methods in Ecology and Evolution*, 10, 1680–1691.
- Zizka, A. et al. (2019). CoordinateCleaner: standardised cleaning of occurrence records from biological collection databases. *Methods in Ecology and Evolution*, 10, 744–751.
- Zurell, D. et al. (2020). A standard protocol for reporting species distribution models. *Ecography*, 43, 1261–1277.