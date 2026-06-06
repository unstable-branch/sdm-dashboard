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
  cleanedFileId?: string;
  cleanValidRecords?: number;
  cleanOriginalRows?: number;
  cleanSourceCounts?: Record<string, number>;
  cleanCcLog?: string[];
  cleanRecords?: OccurrencePoint[];
  cleanLoading: boolean;
  cleanError: string | null;
}
