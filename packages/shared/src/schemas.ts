import { z } from "zod";

export const modelConfigSchema = z.object({
  species: z.string().min(1),
  modelId: z.string().min(1),
  biovars: z.array(z.number().int().min(1).max(19)).min(2),
  projectionExtent: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-90).max(90),
  ]).refine(([xmin, xmax, ymin, ymax]) => xmin < xmax && ymin < ymax, {
    message: "Invalid extent: xmin must be < xmax and ymin must be < ymax",
  }),
  backgroundN: z.number().int().min(500).max(100000).default(10000),
  cvFolds: z.number().int().min(0).max(10).default(3),
  cvStrategy: z.enum(["random", "spatial_blocks"]).default("random"),
  threshold: z.number().min(0.05).max(0.95).default(0.5),
  includeQuadratic: z.boolean().default(true),
  useElevation: z.boolean().default(false),
  useSoil: z.boolean().default(false),
  nCores: z.number().int().min(1).max(64).default(1),
  seed: z.number().int().default(42),
});

export const occurrenceUploadSchema = z.object({
  filename: z.string(),
  speciesFilter: z.string().optional(),
  maxCoordinateUncertainty: z.number().optional(),
});
