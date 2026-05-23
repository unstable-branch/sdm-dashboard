import { create } from "zustand";
import { persist } from "zustand/middleware";

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

  // Non-persisted: large dataframe fetched on-demand
  occurrenceData: Record<string, unknown>[] | null;
  setOccurrenceData: (data: Record<string, unknown>[] | null) => void;

  uploadResult: Record<string, unknown> | null;
  setUploadResult: (result: Record<string, unknown> | null) => void;

  cleanResult: Record<string, unknown> | null;
  setCleanResult: (result: Record<string, unknown> | null) => void;

  flaggedIndices: number[];
  setFlaggedIndices: (indices: number[]) => void;
}

export const useSDMStore = create<SDMState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: "sdm-storage",
      partialize: (state) => ({
        species: state.species,
        occurrenceFilePath: state.occurrenceFilePath,
        recordCount: state.recordCount,
        uploadResult: state.uploadResult,
        cleanResult: state.cleanResult,
        flaggedIndices: state.flaggedIndices,
        // Exclude large df array from localStorage — store metadata only
        cleanedOccurrence: state.cleanedOccurrence
          ? { ...state.cleanedOccurrence, df: [] }
          : null,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && typeof state.occurrenceFilePath !== "string" && state.occurrenceFilePath !== null) {
          state.occurrenceFilePath = null;
        }
        if (state && typeof state.recordCount !== "number") {
          state.recordCount = 0;
        }
        if (state && state.cleanedOccurrence) {
          const co = state.cleanedOccurrence;
          if (typeof co.filePath !== "string" || !co.filePath) {
            state.cleanedOccurrence = null;
          } else if (typeof co.validRecords !== "number") {
            co.validRecords = 0;
          }
          // df was stripped on persist — restore as empty, will be fetched on-demand
          co.df = [];
        }
        if (state && typeof state.species !== "string") {
          state.species = "Untitled species";
        }
      },
    }
  )
);
