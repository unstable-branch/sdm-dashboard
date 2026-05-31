// Data source registry — wraps @sdm/shared definitions with frontend state.
// To add a new data source:
// 1. Add to BUILTIN_DATA_SOURCES in packages/shared/src/data-sources.ts
// 2. Create a component in frontend/src/components/data/
// 3. Import and register it below

import type { DataSourceDefinition } from "@sdm/shared";
import { getDataSources as getSharedSources } from "@sdm/shared";

// Map component names to dynamic imports
const componentImports: Record<string, () => Promise<any>> = {
  "file-upload": () => import("@/components/data/file-upload").then((m) => ({ default: m.FileUpload })),
  "gbif-search": () => import("@/components/data/gbif-search").then((m) => ({ default: m.GbifSearch })),
  "dwca-upload": () => import("@/components/data/file-upload").then((m) => ({ default: m.FileUpload })),
  "cleaning-table": () => import("@/components/data/cleaning-table").then((m) => ({ default: m.CleaningTable })),
  "occurrence-map": () => import("@/components/data/occurrence-map").then((m) => ({ default: m.OccurrenceMap })),
  "climate-download": () => import("@/components/climate/scenario-list").then((m) => ({ default: m.ScenarioList })),
};

export function getDataSources(): DataSourceDefinition[] {
  return getSharedSources();
}

export function getDataSourceComponent(id: string): (() => Promise<any>) | undefined {
  return componentImports[id];
}

export function isRegistered(id: string): boolean {
  return id in componentImports;
}
