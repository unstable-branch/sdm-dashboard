import { Hono } from "hono";
import { readFileSync, existsSync, mkdirSync, copyFileSync, promises as fs } from "fs";
import { writeAtomicSync } from "../services/storage.js";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { plumberClient } from "../services/plumber.js";
import { optionalAuth, authMiddleware, type AppEnv } from "../middleware/auth.js";
import { InputAssetRegistrationError, registerInputAssetFromServerPath, resolveInputAsset, type InputAssetRow } from "../services/input-assets.js";
import { decryptToUploads } from "../services/upload-utils.js";
import type { PlumberUploadResponse } from "@sdm/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const EXAMPLES_DIR = join(PROJECT_ROOT, "data", "examples");
const SAVED_META_PATH = join(EXAMPLES_DIR, "saved_examples_meta.json");

async function removeProducerOutput(path: string | null | undefined): Promise<void> {
  if (!path || typeof path !== "string") return;
  const candidate = resolve(path);
  const root = resolve(join(PROJECT_ROOT, "data", "uploads"));
  if (candidate === root || !candidate.startsWith(root + "/")) return;
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    await fs.unlink(candidate);
  } catch { /* only a newly-created in-root producer output is passed */ }
}

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
  ownerUserId?: string;
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

function canReadSavedExample(meta: SavedExampleMeta, user: { id: string; role: string } | undefined): boolean {
  return Boolean(user && (meta.ownerUserId === user.id || user.role === "admin"));
}

function saveSavedMeta(meta: Record<string, SavedExampleMeta>): void {
  try {
    mkdirSync(EXAMPLES_DIR, { recursive: true });
    writeAtomicSync(SAVED_META_PATH, JSON.stringify(meta, null, 2));
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
  const user = c.get("user");
  for (const [name, meta] of Object.entries(savedMeta)) {
    if (!canReadSavedExample(meta, user)) continue;
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
  const user = c.get("user");
  for (const [, meta] of Object.entries(savedMeta)) {
    if (!canReadSavedExample(meta, user)) continue;
    const filePath = join(EXAMPLES_DIR, meta.fileName);
    if (existsSync(filePath)) {
      available.push(meta);
    }
  }
  return c.json({ examples: available });
});

examplesRoutes.post("/load", authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const name = (body.name as string) || (body.example as string) || "multi_species_test";

    // Built-in and saved examples are server-owned producers. The source
    // path is never accepted from the client and is not an asset identity.
    let srcPath = EXAMPLE_FILES[name];
    if (!srcPath || !existsSync(srcPath)) {
      const savedMeta = loadSavedMeta();
      const saved = savedMeta[name];
      const user = c.get("user");
      if (saved && canReadSavedExample(saved, user)) srcPath = join(EXAMPLES_DIR, saved.fileName);
    }
    if (!srcPath || !existsSync(srcPath)) {
      return c.json({ error: `Example '${name}' not found` }, 404);
    }

    const buffer = readFileSync(srcPath);
    const fileName = `${name}.csv`;
    const user = c.get("user");
    const plumberResponse: PlumberUploadResponse = await plumberClient.withUser(user.id).withRole(user.role).uploadOccurrence(buffer, fileName);
    const producerPath = typeof plumberResponse.file_id === "string" && plumberResponse.file_id.startsWith("/")
      ? plumberResponse.file_id
      : typeof plumberResponse.file_path === "string" && plumberResponse.file_path.startsWith("/")
        ? plumberResponse.file_path
        : null;
    if (!producerPath) return c.json({ error: "Example producer returned no registered output" }, 502);

    let rawAsset: InputAssetRow;
    try {
      rawAsset = await registerInputAssetFromServerPath({
        creatorUserId: user.id,
        scope: "private",
        kind: "raw_occurrence",
        absolutePath: producerPath,
      });
    } catch (error) {
      await removeProducerOutput(producerPath);
      throw error;
    }

    const savedMeta = loadSavedMeta();
    const saved = savedMeta[name];
    const speciesNames = saved?.speciesNames || [];
    const publicResponse: Record<string, unknown> = { ...plumberResponse };
    delete publicResponse.file_id;
    delete publicResponse.file_path;
    return c.json({
      ...publicResponse,
      example_name: name,
      rawAssetId: rawAsset.id,
      raw_asset_id: rawAsset.id,
      file_id: rawAsset.id,
      species_names: speciesNames,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load example data";
    if (err instanceof InputAssetRegistrationError) return c.json({ error: message }, 503);
    return c.json({ error: message }, 502);
  }
});
examplesRoutes.post("/save", authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const rawAssetId = (body.rawAssetId || body.raw_asset_id) as string | undefined;
    const cleanedAssetId = (body.cleanedAssetId || body.cleaned_asset_id) as string | undefined;
    if (typeof body.file_id === "string" || typeof body.file_path === "string" || typeof body.cleaned_file_id === "string" || typeof body.cleaned_file_path === "string") {
      return c.json({ error: "Path-based example saving is no longer supported; use rawAssetId and cleanedAssetId." }, 400);
    }
    if (!rawAssetId) return c.json({ error: "rawAssetId is required" }, 400);
    const user = c.get("user");
    const raw = await resolveInputAsset({ assetId: rawAssetId, principal: { id: user.id, role: user.role }, action: "read", expectedKind: "raw_occurrence" });
    if (!raw.ok) return c.json({ error: raw.reason === "unavailable" ? "Asset service unavailable" : "Raw asset not found" }, raw.reason === "unavailable" ? 503 : 404);
    let sourcePath = raw.absolutePath;
    if (cleanedAssetId) {
      const cleaned = await resolveInputAsset({ assetId: cleanedAssetId, principal: { id: user.id, role: user.role }, action: "read", expectedKind: "cleaned_occurrence", expectedParentAssetId: rawAssetId });
      if (!cleaned.ok) return c.json({ error: cleaned.reason === "unavailable" ? "Asset service unavailable" : "Cleaned asset not found" }, cleaned.reason === "unavailable" ? 503 : 404);
      sourcePath = cleaned.absolutePath;
      if (sourcePath.endsWith(".enc")) {
        const plaintextPath = decryptToUploads(sourcePath);
        if (!plaintextPath) return c.json({ error: "Cleaned asset content is unavailable" }, 503);
        sourcePath = plaintextPath;
      }
    }

    // Build a saved name
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savedName = `saved_${sourcePath.split("/").pop()?.replace(/\.csv(?:\.enc)?$/i, "") || "occurrences"}_${timestamp}`;
    const savedFileName = `${savedName}.csv`;
    const destPath = join(EXAMPLES_DIR, savedFileName);

    mkdirSync(EXAMPLES_DIR, { recursive: true });
    copyFileSync(sourcePath, destPath);

    const meta = body.metadata as Record<string, unknown> | undefined;
    const speciesNames = (meta?.species_names as string[]) || [];
    const nSpecies = (meta?.n_species as number) || (speciesNames.length) || 1;
    const nRecords = (meta?.n_records as number) || 0;
    const nErrors = (meta?.n_errors as number) || 0;
    const validRecords = (meta?.valid_records as number) || nRecords;
    const originalRows = (meta?.original_rows as number) || nRecords;
    const isSavedCleaned = Boolean(cleanedAssetId);

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
      ownerUserId: user.id,
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
