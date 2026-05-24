export interface Species {
  id: string;
  name: string;
  createdAt: Date;
  occurrenceCount: number;
}

export interface OccurrenceRecord {
  id: string;
  speciesId: string;
  longitude: number;
  latitude: number;
  source: string;
  flagged: boolean;
  flagReason?: string;
}

export interface ModelConfig {
  species: string;
  modelId: string;
  biovars: number[];
  projectionExtent: [number, number, number, number];
  backgroundN: number;
  cvFolds: number;
  cvStrategy: "random" | "spatial_blocks";
  threshold: number;
  includeQuadratic: boolean;
  useElevation: boolean;
  useSoil: boolean;
  nCores: number;
  seed: number;
}

export interface ModelResult {
  config: ModelConfig;
  metrics: {
    auc: number;
    tss: number;
    cbi: number;
    presenceRecords: number;
    backgroundPoints: number;
    elapsedSeconds: number;
  };
  cv: {
    k: number;
    strategy: string;
    aucMean: number;
    aucSd: number;
    tssMean: number;
    tssSd: number;
  };
  summary: {
    cellCount: number;
    meanSuitability: number;
    maxSuitability: number;
    cellsAboveThreshold: number;
    percentAboveThreshold: number;
    highRiskAreaKm2: number;
  };
  variableImportance: {
    variable: string;
    importance: number;
    sd: number;
  }[];
}

export interface JobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  progressLabel: string;
  logs: string[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}
