import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { isAbsolute, join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { plumberClient } from "../services/plumber.js";
import { optionalAuth, type AppEnv } from "../middleware/auth.js";
import type { PlumberUploadResponse } from "@sdm/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const EXAMPLES_DIR = join(PROJECT_ROOT, "data", "examples");

const EXAMPLE_FILES: Record<string, string> = {
  multi_species_test: join(EXAMPLES_DIR, "multi_species_test.csv"),
  synthetic_presence_data: join(EXAMPLES_DIR, "synthetic_presence_data.csv"),
  batch_config_test: join(EXAMPLES_DIR, "batch_config_test.csv"),
};

interface ExampleInfo {
  name: string;
  fileName: string;
  species: number;
  totalRecords: number;
  cleanRecords: number;
  dirtyRecords: number;
  description: string;
  isMultiSpecies: boolean;
  hasCoordinateCleanerTests: boolean;
}

const EXAMPLE_METADATA: Record<string, ExampleInfo> = {
  multi_species_test: {
    name: "multi_species_test",
    fileName: "multi_species_test.csv",
    species: 3,
    totalRecords: 3063,
    cleanRecords: 3000,
    dirtyRecords: 63,
    description: "3 synthetic species (~1000 records each) with NA coords, sea, capital, institution, and zero-coordinate tests. Use for testing multi-species cleaning and modelling.",
    isMultiSpecies: true,
    hasCoordinateCleanerTests: true,
  },
  synthetic_presence_data: {
    name: "synthetic_presence_data",
    fileName: "synthetic_presence_data.csv",
    species: 1,
    totalRecords: 3063,
    cleanRecords: 3000,
    dirtyRecords: 63,
    description: "1 species with 3 geographic populations (North, East, West) with NA coords, sea, capital, institution, and zero-coordinate tests. Use for testing source-based cleaning and population modelling.",
    isMultiSpecies: false,
    hasCoordinateCleanerTests: true,
  },
  batch_config_test: {
    name: "batch_config_test",
    fileName: "batch_config_test.csv",
    species: 0,
    totalRecords: 0,
    cleanRecords: 0,
    dirtyRecords: 0,
    description: "Batch configuration CSV. References multi_species_test.csv for batch/targets pipeline testing.",
    isMultiSpecies: false,
    hasCoordinateCleanerTests: false,
  },
};

export const examplesRoutes = new Hono<AppEnv>();

examplesRoutes.use("*", optionalAuth);

examplesRoutes.get("/list", async (c) => {
  const available: Record<string, string> = {};
  for (const [name, path] of Object.entries(EXAMPLE_FILES)) {
    if (existsSync(path)) {
      available[name] = path;
    }
  }
  return c.json({ examples: available });
});

examplesRoutes.get("/details", async (c) => {
  const available: ExampleInfo[] = [];
  for (const [name, path] of Object.entries(EXAMPLE_FILES)) {
    if (existsSync(path) && EXAMPLE_METADATA[name]) {
      available.push(EXAMPLE_METADATA[name]);
    }
  }
  return c.json({ examples: available });
});

examplesRoutes.post("/load", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const name = (body.name as string) || (body.example as string) || "multi_species_test";

    const srcPath = EXAMPLE_FILES[name];
    if (!srcPath || !existsSync(srcPath)) {
      return c.json({ error: `Example '${name}' not found` }, 404);
    }

    const buffer = readFileSync(srcPath);
    const fileName = `${name}.csv`;

    // Forward to Plumber's upload endpoint to get metadata and store remotely
    const plumberResponse: PlumberUploadResponse = await plumberClient.uploadOccurrence(
      buffer,
      fileName,
    );

    return c.json({
      ...plumberResponse,
      example_name: name,
      file_path: srcPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load example data";
    return c.json({ error: message }, 502);
  }
});
