# Interpreting SDM Outputs

This guide helps you understand what the dashboard's outputs mean, spot common failure modes, and decide what to do next.

---

## Suitability Map

The map shows **habitat suitability** — a continuous score from 0 (least suitable) to 1 (most suitable). It is a relative measure, not a probability of presence.

**What high suitability means:** Cells with suitability near 1 are most environmentally similar to the conditions where your species has been recorded, relative to your background sample. They are not "definitely present".

**What low suitability means:** Low-suitability cells are outside the environmental envelope of your training data. Do not treat them as "definitely absent" — the species may simply not have been recorded there, or the habitat may genuinely be unsuitable.

---

## AUC — Area Under the ROC Curve

AUC summarises how well the model separates presences from the background sample across all possible thresholds.

| AUC | Interpretation |
|-----|---------------|
| < 0.5 | Worse than random — something is wrong (check for coordinate errors, label swaps) |
| 0.5–0.6 | Poor; model is barely better than random |
| 0.6–0.7 | Moderate; useful for exploration |
| 0.7–0.8 | Good; reasonable discrimination |
| 0.8–0.9 | Very good; strong discrimination |
| > 0.9 | Suspiciously high — possible overfitting, sampling bias, or data leakage |

**What to do when AUC is low:**

1. Check for coordinate errors in your occurrence data
2. Verify your projection extent matches the species' known range
3. Try adding or removing BIO variables
4. Consider whether the background sampling method is appropriate
5. If AUC < 0.6, model projections should be treated with caution and not used for operational decisions

**Important caveat:** AUC on presence/background data is inherently optimistic compared to presence/absence data. Treat it as a relative ranking metric, not an absolute measure of model quality.

---

## TSS — True Skill Statistic

TSS = Sensitivity + Specificity − 1. It is threshold-dependent (unlike AUC).

| TSS | Interpretation |
|-----|---------------|
| < 0 | Worse than random |
| 0–0.4 | Poor to fair |
| 0.4–0.6 | Moderate |
| 0.6–0.8 | Good |
| > 0.8 | Very good (rare in SDM; check for overfitting) |

A TSS of 0.6 at a threshold of 0.5 means that at that threshold, the model correctly identifies 60% more true positives than expected by chance while also correctly identifying the same proportion of true negatives.

---

## CBI — Continuous Boyce Index

CBI is computed only from presence records (unlike AUC/TSS which use both presences and background). It is the rank correlation between expected-to-observed ratios and suitability scores across suitability bins.

| CBI | Interpretation |
|-----|---------------|
| < 0 | Model performs worse than random |
| 0–0.3 | Poor |
| 0.3–0.5 | Moderate |
| 0.5–0.8 | Good |
| > 0.8 | Excellent |

CBI values above 0.5 indicate the model consistently assigns higher suitability to locations where the species has been recorded. If CBI < 0, the model is worse than a random habitat suitability surface.

---

## MESS — Multivariate Environmental Similarity Surface

MESS values < 0 indicate that for at least one covariate, the projected cell lies **outside the full range of that variable in the training data**. These are extrapolation cells.

**Decision tree for high extrapolation:**

1. **< 10% of cells extrapolating:** Acceptable; flag these regions as uncertain in your report
2. **10–30% extrapolating:** Review carefully; consider reducing projection extent or adding covariates to fill the environmental gap
3. **> 30% extrapolating:** Stop — more than a third of your projection is in non-analog climate. Do not use the projection without a disclaimer and expert review

Open the MOD (Most Dissimilar Variable) raster to identify which BIO variable is driving extrapolation in each cell. This tells you which climate dimension your projection is stretching into.

---

## Permutation Importance

Permutation importance measures how much model AUC drops when a covariate's values are randomly shuffled (breaking its relationship with the response). Higher importance = more dependent the model is on that variable.

**Interpreting importance values:**

- Variables with importance > 0.05 (5 percentage points of AUC drop) are substantively contributing to the model
- Variables with importance near 0 are not being used by the model (either redundant or not informative)
- If all variables have near-zero importance, the model may be near-random

---

## Response Curves

Response curves show how predicted suitability changes as each covariate varies from its observed minimum to maximum, with all other covariates held at their training mean.

**What to look for:**

- **Monotonically increasing/decreasing curves** are ecologically plausible for many species
- **Peak-shaped curves** (suitability highest at intermediate values) are common for temperature and precipitation variables
- **Flat or erratic curves** suggest the variable is not informative or is confounded with other variables
- **Abrupt drops to zero** at the extremes indicate the model is extrapolating and should be interpreted cautiously beyond the training range

---

## Threshold Choice

The default threshold is 0.5 (midpoint). If you change it:

- **Lower threshold** (e.g., 0.3): More area classified as "suitable", fewer false absences, more false positives
- **Higher threshold** (e.g., 0.7): Less area classified as "suitable", fewer false positives, more false absences

For **conservation planning**, a lower threshold is often preferable (accept more false positives to avoid missing suitable habitat). For **invasion risk mapping**, a higher threshold may reduce false alarms.

---

## Spatial-Block Cross-Validation Warnings

If the run log shows:
```
Spatial-block CV: only N block(s) for K folds. Falling back to random CV.
```

This means your geographic extent and chosen block size produce fewer distinct spatial blocks than folds. The model falls back to random CV, which may inflate CV scores due to spatial autocorrelation.

To use true spatial-block CV:

1. Increase the projection extent to give more spatial blocks
2. Reduce the number of CV folds
3. Reduce the automatic block size using the block size parameter if your software supports it

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| AUC < 0.55 | Bad coordinates or very few presence records | Check and re-clean occurrence data |
| All cells very low suitability (< 0.1) | Wrong projection extent; covariate mismatch | Verify extent and BIO layer alignment |
| Very high AUC (> 0.95) | Overfitting; spatial autocorrelation inflating CV | Use spatial-block CV; reduce covariates |
| MESS > 30% extrapolation | Projection extent beyond training area | Reduce extent or use a more representative training area |
| TSS near 0 | Model is not informative | Try different covariates or model settings |
| CBI < 0 | Model predictions inversely correlated with reality | Check for coordinate errors or class label issues |

---

## When NOT to Trust the Model

Stop and do not use projections operationally if:

1. AUC < 0.6 AND CBI < 0.3
2. More than 30% of projected cells show negative MESS (extrapolation)
3. Response curves are flat or erratic for most covariates
4. The species has fewer than ~20 clean occurrence records
5. The model was trained on a very small geographic extent and projected broadly

In all cases, treat outputs as exploratory and seek expert ecological review before operational decisions.