import { useSDMStore } from "@/stores/sdm-store";
import type { WorkspaceFile } from "./types";

export function selectWorkspaceFileForModel(card: WorkspaceFile): void {
  const store = useSDMStore.getState();
  store.setOccurrenceFilePath(card.filePath);
  store.setRawAssetId(card.rawAssetId || null);
  store.setCleanedAssetId(card.cleanedAssetId || null);
  store.setSpecies(card.selectedSpecies[0] || "Untitled species");
  store.setDetectedSpecies(card.selectedSpecies);
  store.setRecordCount(card.fileRows);
  store.setUploadResult({
    file_id: card.fileId,
    rawAssetId: card.rawAssetId,
    raw_asset_id: card.rawAssetId,
    n_rows: card.fileRows,
    cleaned: Boolean(card.cleanedAssetId),
    cleaned_file_id: card.cleanedFileId,
    cleanedAssetId: card.cleanedAssetId,
    cleaned_asset_id: card.cleanedAssetId,
    cleaned_valid_records: card.cleanValidRecords,
  });

  store.setCleanedOccurrence(card.cleanedAssetId
    ? {
        filePath: card.cleanedFileId || "",
        cleanedAssetId: card.cleanedAssetId,
        df: [],
        sourceCounts: {},
        nAbsentExcluded: 0,
        originalRows: card.cleanOriginalRows ?? card.fileRows,
        validRecords: card.cleanValidRecords ?? null,
      }
    : null);
}
