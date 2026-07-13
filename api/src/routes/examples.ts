import { Hono } from "hono";
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { plumberClient } from "../services/plumber.js";
import { optionalAuth, authMiddleware, type AppEnv } from "../middleware/auth.js";
import type { PlumberUploadResponse } from "@sdm/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const EXAMPLES_DIR = join(PROJECT_ROOT, "data", "examples");
const SAVED_META_PATH = join(EXAMPLES_DIR, "saved_examples_meta.json");

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

interface SavedExampleMeta {
  name: string;
  fileName: string;
  species: number;
  totalRecords: number;
  cleanRecords: number;
  dirtyRecords: number;
  description: string;
  isMultiSpecies: boolean;
  hasCoordinateCleanerTests: boolean;
  speciesNames?: string[];
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

function loadSavedMeta(): Record<string, SavedExampleMeta> {
  try {
    if (existsSync(SAVED_META_PATH)) {
      return JSON.parse(readFileSync(SAVED_META_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function saveSavedMeta(meta: Record<string, SavedExampleMeta>): void {
  try {
    mkdirSync(EXAMPLES_DIR, { recursive: true });
    writeFileSync(SAVED_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
  } catch {}
}

export const examplesRoutes = new Hono<AppEnv>();

examplesRoutes.use("*", optionalAuth);

examplesRoutes.get("/list", async (c) => {
  const available: Record<string, string> = {};
  for (const [name, path] of Object.entries(EXAMPLE_FILES)) {
    if (existsSync(path)) {
      available[name] = path;
    }
  }
  const savedMeta = loadSavedMeta();
  for (const [name, meta] of Object.entries(savedMeta)) {
    const filePath = join(EXAMPLES_DIR, meta.fileName);
    if (existsSync(filePath)) {
      available[name] = filePath;
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
  const savedMeta = loadSavedMeta();
  for (const [, meta] of Object.entries(savedMeta)) {
    const filePath = join(EXAMPLES_DIR, meta.fileName);
    if (existsSync(filePath)) {
      available.push(meta);
    }
  }
  return c.json({ examples: available });
});

examplesRoutes.post("/load", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const name = (body.name as string) || (body.example as string) || "multi_species_test";

    // Check built-in examples first
    let srcPath = EXAMPLE_FILES[name];

    // Then check saved examples
    if (!srcPath || !existsSync(srcPath)) {
      const savedMeta = loadSavedMeta();
      const saved = savedMeta[name];
      if (saved) {
        srcPath = join(EXAMPLES_DIR, saved.fileName);
      }
    }

    if (!srcPath || !existsSync(srcPath)) {
      return c.json({ error: `Example '${name}' not found` }, 404);
    }

    const buffer = readFileSync(srcPath);
    const fileName = `${name}.csv`;

    const plumberResponse: PlumberUploadResponse = await plumberClient.uploadOccurrence(
      buffer,
      fileName,
    );

    // For saved examples, include species_names from metadata
    const savedMeta = loadSavedMeta();
    const saved = savedMeta[name];
    const speciesNames = saved?.speciesNames || [];

    return c.json({
      ...plumberResponse,
      example_name: name,
      file_path: srcPath,
      species_names: speciesNames,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load example data";
    return c.json({ error: message }, 502);
  }
});

examplesRoutes.post("/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const fileId = body.file_id as string | undefined;
    const cleanedFileId = body.cleaned_file_id as string | undefined;
    const useCleaned = cleanedFileId || fileId;
    if (!useCleaned) {
      return c.json({ error: "file_id or cleaned_file_id is required" }, 400);
    }

    // The generated file is in data/uploads/ — look for it
    const uploadsDir = join(PROJECT_ROOT, "data", "uploads");
    let srcPath = join(uploadsDir, useCleaned);
    if (!existsSync(srcPath)) {
      return c.json({ error: `File not found: ${useCleaned}` }, 404);
    }

    // Build a saved name
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savedName = `saved_${useCleaned.replace(/\.csv$/i, "")}_${timestamp}`;
    const savedFileName = `${savedName}.csv`;
    const destPath = join(EXAMPLES_DIR, savedFileName);

    mkdirSync(EXAMPLES_DIR, { recursive: true });
    copyFileSync(srcPath, destPath);

    const meta = body.metadata as Record<string, unknown> | undefined;
    const speciesNames = (meta?.species_names as string[]) || [];
    const nSpecies = (meta?.n_species as number) || (speciesNames.length) || 1;
    const nRecords = (meta?.n_records as number) || 0;
    const nErrors = (meta?.n_errors as number) || 0;
    const validRecords = (meta?.valid_records as number) || nRecords;
    const originalRows = (meta?.original_rows as number) || nRecords;
    const isSavedCleaned = !!cleanedFileId;

    const exampleMeta: SavedExampleMeta = {
      name: savedName,
      fileName: savedFileName,
      species: nSpecies,
      totalRecords: isSavedCleaned ? originalRows : nRecords,
      cleanRecords: isSavedCleaned ? validRecords : nRecords,
      dirtyRecords: isSavedCleaned ? (originalRows - validRecords) : nErrors,
      description: (meta?.description as string) || `Saved synthetic data (${nSpecies} species, ${nRecords} records)`,
      isMultiSpecies: nSpecies > 1 || speciesNames.length > 1,
      hasCoordinateCleanerTests: (!isSavedCleaned && nErrors > 0) || (isSavedCleaned && originalRows > validRecords),
      speciesNames,
    };

    const allMeta = loadSavedMeta();
    allMeta[savedName] = exampleMeta;
    saveSavedMeta(allMeta);

    return c.json({
      file_name: savedFileName,
      path: destPath,
      ...exampleMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save example";
    return c.json({ error: message }, 500);
  }
});
