import { join } from "path";
import {
  resolveClimateCollectionDirectory,
  resolveInputAsset,
  type InputAssetDependencies,
  type InputAssetDenialReason,
  type InputAssetKind,
  type InputAssetPrincipal,
} from "./input-assets.js";
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
  maskAssetId?: string;
  targetGroupAssetId?: string;
  currentClimateAssetId?: string;
  futureClimateAssetId?: string;
  futureClimateAssetId2?: string;
  biovars?: number[];
  projectionExtent?: number[];
  trainingExtent?: number[];
  backgroundN?: number;
  cvFolds?: number;
};

export interface ResolvedModelInputPaths {
  occurrenceFile: string;
  maskFile?: string;
  targetGroupFile?: string;
  worldclimDir: string;
  futureWorldclimDir?: string;
  futureWorldclimDir2?: string;
}

export { projectSafeScienceConfig };
export type { UnsafeExecutionConfigError };

export function buildModelPayload(
  config: ModelConfigRecord,
  runId: string,
  occurrencePath: string,
  resolved: Partial<Omit<ResolvedModelInputPaths, "occurrenceFile">> = {},
): Record<string, unknown> {
  const safeConfig = projectSafeScienceConfig(config);
  const restSnake: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(safeConfig)) {
    if (key.endsWith("AssetId") || key === "biovars" || key === "projectionExtent" || key === "trainingExtent") continue;
    const snakeKey = CAMEL_TO_SNAKE[key];
    if (snakeKey) restSnake[snakeKey] = val;
  }
  const payload: Record<string, unknown> = {
    ...restSnake,
    species: safeConfig.species,
    model_id: safeConfig.modelId,
    occurrence_file: occurrencePath,
    mask_file: resolved.maskFile,
    target_group_file: resolved.targetGroupFile,
    worldclim_dir: resolved.worldclimDir,
    future_worldclim_dir: resolved.futureWorldclimDir,
    future_worldclim_dir2: resolved.futureWorldclimDir2,
    biovars: Array.isArray(safeConfig.biovars) ? safeConfig.biovars.join(",") : "",
    projection_extent: Array.isArray(safeConfig.projectionExtent) ? safeConfig.projectionExtent.join(",") : "",
    training_extent: Array.isArray(safeConfig.trainingExtent) ? safeConfig.trainingExtent.join(",") : undefined,
    output_dir: join("outputs", "jobs", runId),
  };
  return payload;
}

export function buildTargetsConfig(
  config: ModelConfigRecord,
  occurrencePath: string,
  resolved: Partial<Omit<ResolvedModelInputPaths, "occurrenceFile">> = {},
): Record<string, unknown> {
  const safeConfig = projectSafeScienceConfig(config);
  const scienceConfig = { ...safeConfig };
  for (const key of Object.keys(scienceConfig)) {
    if (key.endsWith("AssetId")) delete scienceConfig[key];
  }
  return {
    ...scienceConfig,
    occurrenceFile: occurrencePath,
    maskFile: resolved.maskFile,
    targetGroupFile: resolved.targetGroupFile,
    worldclimDir: resolved.worldclimDir,
    futureWorldclimDir: resolved.futureWorldclimDir,
    futureWorldclimDir2: resolved.futureWorldclimDir2,
  };
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

async function resolveTypedAsset(
  assetId: unknown,
  kind: InputAssetKind,
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies,
): Promise<string> {
  if (typeof assetId !== "string") throw new ModelInputAssetError("invalid_request");
  const resolution = await resolveInputAsset({
    assetId,
    principal,
    action: "use",
    expectedKind: kind,
    destinationProjectId: projectId,
  }, dependencies);
  if (!resolution.ok) throw new ModelInputAssetError(resolution.reason);
  if (kind !== "climate_collection") return resolution.absolutePath;
  const directory = await resolveClimateCollectionDirectory(resolution.absolutePath, dependencies);
  if (!directory) throw new ModelInputAssetError("unsafe_storage");
  return directory;
}

export async function resolveModelInputAssets(
  config: ModelConfigRecord,
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies = {},
): Promise<ResolvedModelInputPaths> {
  const safeConfig = projectSafeScienceConfig(config) as ModelConfigRecord;
  if (safeConfig.maskBoundaryType === "custom" && typeof safeConfig.maskAssetId !== "string") {
    throw new ModelInputAssetError("invalid_request");
  }
  if (safeConfig.biasMethod === "target_group" && typeof safeConfig.targetGroupAssetId !== "string") {
    throw new ModelInputAssetError("invalid_request");
  }
  if (safeConfig.futureProjection === true && typeof safeConfig.futureClimateAssetId !== "string") {
    throw new ModelInputAssetError("invalid_request");
  }
  if (safeConfig.futureProjection2 === true && typeof safeConfig.futureClimateAssetId2 !== "string") {
    throw new ModelInputAssetError("invalid_request");
  }

  const occurrence = await resolveModelInputAsset(safeConfig, principal, projectId, dependencies);
  const worldclimDir = await resolveTypedAsset(
    safeConfig.currentClimateAssetId,
    "climate_collection",
    principal,
    projectId,
    dependencies,
  );
  const [maskFile, targetGroupFile, futureWorldclimDir, futureWorldclimDir2] = await Promise.all([
    safeConfig.maskAssetId
      ? resolveTypedAsset(safeConfig.maskAssetId, "custom_boundary", principal, projectId, dependencies)
      : undefined,
    safeConfig.targetGroupAssetId
      ? resolveTypedAsset(safeConfig.targetGroupAssetId, "target_group", principal, projectId, dependencies)
      : undefined,
    safeConfig.futureClimateAssetId
      ? resolveTypedAsset(safeConfig.futureClimateAssetId, "climate_collection", principal, projectId, dependencies)
      : undefined,
    safeConfig.futureClimateAssetId2
      ? resolveTypedAsset(safeConfig.futureClimateAssetId2, "climate_collection", principal, projectId, dependencies)
      : undefined,
  ]);
  return {
    occurrenceFile: occurrence.absolutePath,
    worldclimDir,
    maskFile,
    targetGroupFile,
    futureWorldclimDir,
    futureWorldclimDir2,
  };
}

export async function resolveModelPayload(
  config: ModelConfigRecord,
  runId: string,
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies = {},
): Promise<Record<string, unknown>> {
  const assets = await resolveModelInputAssets(config, principal, projectId, dependencies);
  return buildModelPayload(config, runId, assets.occurrenceFile, assets);
}

export async function resolveTargetsConfigs(
  configs: ModelConfigRecord[],
  principal: InputAssetPrincipal,
  projectId: string | null,
  dependencies: InputAssetDependencies = {},
): Promise<Record<string, unknown>[]> {
  return Promise.all(configs.map(async (config) => {
    const assets = await resolveModelInputAssets(config, principal, projectId, dependencies);
    return buildTargetsConfig(config, assets.occurrenceFile, assets);
  }));
}
