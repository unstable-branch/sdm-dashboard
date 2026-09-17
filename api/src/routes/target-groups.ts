import { Hono } from "hono";
import type { Context } from "hono";
import { mkdir, unlink } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inputAssets } from "../db/schema.js";
import type { AppEnv } from "../middleware/auth.js";
import {
  InputAssetRegistrationError,
  registerInputAssetFromServerPath,
  resolveInputAsset,
  updateInputAssetState,
} from "../services/input-assets.js";
import { writeAtomic } from "../services/storage.js";

export const targetGroupRoutes = new Hono<AppEnv>();

const __filename = fileURLToPath(import.meta.url);
const UPLOAD_DIR = join(resolve(dirname(__filename), "../../.."), "data", "uploads");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_ALIASES = [
  "file_path", "filePath", "path",
  "target_group_file", "targetGroupFile",
  "target_group_path", "targetGroupPath",
] as const;

function isAssetId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function hasPathAlias(body: Record<string, unknown>): boolean {
  return PATH_ALIASES.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function uploadScope(projectId: unknown): { scope: "private" | "project"; projectId: string | null } | null {
  if (projectId === undefined || projectId === null || projectId === "") return { scope: "private", projectId: null };
  if (!isAssetId(projectId)) return null;
  return { scope: "project", projectId };
}

async function resolveTargetGroupForRead(user: { id: string; role: string }, assetId: string) {
  return resolveInputAsset({ assetId, principal: { id: user.id, role: user.role }, action: "read", expectedKind: "target_group" });
}

async function handleUpload(c: Context<AppEnv>) {
  const user = c.get("user");
  const body = await c.req.parseBody();
  if (hasPathAlias(body as Record<string, unknown>)) {
    return c.json({ error: "Path-based target-group inputs are not supported; use targetGroupAssetId." }, 400);
  }
  const file = body["file"];
  if (!file || !(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);
  const scope = uploadScope(body.projectId);
  if (!scope) return c.json({ error: "Invalid projectId" }, 400);

  await mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outputPath = join(UPLOAD_DIR, Date.now() + "_" + randomUUID() + "_target_group_" + safeName);
  await writeAtomic(outputPath, Buffer.from(await file.arrayBuffer()));
  try {
    const asset = await registerInputAssetFromServerPath({
      creatorUserId: user.id, scope: scope.scope, projectId: scope.projectId, kind: "target_group", absolutePath: outputPath,
    });
    return c.json({ targetGroupAssetId: asset.id });
  } catch (error) {
    try { await unlink(outputPath); } catch { /* best-effort cleanup of this request file */ }
    const message = error instanceof InputAssetRegistrationError ? error.message : "Target-group registration failed";
    return c.json({ error: message }, 502);
  }
}

for (const prefix of ["/target-group", "/target-groups"] as const) {
  targetGroupRoutes.post(prefix + "/upload", handleUpload);
  targetGroupRoutes.get(prefix + "/list", async (c) => {
    try {
      const user = c.get("user");
      const rows = await db.select().from(inputAssets).where(eq(inputAssets.kind, "target_group"));
      const targetGroups = [];
      for (const row of rows) {
        const resolved = await resolveTargetGroupForRead(user, row.id);
        if (!resolved.ok) continue;
        targetGroups.push({ targetGroupAssetId: row.id, contentSize: row.contentSize, createdAt: row.createdAt });
      }
      return c.json({ targetGroups });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list target groups";
      return c.json({ error: message }, 502);
    }
  });
  targetGroupRoutes.post(prefix + "/delete/:id", async (c) => {
    try {
      const user = c.get("user");
      const targetGroupAssetId = c.req.param("id");
      if (!isAssetId(targetGroupAssetId)) return c.json({ error: "Invalid targetGroupAssetId" }, 400);
      const resolved = await resolveInputAsset({ assetId: targetGroupAssetId, principal: { id: user.id, role: user.role }, action: "use", expectedKind: "target_group" });
      if (!resolved.ok) return c.json({ error: "Target group not found" }, 404);
      if (!(await updateInputAssetState(targetGroupAssetId, "deleted"))) return c.json({ error: "Target-group deletion failed" }, 502);
      return c.json({ targetGroupAssetId, state: "deleted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete target group";
      return c.json({ error: message }, 502);
    }
  });
}