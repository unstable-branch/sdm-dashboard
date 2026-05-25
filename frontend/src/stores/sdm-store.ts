import { create } from "zustand";

interface SDMState {
  species: string;
  setSpecies: (species: string) => void;

  occurrenceFilePath: string | null;
  setOccurrenceFilePath: (path: string | null) => void;

  recordCount: number;
  setRecordCount: (count: number) => void;

  cleanedOccurrence: {
    filePath: string;
    df: Record<string, unknown>[];
    sourceCounts: Record<string, number>;
    nAbsentExcluded: number;
    originalRows: number;
    validRecords: number;
  } | null;
  setCleanedOccurrence: (data: SDMState["cleanedOccurrence"]) => void;

  occurrenceData: Record<string, unknown>[] | null;
  setOccurrenceData: (data: Record<string, unknown>[] | null) => void;

  uploadResult: Record<string, unknown> | null;
  setUploadResult: (result: Record<string, unknown> | null) => void;

  cleanResult: Record<string, unknown> | null;
  setCleanResult: (result: Record<string, unknown> | null) => void;

  flaggedIndices: number[];
  setFlaggedIndices: (indices: number[]) => void;

  reset: () => void;
}

export const useSDMStore = create<SDMState>()((set) => ({
  species: "Untitled species",
  setSpecies: (species) => set({ species }),

  occurrenceFilePath: null,
  setOccurrenceFilePath: (path) => set({ occurrenceFilePath: path }),

  recordCount: 0,
  setRecordCount: (count) => set({ recordCount: count }),

  cleanedOccurrence: null,
  setCleanedOccurrence: (data) => set({ cleanedOccurrence: data }),

  occurrenceData: null,
  setOccurrenceData: (data) => set({ occurrenceData: data }),

  uploadResult: null,
  setUploadResult: (result) => set({ uploadResult: result }),

  cleanResult: null,
  setCleanResult: (result) => set({ cleanResult: result }),

  flaggedIndices: [],
  setFlaggedIndices: (indices) => set({ flaggedIndices: indices }),

  reset: () =>
    set({
      species: "Untitled species",
      occurrenceFilePath: null,
      recordCount: 0,
      cleanedOccurrence: null,
      occurrenceData: null,
      uploadResult: null,
      cleanResult: null,
      flaggedIndices: [],
    }),
}));