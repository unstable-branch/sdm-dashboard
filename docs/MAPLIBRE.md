# MapLibre Map Component

The `MaplibreMap` component (`frontend/src/components/results/maplibre-map.tsx`) renders SDM suitability results on an interactive MapLibre GL map with multiple overlay layers.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `n` / `N` | Reset compass to north |
| `f` / `F` | Fit map to extent bounds |
| `b` / `B` | Toggle light/dark basemap |
| `+` / `=` | Zoom in |
| `-` / `_` | Shift+minus — Zoom out |
| `p` / `P` | Toggle map pitch (flat 0° vs tilted 60°) |
| Right-click | Copy coordinates to clipboard |

Shortcuts are suppressed when focus is inside an `<input>`, `<textarea>`, or `contentEditable` element.

## Layers

### Suitability Raster
- **Source**: `/api/v1/results/tiles/{runId}/{z}/{x}/{y}?band=...`
- **Type**: Raster tile overlay at 256px tile size
- **Rendering**: `raster-opacity: 0.9999`, `raster-fade-duration: 0`, `raster-resampling: nearest`
- **Attribution**: `© SDM Platform`
- **Visibility**: Controlled by `layerVisibility.suitability`

### Extent of Occurrence (EOO) Polygon
- **Source**: `eooGeoJSON` prop — `FeatureCollection<Polygon>`
- **Pre-processing**: Geodesic-densified (10km max segment) via `densifyGeoJSONFeature`; clipped to extent polygon via Turf.js `intersect`
- **Fill**: Purple (indigo-400 / indigo-500 by theme), ~8% opacity
- **Outline**: Dashed (4, 3), 2px, 80% opacity
- **Hover**: Fill opacity increases to 30%, outline width increases to 3px (feature-state)
- **Visibility**: `layerVisibility.eoo`

### Area of Occupancy (AOO) Grid
- **Source**: `aooGeoJSON` prop — `FeatureCollection<Point>`
- **Clustering**: MapLibre built-in clustering (`cluster: true`, `clusterMaxZoom: 14`, `clusterRadius: 50`)
- **Cluster circles**: Sized by `point_count` (step: 12px / 18px / 24px radius)
- **Cluster count**: Symbol layer with `point_count_abbreviated`
- **Unclustered points**: Fill layer with `fill-color` (amber) and `fill-outline-color`
- **Hover**: Fill opacity increases to 60% via `feature-state`
- **Visibility**: `layerVisibility.aoo`

### Boundary Polygon
- **Source**: `boundaryGeoJSON` prop — `FeatureCollection<Polygon>`
- **Pre-processing**: Geodesic-densified (10km max segment)
- **Fill**: Cyan, ~8% opacity
- **Outline**: 2px solid cyan
- **Hover**: Fill opacity 25%, outline width 3px (feature-state)
- **Visibility**: `layerVisibility.boundary`

### Projection Extent
- **Source**: `coordinates` prop — 4 corner points forming a rectangle
- **Type**: Line layer with dashed style (6, 3 dash array)
- **Outline**: Blue, 1.5px, 50% opacity
- **Visibility**: `layerVisibility.extent`

## Color Legend

### Dark Theme
| Layer | Fill | Outline |
|-------|------|---------|
| EOO | `#818cf8` (indigo-400), 8% | `#818cf8`, dashed |
| AOO | `#fbbf24` (amber-400), 25% | `#fbbf24` |
| Boundary | `#06b6d4` (cyan-500), 8% | `#06b6d4` |
| Extent | — | `#60a5fa` (blue-400), dashed |

### Light Theme
| Layer | Fill | Outline |
|-------|------|---------|
| EOO | `#6366f1` (indigo-500), 8% | `#6366f1`, dashed |
| AOO | `#f59e0b` (amber-500), 25% | `#d97706` (amber-600) |
| Boundary | `#06b6d4` (cyan-500), 8% | `#06b6d4` |
| Extent | — | `#2563eb` (blue-600), dashed |

## UI Controls

### Toolbar (draggable, top-left)
- Layer visibility toggles (suitability, EOO, AOO, boundary, extent)
- Reset compass north
- Fit to extent
- Basemap toggle (sun/moon icon)

### Top-right buttons
- **All** — Show/hide all overlay layers simultaneously
- **3D/2D** — Toggle map pitch between 0° and 60°

### Bottom display
- **Cursor coordinates** — Live lat/lng display (frozen when mouse leaves map)
- **Zoom warning** — Shown when current zoom exceeds `tileZoomMax`

### Overlays
- **Tile error banner** — Appears after > 5 tile errors with Retry/Dismiss
- **Auth warning** — Appears on 401 tile response with dismiss
- **Context menu** — Right-click to copy coordinates
- **WebGL context lost** — Full-width banner with reload button

## URL State Persistence

The map does **not** currently persist view state to the URL. The `initialViewState` prop accepts `longitude`, `latitude`, `zoom`, `pitch`, and `bearing` from the parent component. Future work may add URL hash sync for shareable deep links.

## Performance Notes

- AOO/EOO/Boundary GeoJSONs are geodesic-densified in `useMemo` to improve rendering quality at high latitudes
- EOO is clipped to the extent polygon via Turf.js `intersect` inside `useMemo`
- Mouse move events (`handleMapMouseMove`) call `queryRenderedFeatures` on every event — future work should throttle this to reduce per-frame overhead
- The suitability raster uses `raster-resampling: nearest` for crisp binary suitability values

## Tile Error Handling

| Error | Response |
|-------|----------|
| HTTP 401 on tile | Sets auth warning banner; user must re-authenticate |
| HTTP 4xx/5xx on tile | Increments tile error counter |
| > 5 tile errors | Shows warning banner with Retry button |
| WebGL context lost | Shows full reload banner |

## Dependencies

- `react-map-gl` / `maplibre-gl` — Map rendering
- `@turf/intersect`, `@turf/bbox-polygon` — EOO clipping
- `geographiclib` — Geodesic line densification
- `react-map-gl/maplibre` — React bindings for MapLibre GL
