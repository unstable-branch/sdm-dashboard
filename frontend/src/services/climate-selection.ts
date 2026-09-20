import type { ClimateScenarioResponse } from "./types";

interface ClimateSelectionConfig {
  source?: "worldclim" | "chelsa";
  worldclimRes?: number;
  futureProjection?: boolean;
  futureGcm?: string;
  futureSsp?: string;
  futurePeriod?: string;
  futureProjection2?: boolean;
  futureGcm2?: string;
  futureSsp2?: string;
  futurePeriod2?: string;
}

function sameResolution(scenario: ClimateScenarioResponse, resolution: number | undefined): boolean {
  return scenario.resolution === undefined || resolution === undefined || Number(scenario.resolution) === Number(resolution);
}

function futureMatch(
  scenario: ClimateScenarioResponse,
  gcm: string | undefined,
  ssp: string | undefined,
  period: string | undefined,
): boolean {
  return scenario.type === "future"
    && scenario.gcm === gcm
    && scenario.ssp === ssp
    && scenario.period === period;
}

export function selectClimateCollectionIds(
  scenarios: ClimateScenarioResponse[],
  config: ClimateSelectionConfig,
): { currentClimateAssetId: string; futureClimateAssetId?: string; futureClimateAssetId2?: string } {
  const current = scenarios.find((scenario) =>
    scenario.type === "current"
    && scenario.source === config.source
    && sameResolution(scenario, config.worldclimRes)
    && typeof scenario.climateCollectionId === "string");
  if (!current?.climateCollectionId) throw new Error("Current climate collection is unavailable");

  const selected: { currentClimateAssetId: string; futureClimateAssetId?: string; futureClimateAssetId2?: string } = {
    currentClimateAssetId: current.climateCollectionId,
  };
  if (config.futureProjection) {
    const future = scenarios.find((scenario) =>
      futureMatch(scenario, config.futureGcm, config.futureSsp, config.futurePeriod)
      && sameResolution(scenario, config.worldclimRes)
      && typeof scenario.climateCollectionId === "string");
    if (!future?.climateCollectionId) throw new Error("Future climate collection is unavailable");
    selected.futureClimateAssetId = future.climateCollectionId;
  }
  if (config.futureProjection2) {
    const future = scenarios.find((scenario) =>
      futureMatch(scenario, config.futureGcm2, config.futureSsp2, config.futurePeriod2)
      && sameResolution(scenario, config.worldclimRes)
      && typeof scenario.climateCollectionId === "string");
    if (!future?.climateCollectionId) throw new Error("Second future climate collection is unavailable");
    selected.futureClimateAssetId2 = future.climateCollectionId;
  }
  return selected;
}

const LEGACY_MODEL_PATH_KEYS = new Set([
  "maskFile",
  "targetGroupFile",
  "futureWorldclimDir",
  "futureWorldclimDir2",
]);

export function buildCanonicalModelSubmission(
  config: ClimateSelectionConfig & Record<string, unknown>,
  scenarios: ClimateScenarioResponse[],
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!LEGACY_MODEL_PATH_KEYS.has(key)) canonical[key] = value;
  }
  return { ...canonical, ...selectClimateCollectionIds(scenarios, config) };
}
