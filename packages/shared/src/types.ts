export interface BiovarChoice {
  id: number;
  label: string;
  description: string;
}

export interface ModelBackend {
  id: string;
  label: string;
  method: string;
  maturity: "stable" | "experimental" | "deprecated";
  supportsImportance: boolean;
  supportsUncertainty: boolean;
  supportsFuture: boolean;
  minRecords: number | null;
}

export interface Species {
  id: string;
  name: string;
  createdAt: string;
  occurrenceCount: number;
}

export interface Run {
  id: string;
  speciesId: string;
  modelId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  config: ModelConfig;
  metrics: RunMetrics | null;
  startedAt: string | null;
  completedAt: string | null;
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

export interface RunMetrics {
  auc: number;
  tss: number;
  cbi: number;
  presenceRecords: number;
  backgroundPoints: number;
  elapsedSeconds: number;
}

export interface JobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  progressLabel: string;
  logs: string[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}
