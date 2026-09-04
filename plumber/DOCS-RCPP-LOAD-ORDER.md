# Plumber runtime: C++-backed package audit

Last updated: 2026-09 (post-d3b96e49 revert, Plumber 1.3.3).

## Why this document exists

A regression introduced by d3b96e49 caused `/health` to return an empty
`{}` body. Investigation pointed at a Plumber 1.3.3 C++ serializer bug
in `invokeCppCallback` triggered by the `@filter Auth` decorator path.
This audit documents which runtime packages touch compiled C++ code at
Plumber startup, so future regressions can be attributed quickly.

## Runtime packages with C++ dependencies

| Package        | C++ backend            | Loaded at startup? | Triggered by /health? |
|----------------|------------------------|--------------------|------------------------|
| terra          | Rcpp                   | no (lazy)          | no                     |
| sf             | Rcpp                   | no (lazy)          | no                     |
| arrow          | C++ (Apache Arrow)     | no (lazy)          | no                     |
| reticulate     | C++ (pybind11)        | no (lazy)          | no                     |
| xgboost        | C++                   | no (lazy)          | no                     |
| ranger         | C++                   | no (lazy)          | no                     |
| gbm            | C++                   | no (lazy)          | no                     |
| maxnet         | C++                   | no (lazy)          | no                     |
| earth          | C++                   | no (lazy)          | no                     |
| torch          | C++ (libtorch)        | no (lazy)          | no                     |
| cito           | C++ (torch bridge)    | no (lazy)          | no                     |
| mgcv           | C (mixed R/C)          | no (lazy)          | no                     |
| rpart          | C                     | no (lazy)          | no                     |
| data.table     | C + inline C++        | no (lazy)          | no                     |
| RPostgres      | C (libpq)             | no (lazy)          | no                     |
| digest         | C                     | no (lazy)          | no                     |
| curl           | C (libcurl)           | no (lazy)          | no                     |
| openssl        | C (OpenSSL)           | no (lazy)          | no                     |
| jsonlite       | C (internal)           | yes (base R)       | no                     |
| plumber        | C++ (httpuv)          | yes (server core)  | yes (transport)        |

All other packages (glmnet, caret, nnet, mda, PresenceAbsence, pROC,
ecospat, marginaleffects, plotrix, ggplot2, CAST, blockCV,
CoordinateCleaner, rgbif, finch, future, future.apply, DBI, Rook, pool,
uuid, targets, tarchetypes, geotargets, etc.) are pure R and impose no
C++ risk.

## Plumber startup load order

1. `bootstrap.R` → `sdm_set_project_root(app_dir)`
2. `engine_load.R` (or `load.R`) → sources ~80 R modules, all pure R code
3. `plumber/R/run_server.R` →
   - `options(error = ...)` global handler
   - Source `auth.R`, `redis.R`, `plumber_helpers.R`, `error_codes.R`
   - Read `.env` if present
   - `library(pool)` — pure R connection pool
   - Source `db_pool.R` → `sdm_connect_db_pool()` — Postgres connection
   - `plumber::pr(plumber.R)` — registers routes from OpenAPI annotations
   - `pr$setSerializer(serializer_json(auto_unbox=TRUE, na="null"))`
   - Toggle OpenAPI docs per `PLUMBER_DOCS_ENABLED`
   - Load `internal_key`, `data_encryption_key` env
   - Production-secret gate (`quit(1)` if weak/missing)
   - **preroute hook** (post-d3b96e49-revert) — auth gate
   - `source(plumber.R)` — route handlers register with `pr`
4. `pr$run(host="0.0.0.0", port=8000)` — httpuv server starts

## /health handler dependencies

`handle_health(res, app_dir)` reads:

| Dependency          | Type      | C++ involved? |
|--------------------|-----------|--------------|
| `R.version.string` | R global  | no           |
| `Sys.time()`       | R base    | no           |
| `sdm_count_active_runs()` | R function (reads `.GlobalEnv$sdm_process_registry`) | no |
| `SDM_MAX_CONCURRENT_RUNS` | Integer (env var) | no  |
| `sdm_mem_info()`   | R function (uses `terra::rast()` with `tryCatch`) | no (lazy) |

The `tryCatch` around `terra::rast()` means terra is not loaded unless
the memory info path is taken. Even then, terra is loaded only if
`requireNamespace("terra", quietly=TRUE)` succeeds, which it won't at
startup because the plumber runtime uses `engine_load.R` (not `load.R`).

## Conclusion

- The `/health` handler does not touch any eagerly-loaded C++ computation.
- All C++ packages are lazy-loaded via `requireNamespace()` or
  `library()` inside route handlers.
- The d3b96e49 regression was **not caused by C++ package interaction**;
  it was the `@filter Auth` decorator itself triggering a Plumber 1.3.3
  serializer bug (see [rstudio/plumber#1022](https://github.com/rstudio/plumber/issues/1022)).
- The workaround (restoring the preroute hook with `return(FALSE)`) works
  because the preroute hook does not pass through the same C++ serialization
  code path that `@filter` uses in Plumber 1.3.3.

## Update cadence

Update this doc when:

- A new package is added to `plumber/install-runtime-packages.R`
- Plumber is upgraded (re-check C++ serialization interaction)
- A `/health`-adjacent endpoint changes its dependencies
- New C++-backed packages are loaded eagerly at startup

## References

- Upstream bug report: [rstudio/plumber#1022](https://github.com/rstudio/plumber/issues/1022)
- Revert commit: `abcd2432` (preroute hook pattern that worked)
- Regression commit: `d3b96e49` (`@filter Auth` pattern that broke)
