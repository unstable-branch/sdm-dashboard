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
  config: import("./schemas").ModelConfig;
  metrics: RunMetrics | null;
  lastStage: string | null;
  startedAt: string | null;
  completedAt: string | null;
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
  lastStage: string | null;
  startedAt: string;
  completedAt?: string;
  error?: string;
}
