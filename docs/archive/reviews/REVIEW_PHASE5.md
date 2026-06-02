# Phase 5 — Frontend, Data Flow, and Rendering

## Frontend Architecture Summary

**Framework:** Next.js 15 App Router with route groups `(auth)` and `(dashboard)`.

**State management:** Zustand with 3 stores:
- `auth-store.ts` — persisted to localStorage via `zustand/middleware/persist`, token explicitly excluded from persistence (stored separately in localStorage/sessionStorage)
- `sdm-store.ts` — workflow state (species, occurrence file path, cleaned data, flagged indices). No persistence.
- `settings-store.ts` — user preferences fetched from API (model defaults, theme, page size)

**API client:** `services/api.ts` — generic fetch wrappers (`apiGet<T>`, `apiPost<T>`, `apiUpload<T>`). Token injected via `Authorization: Bearer`. 401 redirects to `/login`. FormData detected automatically.

## API Contract Synchronisation

**Verdict: Hand-maintained with drift risk.**

Three type sources exist:
1. `packages/shared/src/types.ts` — shared `ModelBackend`, `Run`, `JobStatus`, `RunMetrics`
2. `frontend/src/services/types.ts` — frontend-specific `RunSummary`, `RunDetail`, `VifData`, `ImportanceData`, `CurvePoint`, etc.
3. `api/src/services/plumber.ts` — `ModelRunResponse`, `ModelStatusResponse`, `AsyncJobStatusResponse`

The frontend types in `services/types.ts` partially overlap with `@sdm/shared` but are independently maintained. For example:
- `@sdm/shared` `Run` uses camelCase (`modelId`, `startedAt`)
- Frontend `RunSummary` uses snake_case (`model_id`, `started_at`)
- Plumber client `ModelStatusResponse` has `progress` (number)
- Frontend `RunDetail` has no `progress` field

This mismatch requires conversion in every route handler. The type errors found in Phase 0 (`queue.ts:264` — `ModelStatusResponse` not assignable to `Record<string, unknown>`) confirm active drift.

## Map Rendering

**Two approaches exist:**

1. **TiTiler COG tiles** — The Plumber Docker Compose includes a TiTiler service (referenced in AGENTS.md). The `useRasterData` hook in `frontend/src/hooks/useRasterData.ts` loads `geotiff` directly in the browser via `fromUrl()`.
2. **Direct GeoTIFF** — `useRasterData.ts:37` caps raster size at 5 million pixels for hover data, falls back to tile-based display for larger rasters.

The Plumber model run produces EPSG:3857 COGs (`run_model_background` in plumber.R:704-721):
```r
r_3857 <- terra::project(result$suitability, "EPSG:3857", method = "bilinear")
terra::writeRaster(r_3857, tif_3857_path, filetype = "COG", ...)
```

**Verdict:** Mixed approach. COGs via TiTiler for map display, direct browser GeoTIFF for hover inspection. This is pragmatic but the fallback to browser-side GeoTIFF parsing for large rasters could cause performance issues.

## Chart Coverage

| Chart | Component | Implemented? |
|-------|-----------|-------------|
| ROC curve | `roc-chart.tsx` | ✓ |
| Calibration | `calibration-chart.tsx` | ✓ |
| Variable importance | `importance-chart.tsx` | ✓ |
| Response curves | `response-curves-chart.tsx` | ✓ |
| CV fold performance | `cv-folds-chart.tsx` | ✓ |
| Density (suitability histogram) | `density-chart.tsx` | ✓ |
| Threshold explorer | `threshold-chart.tsx` | ✓ |
| CBI (Continuous Boyce Index) | `cbi-chart.tsx` | ✓ |
| VIF table | `vif-table.tsx` | ✓ |
| MESS summary | `mess-summary.tsx` | ✓ |

All 10 SDM-essential charts listed in the plan are implemented. Each has a corresponding Recharts component.

**Missing charts (not essential but notable):**
- Range-change map (current vs future suitability difference) — handled by Plumber PNG generation instead
- Species richness map — available via `R/ecology/species_richness.R` but no frontend component seen

## WebSocket

**File:** `frontend/src/hooks/useJobProgress.ts`

- Connects to `/ws?token=<jwt>`
- Initial REST fetch fallback (`/api/v1/jobs/${jobId}`)
- Reconnection: 3s backoff, max 5 retries
- Back-pressure: not explicitly handled (messages processed as received, no queue)
- Auth: JWT verified on WS connection (`api/src/services/websocket.ts:21-31`)

## Security Observations

- Token stored in both `localStorage` (for "remember me") and `sessionStorage` (for session-only). Cookie mirror for server-side rendering.
- Token explicitly excluded from Zustand persistence (auth-store.ts:52 — `partialize` omits `token`)
- 401 redirect to `/login` uses a single redirect guard (`_redirecting` flag) — could race in concurrent requests

## Accessibility

**Not systematically tested** (requires browser-based axe-core). From code review:
- Leaflet/map components: no ARIA labels observed
- Chart components: Recharts uses SVG with basic accessibility
- Dark theme: `body.sdm-dark` + CSS variables
- Table semantics: `data/cleaning-table.tsx`, `diagnostics/vif-table.tsx`
