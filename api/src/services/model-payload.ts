import { join } from "path";
import { resolveInputAsset, type InputAssetDependencies, type InputAssetDenialReason, type InputAssetPrincipal } from "./input-assets.js";
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
  occurrenceAssetId?: string;
  biovars?: number[];
  projectionExtent?: number[];
  trainingExtent?: number[];
  backgroundN?: number;
  cvFolds?: number;
};

export { projectSafeScienceConfig };
export type { UnsafeExecutionConfigError };

export function buildModelPayload(config: ModelConfigRecord, runId: string, occurrencePath: string): Record<string, unknown> {
  const safeConfig = projectSafeScienceConfig(config);
  const restSnake: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(safeConfig)) {
    if (key === "occurrenceAssetId" || key === "biovars" || key === "projectionExtent" || key === "trainingExtent") continue;
    const snakeKey = CAMEL_TO_SNAKE[key];
    if (snakeKey) restSnake[snakeKey] = val;
  }
  const payload: Record<string, unknown> = {
    ...restSnake,
    species: safeConfig.species,
    model_id: safeConfig.modelId,
    occurrence_file: occurrencePath,
    biovars: Array.isArray(safeConfig.biovars) ? safeConfig.biovars.join(",") : "",
    projection_extent: Array.isArray(safeConfig.projectionExtent) ? safeConfig.projectionExtent.join(",") : "",
    training_extent: Array.isArray(safeConfig.trainingExtent) ? safeConfig.trainingExtent.join(",") : undefined,
    output_dir: join("outputs", "jobs", runId),
  };
  return payload;
}

export function buildTargetsConfig(config: ModelConfigRecord, occurrencePath: string): Record<string, unknown> {
  const safeConfig = projectSafeScienceConfig(config);
  const scienceConfig = { ...safeConfig };
  delete scienceConfig.occurrenceAssetId;
  return { ...scienceConfig, occurrenceFile: occurrencePath };
}


export class ModelInputAssetError extends Error {
  constructor(readonly reason: InputAssetDenialReason) {
    super("Model input asset is unavailable");
    this.name = "ModelInputAssetError";
  }
}

export async function resolveModelInputAsset(
  config: ModelConfigRecord,
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies = {},
): Promise<{ absolutePath: string; kind: "raw_occurrence" | "cleaned_occurrence" }> {
  const assetId = config.occurrenceAssetId;
  if (typeof assetId !== "string") throw new ModelInputAssetError("invalid_request");
  const resolution = await resolveInputAsset({
    assetId,
    principal,
    action: "use",
    allowedKinds: ["raw_occurrence", "cleaned_occurrence"],
    destinationProjectId: projectId,
  }, dependencies);
  if (!resolution.ok) throw new ModelInputAssetError(resolution.reason);
  return { absolutePath: resolution.absolutePath, kind: resolution.asset.kind as "raw_occurrence" | "cleaned_occurrence" };
}

export async function resolveModelPayload(
  config: ModelConfigRecord,
  runId: string,
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies = {},
): Promise<Record<string, unknown>> {
  const asset = await resolveModelInputAsset(config, principal, projectId, dependencies);
  return buildModelPayload(config, runId, asset.absolutePath);
}

export async function resolveTargetsConfigs(
  configs: ModelConfigRecord[],
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies = {},
): Promise<Record<string, unknown>[]> {
  return Promise.all(configs.map(async (config) => {
    const asset = await resolveModelInputAsset(config, principal, projectId, dependencies);
    return buildTargetsConfig(config, asset.absolutePath);
  }));
}
