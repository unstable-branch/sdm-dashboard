import { join } from "path";
import {
  CAMEL_TO_SNAKE,
  SAFE_MODEL_CONFIG_KEYS,
  projectSafeScienceConfig,
  type UnsafeExecutionConfigError,
} from "./execution-config.js";

export { CAMEL_TO_SNAKE, SAFE_MODEL_CONFIG_KEYS };
export type ModelConfigRecord = Record<string, unknown> & {
  species?: string;
  modelId?: string;
  cleanedFilePath?: string;
  occurrenceFile?: string;
  biovars?: number[];
  projectionExtent?: number[];
  trainingExtent?: number[];
  backgroundN?: number;
  cvFolds?: number;
};

export { projectSafeScienceConfig };
export type { UnsafeExecutionConfigError };

export function buildModelPayload(config: ModelConfigRecord, runId: string): Record<string, unknown> {
  const safeConfig = projectSafeScienceConfig(config);
  const rawPath = safeConfig.cleanedFilePath || safeConfig.occurrenceFile || null;
  const restSnake: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(safeConfig)) {
    if (key === "biovars" || key === "projectionExtent" || key === "trainingExtent") continue;
    const snakeKey = CAMEL_TO_SNAKE[key];
    if (snakeKey) restSnake[snakeKey] = val;
  }
  const payload: Record<string, unknown> = {
    ...restSnake,
    species: safeConfig.species,
    model_id: safeConfig.modelId,
    occurrence_file: rawPath,
    biovars: Array.isArray(safeConfig.biovars) ? safeConfig.biovars.join(",") : "",
    projection_extent: Array.isArray(safeConfig.projectionExtent) ? safeConfig.projectionExtent.join(",") : "",
    training_extent: Array.isArray(safeConfig.trainingExtent) ? safeConfig.trainingExtent.join(",") : undefined,
    output_dir: join("outputs", "jobs", runId),
  };
  if (rawPath) payload.cleaned_file_id = rawPath;
  return payload;
}
