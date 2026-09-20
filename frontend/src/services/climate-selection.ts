import type { ClimateScenarioResponse } from "./types";

interface ClimateSelectionConfig {
  source?: "worldclim" | "chelsa";
  worldclimRes?: number;
  aggregationFactor?: number;
  futureProjection?: boolean;
  futureGcm?: string;
  futureSsp?: string;
  futurePeriod?: string;
  futureProjection2?: boolean;
  futureGcm2?: string;
  futureSsp2?: string;
  futurePeriod2?: string;
}

function currentCollectionMatches(scenario: ClimateScenarioResponse, config: ClimateSelectionConfig): boolean {
  if (scenario.type !== "current" || scenario.source !== config.source) return false;
  const nativeResolution = Number(scenario.resolution);
  const requestedResolution = Number(config.worldclimRes);
  if (!Number.isFinite(nativeResolution) || !Number.isFinite(requestedResolution)) return false;
  if (nativeResolution === requestedResolution) return true;

  // A coarser requested resolution is valid only when the submitted
  // aggregation factor records the model-time transformation; no finer or
  // invented collection is used. This covers CHELSA's native 0.5 arc-minutes
  // as well as coarser WorldClim collections.
  if (requestedResolution < nativeResolution) return false;
  const requiredAggregation = Math.ceil(requestedResolution / nativeResolution);
  return Number(config.aggregationFactor) >= requiredAggregation;
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

function selectUniqueCollection(
  scenarios: ClimateScenarioResponse[],
  matches: (scenario: ClimateScenarioResponse) => boolean,
  unavailableMessage: string,
  ambiguousMessage: string,
): ClimateScenarioResponse {
  const candidates = scenarios.filter((scenario) =>
    matches(scenario) && typeof scenario.climateCollectionId === "string"
  );
  if (candidates.length === 0) throw new Error(unavailableMessage);
  if (candidates.length > 1) throw new Error(ambiguousMessage);
  return candidates[0];
}

export function selectClimateCollectionIds(
  scenarios: ClimateScenarioResponse[],
  config: ClimateSelectionConfig,
): { currentClimateAssetId: string; futureClimateAssetId?: string; futureClimateAssetId2?: string } {
  const current = selectUniqueCollection(
    scenarios,
    (scenario) => currentCollectionMatches(scenario, config),
    "Current climate collection is unavailable",
    "Current climate collection is ambiguous",
  );

  const selected: { currentClimateAssetId: string; futureClimateAssetId?: string; futureClimateAssetId2?: string } = {
    currentClimateAssetId: current.climateCollectionId,
  };
  if (config.futureProjection) {
    const future = selectUniqueCollection(
      scenarios,
      (scenario) => futureMatch(scenario, config.futureGcm, config.futureSsp, config.futurePeriod),
      "Future climate collection is unavailable",
      "Future climate collection is ambiguous",
    );
    selected.futureClimateAssetId = future.climateCollectionId;
  }
  if (config.futureProjection2) {
    const future = selectUniqueCollection(
      scenarios,
      (scenario) => futureMatch(scenario, config.futureGcm2, config.futureSsp2, config.futurePeriod2),
      "Second future climate collection is unavailable",
      "Second future climate collection is ambiguous",
    );
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
  if (canonical.maskBoundaryType === "custom") {
    if (typeof canonical.maskAssetId !== "string" || !UUID_PATTERN.test(canonical.maskAssetId)) {
      throw new Error("Custom boundary selection is unavailable");
    }
  } else if (canonical.maskAssetId === "all") {
    delete canonical.maskAssetId;
  }
  return { ...canonical, ...selectClimateCollectionIds(scenarios, config) };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
