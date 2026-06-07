import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { isAbsolute, join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { plumberClient } from "../services/plumber.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import type { PlumberUploadResponse } from "@sdm/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const EXAMPLES_DIR = join(PROJECT_ROOT, "data", "examples");

const EXAMPLE_FILES: Record<string, string> = {
  multi_species_test: join(EXAMPLES_DIR, "multi_species_test.csv"),
  batch_config_test: join(EXAMPLES_DIR, "batch_config_test.csv"),
};

export const examplesRoutes = new Hono<AppEnv>();

examplesRoutes.use("*", authMiddleware);

examplesRoutes.get("/list", async (c) => {
  const available: Record<string, string> = {};
  for (const [name, path] of Object.entries(EXAMPLE_FILES)) {
    if (existsSync(path)) {
      available[name] = path;
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
