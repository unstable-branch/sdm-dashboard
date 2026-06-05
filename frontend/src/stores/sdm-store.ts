import { create } from "zustand";
import type { WorkspaceFile } from "@/app/(dashboard)/data/types";

interface SDMState {
  species: string;
  setSpecies: (species: string) => void;

  occurrenceFilePath: string | null;
  setOccurrenceFilePath: (path: string | null) => void;

  recordCount: number;
  setRecordCount: (count: number) => void;

  pipelineRunId: string | null;
  setPipelineRunId: (id: string | null) => void;

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

  detectedSpecies: string[];
  setDetectedSpecies: (species: string[]) => void;

  targetsRunId: string | null;
  setTargetsRunId: (id: string | null) => void;

  targetsProgress: {
    completed: number;
    errored: number;
    running: number;
    total: number;
  } | null;
  setTargetsProgress: (progress: SDMState["targetsProgress"]) => void;

  modelJobId: string | null;
  setModelJobId: (id: string | null) => void;

  modelJobStartTime: string | null;
  setModelJobStartTime: (time: string | null) => void;

  workspaceFiles: WorkspaceFile[];
  setWorkspaceFiles: (files: WorkspaceFile[] | ((prev: WorkspaceFile[]) => WorkspaceFile[])) => void;

  error: string | null;
  setError: (error: string | null) => void;

  reset: () => void;
}

export const useSDMStore = create<SDMState>()((set) => ({
  species: "Untitled species",
  setSpecies: (species) => set({ species }),

  occurrenceFilePath: null,
  setOccurrenceFilePath: (path) => set({ occurrenceFilePath: path }),

  recordCount: 0,
  setRecordCount: (count) => set({ recordCount: count }),

  pipelineRunId: null,
  setPipelineRunId: (id) => set({ pipelineRunId: id }),

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

  detectedSpecies: [],
  setDetectedSpecies: (species) => set({ detectedSpecies: species }),

  targetsRunId: null,
  setTargetsRunId: (id) => set({ targetsRunId: id }),

  targetsProgress: null,
  setTargetsProgress: (progress) => set({ targetsProgress: progress }),

  modelJobId: null,
  setModelJobId: (id) => set({ modelJobId: id }),

  modelJobStartTime: null,
  setModelJobStartTime: (time) => set({ modelJobStartTime: time }),

  workspaceFiles: [],
  setWorkspaceFiles: (files) => set((state) => ({
    workspaceFiles: typeof files === "function" ? files(state.workspaceFiles) : files,
  })),

  error: null,
  setError: (error) => set({ error }),

  reset: () =>
    set({
      species: "Untitled species",
      occurrenceFilePath: null,
      recordCount: 0,
      pipelineRunId: null,
      cleanedOccurrence: null,
      occurrenceData: null,
      uploadResult: null,
      cleanResult: null,
      flaggedIndices: [],
      detectedSpecies: [],
      targetsRunId: null,
      targetsProgress: null,
      modelJobId: null,
      modelJobStartTime: null,
      workspaceFiles: [],
      error: null,
    }),
}));
