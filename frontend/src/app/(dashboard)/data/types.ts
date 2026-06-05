export interface OccurrencePoint {
  longitude: number;
  latitude: number;
  source?: string;
  flagged?: boolean;
  [key: string]: unknown;
}

export interface WorkspaceFile {
  id: string;
  fileId: string;
  fileName: string;
  filePath: string;
  fileFormat?: string;
  fileRows: number;
  fileCleaned: boolean;
  fileCleanedFileId?: string;
  selectedSpecies: string[];
  modelType: "single" | "community";
  modelId: string;
  cleanBeforeRun: boolean;
  cleanedFileId?: string;
  cleanValidRecords?: number;
  cleanLoading: boolean;
  cleanError: string | null;
}
