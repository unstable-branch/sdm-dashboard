import { EXTENT_PRESETS } from "@sdm/shared";
import { z } from "zod";

export const STUDY_AREA_SCHEMA_VERSION = "study_area.v1";
export const ENVIRONMENT_SCENARIO_SCHEMA_VERSION = "environment_scenario_summary.v1";
export const ENVIRONMENT_SET_SCHEMA_VERSION = "environment_set_summary.v1";

export const WGS84_CRS = "EPSG:4326";

export const MAX_ENVIRONMENT_SCENARIOS = 20;
export const MAX_ENVIRONMENT_VARIABLES = 64;
export const MAX_ENVIRONMENT_WARNINGS = 20;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 256;
const MAX_VARIABLE_LENGTH = 64;

export const workflowExtentSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-90).max(90),
  ])
  .refine(([xmin, xmax, ymin, ymax]) => xmin < xmax && ymin < ymax, {
    message: "Invalid extent: xmin must be < xmax and ymin must be < ymax",
  });

const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);
const labelSchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH);
const nullableLabelSchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH).nullable();
const optionalSummaryTextSchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH).nullable().optional();

const studyAreaPresetInputSchema = z
  .object({
    type: z.literal("preset"),
    preset_id: idSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!Object.prototype.hasOwnProperty.call(EXTENT_PRESETS, value.preset_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preset_id"],
        message: "Unknown study-area preset",
      });
    }
  });

const studyAreaCustomInputSchema = z
  .object({
    type: z.literal("custom"),
    label: labelSchema.optional(),
    crs: z.literal(WGS84_CRS).default(WGS84_CRS),
    extent: workflowExtentSchema,
  })
  .strict();

export const studyAreaInputSchema = z.union([studyAreaPresetInputSchema, studyAreaCustomInputSchema]);

export const studyAreaSchema = z
  .object({
    schema_version: z.literal(STUDY_AREA_SCHEMA_VERSION),
    type: z.enum(["preset", "custom"]),
    id: idSchema,
    label: nullableLabelSchema,
    crs: z.literal(WGS84_CRS),
    extent: workflowExtentSchema,
  })
  .strict();

export const environmentSourceSchema = z.enum(["worldclim", "chelsa", "custom", "unknown"]);
export const environmentStatusSchema = z.enum(["available", "pending", "missing", "unknown"]);

export const environmentScenarioSummarySchema = z
  .object({
    schema_version: z.literal(ENVIRONMENT_SCENARIO_SCHEMA_VERSION),
    id: idSchema,
    label: labelSchema,
    source: environmentSourceSchema,
    status: environmentStatusSchema,
    gcm: nullableLabelSchema,
    ssp: nullableLabelSchema,
    period: nullableLabelSchema,
    variables: z.array(z.string().min(1).max(MAX_VARIABLE_LENGTH)).max(MAX_ENVIRONMENT_VARIABLES),
    extent: workflowExtentSchema.nullable(),
    crs: z.literal(WGS84_CRS).nullable(),
    resolution_arcmin: z.number().positive().max(60).nullable(),
  })
  .strict();

const environmentScenarioSummaryInputSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    source: environmentSourceSchema.default("unknown"),
    status: environmentStatusSchema.default("unknown"),
    gcm: optionalSummaryTextSchema,
    ssp: optionalSummaryTextSchema,
    period: optionalSummaryTextSchema,
    variables: z.array(z.string().trim().min(1)).default([]),
    extent: workflowExtentSchema.nullable().optional(),
    crs: z.literal(WGS84_CRS).nullable().optional(),
    resolution_arcmin: z.number().positive().max(60).nullable().optional(),
  })
  .strict();

export const environmentSetSummarySchema = z
  .object({
    schema_version: z.literal(ENVIRONMENT_SET_SCHEMA_VERSION),
    id: idSchema,
    label: labelSchema,
    source: environmentSourceSchema,
    variables: z.array(z.string().min(1).max(MAX_VARIABLE_LENGTH)).max(MAX_ENVIRONMENT_VARIABLES),
    variable_count: z.number().int().min(0),
    scenarios: z.array(environmentScenarioSummarySchema).max(MAX_ENVIRONMENT_SCENARIOS),
    scenario_count: z.number().int().min(0),
    baseline: environmentScenarioSummarySchema.nullable(),
    extent: workflowExtentSchema.nullable(),
    crs: z.literal(WGS84_CRS).nullable(),
    warnings: z.array(z.string().min(1).max(MAX_LABEL_LENGTH)).max(MAX_ENVIRONMENT_WARNINGS),
  })
  .strict();

const environmentSetSummaryInputSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    source: environmentSourceSchema.default("unknown"),
    variables: z.array(z.string().trim().min(1)).default([]),
    variable_count: z.number().int().min(0).optional(),
    scenarios: z.array(environmentScenarioSummaryInputSchema).default([]),
    scenario_count: z.number().int().min(0).optional(),
    baseline: environmentScenarioSummaryInputSchema.nullable().optional(),
    extent: workflowExtentSchema.nullable().optional(),
    crs: z.literal(WGS84_CRS).nullable().optional(),
    warnings: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type StudyArea = z.infer<typeof studyAreaSchema>;
export type StudyAreaInput = z.infer<typeof studyAreaInputSchema>;
export type EnvironmentScenarioSummary = z.infer<typeof environmentScenarioSummarySchema>;
export type EnvironmentSetSummary = z.infer<typeof environmentSetSummarySchema>;

export class WorkflowObjectSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowObjectSchemaError";
  }
}

export function parseStudyArea(input: unknown): StudyArea {
  const parsed = studyAreaInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowObjectSchemaError(schemaErrorMessage("Invalid study area", parsed.error));
  }

  if (parsed.data.type === "preset") {
    const preset = EXTENT_PRESETS[parsed.data.preset_id];
    return studyAreaSchema.parse({
      schema_version: STUDY_AREA_SCHEMA_VERSION,
      type: "preset",
      id: parsed.data.preset_id,
      label: preset.label,
      crs: WGS84_CRS,
      extent: preset.extent,
    });
  }

  return studyAreaSchema.parse({
    schema_version: STUDY_AREA_SCHEMA_VERSION,
    type: "custom",
    id: "custom",
    label: parsed.data.label ?? null,
    crs: parsed.data.crs,
    extent: parsed.data.extent,
  });
}

export function parseEnvironmentScenarioSummary(input: unknown): EnvironmentScenarioSummary {
  const parsed = environmentScenarioSummaryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowObjectSchemaError(schemaErrorMessage("Invalid environment scenario summary", parsed.error));
  }

  return environmentScenarioSummarySchema.parse({
    schema_version: ENVIRONMENT_SCENARIO_SCHEMA_VERSION,
    id: parsed.data.id,
    label: parsed.data.label,
    source: parsed.data.source,
    status: parsed.data.status,
    gcm: parsed.data.gcm ?? null,
    ssp: parsed.data.ssp ?? null,
    period: parsed.data.period ?? null,
    variables: boundedStringList(parsed.data.variables, MAX_ENVIRONMENT_VARIABLES, MAX_VARIABLE_LENGTH),
    extent: parsed.data.extent ?? null,
    crs: parsed.data.crs ?? (parsed.data.extent ? WGS84_CRS : null),
    resolution_arcmin: parsed.data.resolution_arcmin ?? null,
  });
}

export function parseEnvironmentSetSummary(input: unknown): EnvironmentSetSummary {
  const parsed = environmentSetSummaryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowObjectSchemaError(schemaErrorMessage("Invalid environment set summary", parsed.error));
  }

  const scenarios = parsed.data.scenarios.slice(0, MAX_ENVIRONMENT_SCENARIOS).map(parseEnvironmentScenarioSummary);
  const baseline = parsed.data.baseline ? parseEnvironmentScenarioSummary(parsed.data.baseline) : null;
  const rawVariables = parsed.data.variables.length > 0 ? parsed.data.variables : scenarios.flatMap((scenario) => scenario.variables);
  const variables = boundedStringList(rawVariables, MAX_ENVIRONMENT_VARIABLES, MAX_VARIABLE_LENGTH);
  const scenarioCount = parsed.data.scenario_count ?? parsed.data.scenarios.length;
  const variableCount = parsed.data.variable_count ?? rawVariables.length;

  return environmentSetSummarySchema.parse({
    schema_version: ENVIRONMENT_SET_SCHEMA_VERSION,
    id: parsed.data.id,
    label: parsed.data.label,
    source: parsed.data.source,
    variables,
    variable_count: variableCount,
    scenarios,
    scenario_count: scenarioCount,
    baseline,
    extent: parsed.data.extent ?? null,
    crs: parsed.data.crs ?? (parsed.data.extent ? WGS84_CRS : null),
    warnings: boundedStringList(parsed.data.warnings, MAX_ENVIRONMENT_WARNINGS, MAX_LABEL_LENGTH),
  });
}

function boundedStringList(values: string[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const bounded: string[] = [];

  for (const value of values) {
    const normalized = truncate(value.trim(), maxLength);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    bounded.push(normalized);
    if (bounded.length >= maxItems) {
      break;
    }
  }

  return bounded;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength - 3) + "...";
}

function schemaErrorMessage(prefix: string, error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) {
    return prefix;
  }
  const path = first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
  return `${prefix}${path}: ${first.message}`;
}
