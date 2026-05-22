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
    df: Record<string, unknown>[];
    sourceCounts: Record<string, number>;
    nAbsentExcluded: number;
    originalRows: number;
  } | null;
  setCleanedOccurrence: (data: SDMState["cleanedOccurrence"]) => void;

  result: Record<string, unknown> | null;
  setResult: (result: Record<string, unknown> | null) => void;

  running: boolean;
  setRunning: (running: boolean) => void;

  log: string;
  appendLog: (message: string) => void;
  clearLog: () => void;

  error: string | null;
  setError: (error: string | null) => void;

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

      result: null,
      setResult: (result) => set({ result }),

      running: false,
      setRunning: (running) => set({ running }),

      log: "",
      appendLog: (message) =>
        set((state) => ({
          log: state.log + `${new Date().toLocaleTimeString()}  ${message}\n`,
        })),
      clearLog: () => set({ log: "" }),

      error: null,
      setError: (error) => set({ error }),

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
      }),
    }
  )
);
