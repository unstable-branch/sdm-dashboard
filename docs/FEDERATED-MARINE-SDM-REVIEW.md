# Federated SDM, Marine SDM & Model Backend Review

**Date:** 2026-05-27  
**Type:** Feasibility assessment

---

## Part 1: Federated SDM Review

### Goal
Enable SDM computation across multiple Plumber nodes — distributing work, adding capacity, and supporting cross-organisation model training without sharing raw data.

### Current Architecture

```
Hono API (single instance)
  │ BullMQ queue → always dispatches to localhost:8000
  ▼
Plumber R (single instance, port 8000)
  │ callr::r_bg spawns local R processes
  │ sdm_process_registry — in-memory, per-node
  │ outputs/ — local filesystem
  │ Worldclim/ — local filesystem
  │ data/uploads/ — local filesystem
  ▼
PostgreSQL + Redis + Garage S3
```

### What Already Works for Federation

| Component | Why It Helps |
|---|---|
| **PlumberClient** (`api/src/services/plumber.ts`) | HTTP abstraction. Swapping the base URL per-request is trivial. |
| **BullMQ** (`api/src/services/queue.ts`) | Redis-backed queue. Workers can run on any machine. |
| **Garage S3** for COG storage | Already object-storage based. |
| **PostgreSQL `runs` table** | Single source of truth for job state. All nodes see the same DB. |
| **`X-Forwarded-User` header** | Identity works across nodes (validated against shared DB). |
| **Plumber auth filter** | Stateless — validates against PostgreSQL. No per-node config. |
| **`PLUMBER_INTERNAL_KEY`** | Shared secret for Hono→Plumber trust already exists. |

### What Blocks Federation Today

| Problem | Current State | Impact |
|---|---|---|
| **Filesystem coupling** | `outputs/jobs/<id>/`, `Worldclim/`, `chelsa/`, `data/uploads/` are all local disk | A job started on Node A can't be monitored or completed by Node B. |
| **Process registry** | `sdm_process_registry` is an in-memory R env on each Plumber node | No node can discover or manage jobs running on another node. |
| **Hardcoded routing** | BullMQ worker always calls `http://localhost:8000` | No load balancing, no failover, no capacity scaling. |
| **No node registry** | Hono has no list of available Plumber nodes | Worker has nothing to route to. |
| **Progress tracking** | `meta.json` + `progress.json` written to local disk | Cannot monitor remote job progress without filesystem access. |
| **Crash detection** | Relies on `tools::ps()` checking local PID | Can't detect crashes on remote nodes. |

### Migration Path (4 phases)

#### Phase 1: Shared Filesystem (highest priority, ~3-4 weeks)

Move `outputs/jobs/` from local disk to the existing Garage S3 infrastructure, or to an NFS mount shared by all Plumber nodes.

**Changes:**
- `plumber/R/plumber.R`: Replace `file.path(job_dir, "meta.json")` reads/writes with S3 GET/PUT
- `plumber/R/run_server.R`: Orphan cleanup scans S3, not local `outputs/jobs/`
- `plumber-sync.ts`: `encryptOutputs()` reads from S3, not from `PROJECT_ROOT/outputs/jobs/`
- `api/src/routes/results.ts`: Serve files from S3, not local disk

**S3 client in R:** Use the existing Garage S3 credentials already configured in `plumber/R/run_server.R` (`GARAGE_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` env vars). The S3 endpoint, bucket, and credentials are already wired — only the HTTP layer needs adding.

```r
# plumber/R/s3_utils.R — new file
s3_get_json <- function(bucket, key) {
  url <- sprintf("%s/%s/%s", Sys.getenv("GARAGE_ENDPOINT"), bucket, key)
  sig <- garage_hmac_signature(
    method = "GET",
    path = paste0("/", bucket, "/", key),
    access_key = Sys.getenv("S3_ACCESS_KEY_ID"),
    secret_key = Sys.getenv("S3_SECRET_ACCESS_KEY")
  )
  resp <- httr::GET(url, httr::add_headers(Authorization = sig))
  httr::content(resp, "parsed")
}

s3_put_json <- function(bucket, key, data) {
  # Use same env-var-based pattern
}
```

#### Phase 2: Node Registry + Dynamic Routing (~2-3 weeks)

Add a node registry so BullMQ knows where to dispatch jobs.

**New DB table:**
```sql
CREATE TABLE plumber_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 3,     -- Max concurrent runs
  status TEXT NOT NULL DEFAULT 'active',    -- active, draining, offline
  current_load INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Changes:**
- Plumber nodes report heartbeat on a timer (existing `/health` endpoint extended with load info)
- `queue.ts` `enqueueSdmJob()` selects a healthy node with spare capacity
- `runs` table gains `node_id` column
- `plumber-sync.ts` routes status queries to the correct node based on `runs.node_id`

**Dispatch logic:**
```typescript
// queue.ts — federated dispatch
async function selectNode(): Promise<PlumberNode> {
  const nodes = await db.select().from(plumberNodes)
    .where(and(
      eq(plumberNodes.status, 'active'),
      lt(plumberNodes.currentLoad, plumberNodes.capacity),
      gt(plumberNodes.lastHeartbeat, minutesAgo(5))
    ))
    .orderBy(asc(plumberNodes.currentLoad))
    .limit(1)

  if (nodes.length === 0) throw new Error('No healthy Plumber nodes available')
  return nodes[0]
}

async function enqueueSdmJob(payload: SdmJobPayload) {
  const node = await selectNode()
  const job = await queue.add('sdm-job', {
    ...payload,
    targetNode: node.id
  })
  return job
}
```

#### Phase 3: Climate Data + Uploads on S3 (~2-3 weeks)

Move `Worldclim/`, `chelsa/`, `Worldclim_future/`, and `data/uploads/` to S3.

**Changes:**
- `R/covariates/covariates_climate.R`: Download WorldClim/CHELSA tifs to a temp dir, then upload to S3. On subsequent reads, check S3 first.
- `plumber/R/plumber.R` upload endpoint: Write to S3 instead of local `data/uploads/`.
- `R/data/occurrences.R` `read_occurrence_file()`: Accept S3 URI.
- Climate cache verification (`verify_cache.R`): Check S3, not local filesystem.

**Read-through cache pattern:**
```r
get_bio_raster <- function(biovar, source) {
  s3_key <- sprintf("climate/%s/wc2.1_10m_bio_%d.tif", source, biovar)

  # Check S3 first
  if (s3_object_exists("sdm-climate", s3_key)) {
    return(s3_read_raster("sdm-climate", s3_key))
  }

  # Fall back to local (legacy)
  local_path <- file.path("Worldclim", basename(s3_key))
  if (file.exists(local_path)) {
    terra::rast(local_path)
  } else {
    NULL
  }
}
```

#### Phase 4: Horizontal Autoscaling (~2 weeks, ongoing)

- Plumber nodes register themselves on startup via a startup script that posts to the Hono admin API
- BullMQ queue length metrics drive auto-scaling (Docker Compose replicas or Kubernetes HPA)
- Graceful shutdown: Plumber node sets status to `draining`, finishes current jobs, deregisters
- No filesystem dependency remains — all state in S3 or PostgreSQL

### Summary: What Changes Per Component

| Component | Phase 0 (now) | Phase 4 (federated) |
|---|---|---|
| `outputs/jobs/` | Local disk | Garage S3 |
| `Worldclim/` | Local disk | Garage S3 with read-through cache |
| `data/uploads/` | Local disk | Garage S3 with presigned URLs |
| `sdm_process_registry` | In-memory per node | Not needed (heartbeat + S3 progress) |
| `meta.json` | Local file | S3 object |
| `progress.json` | Local file | S3 object (or Redis stream) |
| `PLUMBER_URL` | `http://localhost:8000` | Per-job from node registry |
| BullMQ worker | Fixed localhost | Dynamic routing via node registry |
| plumber-sync | Local filesystem read | S3 read + node-aware routing |
| `runs` table | No node_id | Has `node_id` + `target_node` |
| Crash detection | `tools::ps()` local PID | Node heartbeat staleness |
| Climate cache | Local filesystem | S3 with local cache |

---

## Part 2: Marine SDM Review

### Goal
Add marine species distribution modelling capability: OBIS occurrence data, Bio-Oracle environmental layers, and marine-specific analyses.

### Current State: Terrestrial-Only

| Feature | Terrestrial (current) | Marine (gap) |
|---|---|---|
| Occurrence data | GBIF, CSV upload, DwC-A | OBIS API — no integration |
| Climate covariates | WorldClim, CHELSA v2.1 (land only) | Bio-Oracle (sea surface temp, salinity, pH, currents, nutrients) — no integration |
| Elevation | SRTM, Copernicus DEM | GEBCO/SRTM15+ bathymetry — not integrated |
| Soil | SoilGrids | Seafloor substrate — not integrated |
| Covariate management | Download + cache + verify | No marine covariate system exists |
| Model backends | All 12 (terrestrial) | Same models apply — no change needed |
| Ecology | EOO/AOO, MESS, AOA, niche overlap | Same analyses apply — no change needed |
| Specialised marine models | None | Larval dispersal, MPA connectivity — not built |
| Projection systems | EPSG:4326, EPSG:3857 | Marine-specific CRS for pelagic/coastal |

### What Marine SDM Needs

#### A. OBIS Occurrence Source (new data source)

**Analogy:** OBIS is to marine species what GBIF is to terrestrial species.

**Implementation:** Add OBIS as a new `DataSourceDefinition` in the existing data source registry pattern.

**Files:**
- `R/data/occurrences_obis.R` (new) — wraps `robis::occurrence()` via the `robis` R package
- `plumber/R/plumber.R` — new endpoint `POST /api/v1/data/obis/search`
- `api/src/routes/occurrences.ts` — new Hono route proxy

**OBIS API:** `robis::occurrence(taxonid, geometry, startdate, enddate)` returns data frame with `decimalLongitude`, `decimalLatitude`, `datecollected`, `scientificName`, `depth`, `datasetName`, `obisid`.

**Key differences from GBIF:**
- OBIS requires a bounding box polygon (`geometry` parameter), not a country code
- OBIS has depth filters (epipelagic 0-200m, mesopelagic 200-1000m, etc.)
- OBIS records have `shoredistance` (distance from shore) and `territory` fields
- OBIS `robis` package is lightweight, no Java dependency

**Column mapping:** Verify `robis::occurrence()` output maps to the existing column detection in `R/data/occurrences.R`:
- `decimalLongitude` / `decimalLatitude` → matched (same as GBIF)
- `scientificName` → matched
- `datasetName` → maps to `source` field
- `obisid` → maps to `gbifID` (used for deduplication)
- `depth` → no terrestrial equivalent; needs a new `occurrenceDepth` field
- `shoredistance` → no terrestrial equivalent; potentially useful for coastal vs pelagic filtering
- `datecollected` → maps to `eventDate`

**Auth requirements:**
- `POST /api/v1/data/obis/search`: **Open** (no auth) — OBIS search is read-only, analogous to the existing open endpoints (health, models list, scenarios). The Hono proxy simply forwards to the Plumber endpoint which queries the public OBIS API.
- `POST /api/v1/climate/bi oracle/download`: **Protected** (requires JWT or API key) — downloading and caching Bio-Oracle layers consumes disk space and compute. Must be an authenticated action with rate limiting, like the existing climate download endpoint.

**Edge cases:**
- Marine records often have fewer taxonomic resolutions (many "sp." or genus-level IDs)
- Coordinate precision varies: many historical records round to 0.1 or 1 degree
- Depth uncertainty should be flagged during cleaning (analogous to coordinateUncertaintyInMeters)

#### B. Bio-Oracle Covariate System (new covariate source)

**Analogy:** Bio-Oracle is to marine what WorldClim is to terrestrial.

**Implementation:** Add a new covariate module following the existing `covariates_climate.R` pattern.

**Files:**
- `R/covariates/covariates_marine.R` (new) — Bio-Oracle download + cache + crop
- `plumber/R/climate_download.R` — extend to support marine downloads

**Bio-Oracle v2.2 layers (key ones):**

| Layer | Description | Relevance |
|---|---|---|
| `BO22_tempmean_ss` | Sea surface temperature mean (2000-2019) | Core — defines thermal niche |
| `BO22_salinitymean_ss` | Salinity mean | Core — defines osmotic niche |
| `BO22_ph_mean_ss` | pH mean | Important for calcifying organisms |
| `BO22_chlomean_ss` | Chlorophyll-A mean (productivity proxy) | Food availability indicator |
| `BO22_curvelmean_ss` | Current velocity mean | Dispersal potential |
| `BO22_dissox_mean_ss` | Dissolved oxygen mean | Hypoxia tolerance |
| `BO22_nitratemean_ss` | Nitrate mean | Nutrient availability |
| `BO22_phosphate_mean_ss` | Phosphate mean | Nutrient availability |
| `BO22_silicate_mean_ss` | Silicate mean | Important for diatoms |
| `BO22_icecover_mean_ss` | Sea ice cover | Polar species |

**Future projections:** Bio-Oracle v3 (under development) will include CMIP6 future scenarios analogous to WorldClim future. For now, v2.2 provides present-day only.

**Technical approach:**
```r
# Download Bio-Oracle layer (NetCDF format via rerddap)
download_bi marine_layer <- function(layer_name, output_dir, logger = NULL) {
  url <- sprintf("https://erddap.obis.org/erddap/griddap/%s.nc", layer_name)
  dest <- file.path(output_dir, sprintf("%s.tif", layer_name))

  if (file.exists(dest)) return(dest)

  # Download via httr with retries
  resp <- GET(url, write_disk(temp_file <- tempfile(fileext = ".nc")),
              progress())
  if (resp$status_code != 200) stop("Download failed for ", layer_name)

  # Convert NetCDF to GeoTIFF
  rast(temp_file) |> terra::writeRaster(dest, overwrite = TRUE)
  unlink(temp_file)
  dest
}
```

**Resolution:** 5 arc-min (~9km at equator) — matches WorldClim 10-min coarsest resolution. Can be aggregated to match model resolution.

#### C. Bathymetry (replaces elevation)

**Data source:** GEBCO 2024 (15 arc-sec, ~450m at equator) or SRTM15+ (15 arc-sec).

**Integration:** The existing `covariates_elevation.R` module hardcodes terrestrial DEM sources (SRTM, Copernicus). For marine, replace with:
- GEBCO for general bathymetry
- Derived terrain metrics: slope (BathySlope), aspect, rugosity (BathyRugosity), topographic position index (BathyTPI)

```r
# R/covariates/covariates_bathymetry.R (new)
download_bathymetry <- function(extent, output_dir, source = "gebco") {
  # GEBCO via async download or local file
  # Returns SpatRaster of bathymetry (positive = above sea level, negative = below)
}

compute_terrain_metrics <- function(bathy, vars = c("slope", "rugosity")) {
  # Uses terra::terrain() for slope, aspect
  # Custom rugosity = sd(bathy) in 3x3 window
  # TPI = focal - mean focal
}
```

#### D. Larval Dispersal Model (new ecology module)

**Analogy:** What dispersal simulation (`R/ecology/dispersal.R`) is for terrestrial, larval dispersal is for marine — but driven by ocean currents, not kernel diffusion.

**Implementation:** New module following `R/ecology/dispersal.R` pattern.

**`R/ecology/larval_dispersal.R`:**

```r
simulate_larval_dispersal <- function(
  source_points,       # data.frame(lon, lat) of source populations
  current_field,        # SpatRaster with layers: u, v (current velocity components)
  pelagic_larval_duration = 30,  # Days
  settling_suitability = NULL,    # SpatRaster of habitat suitability (0-1)
  n_particles = 10000,
  diffusion_rate = 100,           # m^2/s
  timestep_hours = 6,
  seed = 42
) -> list(
  connectivity_matrix = matrix(),  # n_sources x n_sources
  settlement_map = SpatRaster,     # Probability of settlement per cell
  pathways = list()                 # Particle trajectories (optional, for viz)
)
```

**Algorithm:** Lagrangian particle tracking with advection (currents) + diffusion (turbulence):
1. Release particles from each source population
2. At each timestep: new_position = current_position + current_velocity * dt + random_walk(diffusion)
3. After PLD days: particles that are in suitable habitat "settle"
4. Aggregate settlement probabilities into connectivity matrix

**Courant stability check:** The `timestep_hours` parameter must satisfy the Courant–Friedrichs–Lewy (CFL) condition: `u * dt / dx < 1` where `u` is the maximum current velocity, `dt` is the timestep in seconds, and `dx` is the grid cell size. For HYCOM (1/12° ≈ 9km at equator) and Gulf Stream currents exceeding 1 m/s, `dt < 9000s ≈ 2.5 hours`. The default `timestep_hours = 6` may be unstable for boundary currents. Add a runtime diagnostic that warns when CFL > 0.8.

**Data source for ocean currents:** HYCOM (global, 1/12 deg, daily) or CMEMS (global, 1/4 deg, daily) via `rerddap` or direct NetCDF downloads.

#### E. MPA Connectivity Analysis (new ecology module)

**`R/ecology/mpa_connectivity.R`:**

```r
mpa_connectivity <- function(
  mpa_polygons,         # sf polygons of MPAs
  dispersal_result,     # Output from simulate_larval_dispersal
  min_settle_prob = 0.01
) -> list(
  connectivity_graph = igraph,   # Weighted directed graph of MPA connections
  centrality = data.frame(),     # Betweenness, degree per MPA
  stepping_stones = list(),      # MPAs that connect clusters
  isolated_mpas = character()    # MPAs with no connections
)
```

### What Already Works for Marine (no changes needed)

| Feature | Why It Works |
|---|---|
| All 24 model backends | GLM, GAM, MaxNet, RF, XGBoost, etc. work on any raster data — marine or terrestrial |
| **`inla_spde` (Bayesian spatial)** | Added in Phase 2a. Models spatial autocorrelation via SPDE — critical for marine species where ocean currents drive spatial structure. Available for marine SDM with no changes. |
| **`brms` + `bart` (Bayesian uncertainty)** | Added in Phase 2b/2d. Full posterior uncertainty maps apply to marine predictions. |
| EOO/AOO | Same IUCN Criterion B — works for marine species |
| Climate matching | Same Mahalanobis distance — works with Bio-Oracle layers |
| Niche overlap | Same ecospat-based approach — works for native vs introduced marine ranges |
| MESS extrapolation | Same multivariate environmental similarity — works with any covariate stack |
| Ensemble modelling | Same multi-model ensemble — applies to marine SDM outputs |
| Async job system | Same BullMQ + callr pattern — marine downloads and model runs use the same infrastructure |
| XAI engine (new) | Same SHAP, permutation importance, counterfactual — model-agnostic |

### Marine SDM Build Plan

| Phase | What | Effort | Dependencies |
|---|---|---|---|
| 1 | OBIS occurrence source | 2 weeks | `robis` R package |
| 2 | Bio-Oracle covariate module | 3 weeks | NetCDF handling (already have via `terra`) |
| 3 | Bathymetry module | 1 week | GEBCO data source |
| 4 | Larval dispersal model | 4 weeks | Ocean current data (HYCOM/CMEMS) |
| 5 | MPA connectivity analysis | 2 weeks | Graph theory (igraph already available) |
| 6 | Plumber endpoints + Hono routes | 2 weeks | Standard pattern |
| 7 | Frontend: marine specific UI | 3 weeks | OBIS search tab, Bio-Oracle download panel |

**Total:** ~17 weeks for a complete marine SDM vertical.

---

## Part 3: Model Backend Review — Gaps & Recommendations

### Current Inventory (24 backends)

| ID | Maturity | Status | Built-in XAI Ready? | Parallel Prediction? |
|---|---|---|---|---|
| `glm` | stable | ✅ Always | Yes — coefficients, AUC, response curves | ✅ |
| `gam` | stable | ✅ Always | Yes — smooth term significance | ✅ |
| `maxnet` | stable | ⚠️ Conditional (maxnet) | Yes — permutation importance | ✅ |
| `rf` | experimental | ⚠️ Conditional (ranger) | Yes — ranger built-in importance | ✅ |
| `xgboost` | experimental | ⚠️ Conditional (xgboost) | Yes — Gain-based importance | ❌ Hardcoded `cores = 1` in prediction |
| `rangebag` | experimental | ✅ Always | **No** — no importance | ✅ (prediction), ❌ (CV hardcoded n_cores=1) |
| `dnn` | experimental | ⚠️ Conditional (cito+torch) | **Not wired** — cito has built-in explain() | ✅ (batch) |
| `biomod2` | experimental | ⚠️ Double-gated | Yes — ecospat variable importance | ❌ Sequential (Java backend) |
| `ensemble_glm_rangebag` | experimental | ✅ Always | **No** | ✅ |
| `multi_ensemble` | experimental | ✅ Always | **No** (has `compute_ensemble_importance()`) | ✅ (standalone), ❌ (biomod2 seq) |
| `esm_glm` | experimental | ⚠️ Conditional (ecospat+biomod2) | Yes — custom ESM importance | ❌ Sequential |
| `esm_maxnet` | experimental | ⚠️ Conditional (ecospat+biomod2+maxnet) | Yes — custom ESM importance | ❌ Sequential |
| `jsdm` | **skeleton** | ❌ Not registered | **No** | ❌ |
| **Phase 1 (low-effort):** | | | | |
| `brt` | experimental | ⚠️ Conditional (gbm) | Yes — gbm summary importance | ✅ (CV), ❌ (prediction single-core) |
| `cta` | experimental | ⚠️ Conditional (rpart) | Yes — rpart variable importance | ✅ |
| `mars` | experimental | ⚠️ Conditional (earth) | Yes — earth evimp() | ✅ |
| `fda` | experimental | ⚠️ Conditional (mda+earth) | **No** — permutation only | ✅ |
| `ann` | experimental | ⚠️ Conditional (nnet) | **No** — permutation only | ✅ |
| `bioclim` | experimental | ✅ Always | **No** — envelope model | ✅ (terra::predict) |
| **Phase 2 (medium-effort):** | | | | |
| `inla_spde` | experimental | ⚠️ Conditional (INLA) | **No** — spatial field | ❌ Posterior sampling is sequential |
| `bart` | experimental | ⚠️ Conditional (dbarts) | Yes — built-in `varcount` | ❌ MCMC is sequential |
| `occupancy` | experimental | ⚠️ Conditional (unmarked) | **No** — coefficient-based | ✅ |
| `brms` | experimental | ⚠️ Conditional (brms+cmdstanr) | **No** — coefficient posterior only | ❌ MCMC + `posterior_epred` is sequential |
| **Phase 3 (Python executor):** | | | | |
| `python_elapid` | experimental | ⚠️ Conditional (arrow+reticulate) | Yes — elapid coefficient importance | ❌ File-based bridge adds ~2-5s overhead |
| `python_sklearn_rf` | experimental | ⚠️ Conditional (arrow+reticulate) | Yes — sklearn feature_importances_ | ❌ File-based bridge adds ~2-5s overhead |

### Gaps Found

#### Gap 1: Phase 1 models (BRT, CTA, MARS, FDA, ANN) — no dedicated UI controls

All six Phase 1 models follow the standard `model_rf.R` pattern and correctly use the shared `prepare_sdm_data()` + `cross_validate_model()` pipeline. However, they have no dedicated parameter inputs in the UI sidebar — users cannot tune `n_trees`, `interaction_depth`, `size`, `decay`, etc. from the Shiny app. They use hardcoded defaults. This is acceptable for an initial release but should be addressed for production use.

**Fix:** Add `conditionalPanel` blocks in `R/ui/ui_sidebar_controls.R` for each model, gated on `input.model_id == "brt"` etc.

#### Gap 2: Bayesian backends (INLA, BART, brms) — prediction speed

All four Bayesian backends from Phase 2 (`inla_spde`, `bart`, `occupancy`, `brms`) share a common limitation: posterior sampling or MCMC-based prediction is 10-100x slower than point-estimate prediction from GLM/RF/XGBoost. For large rasters (>1M cells), this can take minutes to hours.

| Backend | Prediction mechanism | ~Time per 100k cells |
|---------|---------------------|---------------------|
| GLM | `terra::predict()` (O(1) per cell) | <1s |
| INLA | `inla.posterior.sample()` + mesh project | 30-120s |
| BART | `predict(dbarts, ...)` all posterior trees | 10-60s |
| brms | `posterior_epred()` all MCMC draws | 60-300s |

**Mitigation:** Document this in the model notes. For large-scale prediction, recommend using tile-based raster processing (already supported via `terra::app()` with tile size control).

#### Gap 3: Python executor — file I/O overhead

The file-based bridge (Phase 3) writes training data to feather, spawns a Python subprocess, reads predictions back. This adds 2-5s of I/O overhead per call, which is negligible for model fitting (minutes) but significant for raster prediction (every block triggers a subprocess).

**Mitigation:** The current implementation processes all raster cells as a single batch (not tile-by-tile) to minimize subprocess spawning. For very large rasters (>5M cells), batch splitting with parallel Python processes should be added.

#### Gap 4: BIOCLIM — no permutation importance

`bioclim` is registered with `supports_importance = FALSE`. This is correct — envelope models don't have a mechanism for per-variable importance. The permutation importance engine in `R/models/importance.R` will skip BIOCLIM automatically. Documented behavior, not a bug.

#### Gap 5: DNN has built-in XAI but it's never used

`cito::explain()` provides SHAP-like feature attribution, `cito::PDP()` for partial dependence, and `cito::variable_importance()` — all built into the `cito` package. The `model_dnn.R` module never calls any of these. Wiring them would provide XAI for the neural network backend with ~50 lines of code.

**Fix:** In `model_dnn.R`, after fitting, call:
```r
fit$shap <- cito::explain(fit$model, data = as.data.frame(env_train_scaled))
fit$pdp <- cito::PDP(fit$model, data = as.data.frame(env_train_scaled))
```

#### Gap 2: JSDM is a skeleton — not useful in current state

The JSDM backend exists at `R/models/model_jsdm.R` but:
- Not registered in the model registry
- Predict function returns `NULL`
- No CV, no importance, no metrics
- No UI presence
- No tests

**Decision needed:** Either invest in completing it (multi-species JSDM is genuinely novel) or remove the dead code.

#### Gap 3: Three bespoke data preparation patterns

| Backend | Data Preparation | Problem |
|---|---|---|
| GLM, GAM, MaxNet, RF, XGBoost, Rangebag, Ensemble | Shared `prepare_sdm_data()` + `sample_background_points()` | Consistent |
| DNN | Own `prepare_dnn_data()` with `terra::spatSample()` | Inconsistent — different sampling, no bias correction |
| ESM | Own sampling with `bias_method = "uniform"` hardcoded | No target_group or thickened support |
| biomod2 | Own `BIOMOD_FormattedData` construction | No access to shared cleaning pipeline |

The three outliers (DNN, ESM, biomod2) can't participate consistently in the shared data pipeline. This means they can't use target_group bias correction or thickened background — a real limitation for presence-only modelling.

#### Gap 4: Parallel execution inconsistency

| Backend | CV Parallel | Raster Prediction Parallel |
|---|---|---|
| GLM | ✅ | ✅ (via predict_suitability helper) |
| GAM | ✅ | ✅ |
| MaxNet | ✅ | ✅ |
| RF | ✅ | ✅ |
| XGBoost | ✅ | ❌ Hardcoded `cores = 1` in prediction |
| Rangebag | ❌ Hardcoded `n_cores = 1` | ✅ |
| DNN | ❌ No CV (holdout only) | ✅ (batch processing) |
| biomod2 | ❌ Java backend | ❌ Sequential |
| Ensemble | ✅ (components) | ✅ |
| Multi-ensemble | ✅ (components) | ✅ (standalone parallel, biomod2 seq) |
| ESM | N/A (split-sample) | ❌ Sequential |

**XGBoost raster prediction** has a `cores = 1` hardcode in `predict_xgboost_suitability` that should be `normalize_core_count(n_cores)`.

#### Gap 5: No backend supports SHAP natively (but the new XAI engine is model-agnostic)

The `R/xai/xai_shap.R` module (Phase 1 of the implementation plan) uses `fastshap::explain()` which is model-agnostic. It works with any backend that has a `predict()` method. Testing is needed for each backend:
- GLM, GAM, MaxNet, RF, XGBoost: Standard `predict()` — should work
- Rangebag: Custom prediction function — needs testing
- DNN: cito has its own `predict()` — should work
- biomod2: Java-based prediction — may need special handling
- ESM: ecospat-based prediction — may need special handling
- Multi-ensemble: Composite prediction — likely needs work

### Recommendations

| Backend | Recommendation | Effort | Priority |
|---|---|---|---|
| **DNN** | Wire `cito::explain()` for built-in XAI. Add `fit_component_fun` for ensemble participation. | 1 week | High |
| **JSDM** | **Remove** — dead code. `brms` and `inla_spde` now provide Bayesian modeling; HMSC-based JSDM is well beyond the current scope of a single-species SDM tool. The 116-line skeleton file adds maintenance debt with no value. | 1 hour | High |
| **XGBoost** | Fix `cores = 1` hardcode in raster prediction (line 159 of `model_xgboost.R` → `normalize_core_count(n_cores)`) | 1 day | High |
| **Phase 1 UI controls** | Add `conditionalPanel` blocks for `brt`, `cta`, `mars`, `fda`, `ann` parameter tuning in `R/ui/ui_sidebar_controls.R` | 1 week | Medium |
| **XGBoost** | Fix `cores = 1` hardcode in raster prediction. | 1 day | High |
| **Rangebag** | Remove `n_cores = 1` hardcode in CV (or document why it's single-core). | 1 day | Medium |
| **ESM + biomod2 + DNN** | Migrate to shared `prepare_sdm_data()` / `sample_background_points()` pipeline. | 2 weeks | Medium |
| **All backends** | Test XAI engine (SHAP + importance + counterfactual) against each backend during Phase 1 validation. | 1 week (testing) | High (needed for Phase 2) |

---

## Part 4: Synthesis — What This Means for the Implementation Plan

### Impact on Existing Plan (docs/OPENSDM-MCP-IMPLEMENTATION-PLAN.md)

| Topic | Impact | Timeline Change |
|---|---|---|
| **XAI engine (Phase 1)** | Must test against all 12 backends, not just GLM. DNN has cito::explain() already — low priority to duplicate with SHAP. | +1 week for validation testing |
| **Federated SDM** | Not in scope of current plan. Post-MVP. Recommend revisiting after Phase 3b. | Post-28-week |
| **Marine SDM** | Not in scope of current plan. Post-MVP. ~17 weeks as a separate vertical initiative. | Post-28-week |
| **DNN XAI wiring** | Quick win: wire cito::explain() in model_dnn.R. Can be done any time. | 1 week, parallel |
| **XGBoost prediction fix** | One-line fix. Can be done immediately. | 1 day |
| **JSDM decision** | Need to decide: complete or remove. Skeleton code creates maintenance debt. | 1 hour decision + 4+ weeks if completing |

### Recommended Order

```
Week 0:
  Fix XGBoost parallel prediction (1 day)
  Wire cito::explain() in DNN (1 week)
  Remove JSDM skeleton (1 hour)
  Add Phase 1 model UI controls (1 week)

Week 1-4:
  Test all 24 backends against XAI engine (SHAP + permutation importance)
  Fix Python executor tile-based prediction for large rasters
  Document Bayesian backend prediction speed limitations

Week 4+:
  Follow existing implementation plan (OPENSDM-MCP-IMPLEMENTATION-PLAN.md)
  Add marine SDM vertical (OBIS + Bio-Oracle + bathymetry) if demand materialises
  Evaluate federated SDM based on capacity needs
```

---

This document is saved at `docs/FEDERATED-MARINE-SDM-REVIEW.md`.
