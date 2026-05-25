# Workflow Object Schemas

## Purpose
This is the Phase 2 contract foundation for workflow objects that are useful to
agents, notebooks, and later MCP adapters. The helpers are pure TypeScript/Zod
schemas under `api/src/services/workflow-object-schemas.ts`; they do not call
Plumber, touch the database, or wire new routes.

## Study Area
Schema version: `study_area.v1`

Study areas use the existing dashboard extent convention:

```json
[xmin, xmax, ymin, ymax]
```

Only WGS84 longitude/latitude extents are accepted (`EPSG:4326`). Supported
inputs are:

- preset: `{ "type": "preset", "preset_id": "aus_east" }`
- custom: `{ "type": "custom", "label": "Survey bbox", "crs": "EPSG:4326", "extent": [120, 130, -35, -20] }`

Normalized outputs include `schema_version`, `type`, `id`, `label`, `crs`, and
`extent`. Presets are resolved from the existing shared `EXTENT_PRESETS`.

## Environment Scenario Summary
Schema version: `environment_scenario_summary.v1`

Scenario summaries are intentionally small:

- `id`, `label`
- `source`: `worldclim`, `chelsa`, `custom`, or `unknown`
- `status`: `available`, `pending`, `missing`, or `unknown`
- optional `gcm`, `ssp`, `period`
- bounded `variables`
- optional WGS84 `extent`, `crs`, and `resolution_arcmin`

## Environment Set Summary
Schema version: `environment_set_summary.v1`

Environment set summaries describe a baseline/future collection without
returning raster metadata or filesystem-heavy payloads. Returned previews are
bounded:

- scenarios: max 20
- variables: max 64
- warnings: max 20
- labels/warnings: max 256 characters
- variable names: max 64 characters

`scenario_count` and `variable_count` preserve the source totals when known,
while `scenarios` and `variables` remain capped for agent-safe JSON responses.

## Current Boundary
These schemas are contract vocabulary only. Route integration should stay
endpoint-specific and additive after the object model settles; do not mirror
every Plumber climate/scenario payload directly into MCP-facing objects.
