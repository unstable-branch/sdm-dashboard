import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_SCENARIO_SCHEMA_VERSION,
  ENVIRONMENT_SET_SCHEMA_VERSION,
  MAX_ENVIRONMENT_SCENARIOS,
  MAX_ENVIRONMENT_VARIABLES,
  MAX_ENVIRONMENT_WARNINGS,
  STUDY_AREA_SCHEMA_VERSION,
  WorkflowObjectSchemaError,
  parseEnvironmentSetSummary,
  parseStudyArea,
} from "./workflow-object-schemas.js";

describe("workflow object schemas", () => {
  it("normalizes a valid study-area preset", () => {
    const studyArea = parseStudyArea({ type: "preset", preset_id: "aus_east" });

    expect(studyArea).toEqual({
      schema_version: STUDY_AREA_SCHEMA_VERSION,
      type: "preset",
      id: "aus_east",
      label: "Eastern Australia",
      crs: "EPSG:4326",
      extent: [138, 154, -44, -10],
    });
  });

  it("accepts a valid custom bbox extent", () => {
    const studyArea = parseStudyArea({
      type: "custom",
      label: "Survey bbox",
      crs: "EPSG:4326",
      extent: [120.5, 131.25, -37.5, -22.75],
    });

    expect(studyArea.schema_version).toBe(STUDY_AREA_SCHEMA_VERSION);
    expect(studyArea.type).toBe("custom");
    expect(studyArea.label).toBe("Survey bbox");
    expect(studyArea.extent).toEqual([120.5, 131.25, -37.5, -22.75]);
  });

  it("rejects invalid CRS and extent values", () => {
    expect(() =>
      parseStudyArea({
        type: "custom",
        crs: "EPSG:3857",
        extent: [120, 130, -30, -20],
      }),
    ).toThrow(WorkflowObjectSchemaError);

    expect(() =>
      parseStudyArea({
        type: "custom",
        crs: "EPSG:4326",
        extent: [130, 120, -30, -20],
      }),
    ).toThrow(WorkflowObjectSchemaError);
  });

  it("bounds environment-set summary previews", () => {
    const scenarios = Array.from({ length: MAX_ENVIRONMENT_SCENARIOS + 5 }, (_, index) => ({
      id: `scenario-${index}`,
      label: `Scenario ${index}`,
      source: "worldclim" as const,
      status: "available" as const,
      gcm: "UKESM1-0-LL",
      ssp: "SSP2-4.5",
      period: "2041-2060",
      variables: [`BIO${(index % 19) + 1}`],
    }));
    const variables = Array.from({ length: MAX_ENVIRONMENT_VARIABLES + 10 }, (_, index) => `VAR_${index}`);
    const warnings = Array.from({ length: MAX_ENVIRONMENT_WARNINGS + 3 }, (_, index) => `warning ${index}`);

    const summary = parseEnvironmentSetSummary({
      id: "worldclim-future",
      label: "WorldClim future scenarios",
      source: "worldclim",
      variables,
      scenarios,
      warnings,
      extent: [-180, 180, -90, 90],
      crs: "EPSG:4326",
    });

    expect(summary.schema_version).toBe(ENVIRONMENT_SET_SCHEMA_VERSION);
    expect(summary.scenarios).toHaveLength(MAX_ENVIRONMENT_SCENARIOS);
    expect(summary.scenario_count).toBe(MAX_ENVIRONMENT_SCENARIOS + 5);
    expect(summary.variables).toHaveLength(MAX_ENVIRONMENT_VARIABLES);
    expect(summary.variable_count).toBe(MAX_ENVIRONMENT_VARIABLES + 10);
    expect(summary.warnings).toHaveLength(MAX_ENVIRONMENT_WARNINGS);
    expect(summary.scenarios[0]?.schema_version).toBe(ENVIRONMENT_SCENARIO_SCHEMA_VERSION);
  });

  it("keeps schema version names stable", () => {
    expect(STUDY_AREA_SCHEMA_VERSION).toBe("study_area.v1");
    expect(ENVIRONMENT_SCENARIO_SCHEMA_VERSION).toBe("environment_scenario_summary.v1");
    expect(ENVIRONMENT_SET_SCHEMA_VERSION).toBe("environment_set_summary.v1");
  });
});
