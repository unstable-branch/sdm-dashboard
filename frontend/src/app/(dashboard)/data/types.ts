export interface OccurrencePoint {
  longitude: number;
  latitude: number;
  source?: string;
  flagged?: boolean;
  [key: string]: unknown;
}

export interface WorkspaceFile {
  id: string;
  rawAssetId?: string;
  fileId: string;
  fileName: string;
  filePath: string;
  fileFormat?: string;
  fileRows: number;
  fileCleaned: boolean;
  fileCleanedFileId?: string;
  selectedSpecies: string[];
  cleanedFileId?: string;
  cleanedAssetId?: string;
  cleanValidRecords?: number | null;
  cleanOriginalRows?: number;
  cleanSourceCounts?: Record<string, number>;
  cleanCcLog?: string[];
  cleanRecords?: OccurrencePoint[];
  cleanLoading: boolean;
  cleanError: string | null;
}

export function addWorkspaceFile(
  previous: WorkspaceFile[],
  file: import("@/services/types").UploadFile,
  selectedSpecies: string[],
): WorkspaceFile[] {
  const rawAssetId = file.rawAssetId || file.raw_asset_id;
  if (!rawAssetId || previous.some((item) => item.rawAssetId === rawAssetId || item.fileId === file.file_id)) {
    return previous;
  }
  return [...previous, {
    id: rawAssetId,
    rawAssetId,
    fileId: file.file_id,
    fileName: file.file_name,
    filePath: file.file_id,
    fileFormat: file.format,
    fileRows: file.n_rows,
    fileCleaned: file.cleaned,
    fileCleanedFileId: file.cleaned_file_id,
    cleanedFileId: file.cleaned_file_id,
    cleanedAssetId: file.cleanedAssetId || file.cleaned_asset_id,
    cleanValidRecords: file.cleaned_valid_records,
    selectedSpecies,
    cleanLoading: false,
    cleanError: null,
  }];
}
