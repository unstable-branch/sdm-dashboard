import { create } from "zustand";

interface SDMState {
  species: string;
  setSpecies: (species: string) => void;

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
}

export const useSDMStore = create<SDMState>((set) => ({
  species: "Untitled species",
  setSpecies: (species) => set({ species }),

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
}));
