export interface DataSourceDefinition {
  id: string;
  label: string;
  icon: string;
  description: string;
  tabComponent: string;
}

export const BUILTIN_DATA_SOURCES: DataSourceDefinition[] = [
  {
    id: "upload",
    label: "Upload",
    icon: "Upload",
    description: "Upload a CSV/TSV file with longitude/latitude columns",
    tabComponent: "file-upload",
  },
  {
    id: "gbif",
    label: "GBIF",
    icon: "Globe",
    description: "Search GBIF by species name",
    tabComponent: "gbif-search",
  },
  {
    id: "dwca",
    label: "DwC-A",
    icon: "FileArchive",
    description: "Parse a Darwin Core Archive (.zip)",
    tabComponent: "dwca-upload",
  },
  {
    id: "clean",
    label: "Clean",
    icon: "Wand2",
    description: "Review and clean occurrence records",
    tabComponent: "cleaning-table",
  },
  {
    id: "map",
    label: "Map",
    icon: "Map",
    description: "Map occurrence records",
    tabComponent: "occurrence-map",
  },
  {
    id: "climate",
    label: "Climate",
    icon: "Cloud",
    description: "Download climate layers",
    tabComponent: "climate-download",
  },
];

export function getDataSources(): DataSourceDefinition[] {
  return BUILTIN_DATA_SOURCES;
}

export function getDataSource(id: string): DataSourceDefinition | undefined {
  return BUILTIN_DATA_SOURCES.find((ds) => ds.id === id);
}
