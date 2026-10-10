import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inputAssets } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { apiKeyScopeAllows } from "../services/auth-principal.js";
import {
  InputAssetRegistrationError,
  authorizeProjectInputWrite,
  registerInputAssetFromServerPath,
  resolveInputAssetUploadRoot,
  resolveInputAsset,
  updateInputAssetState,
} from "../services/input-assets.js";
import { writeTargetGroupUpload } from "../services/target-group-upload-writer.js";

export const targetGroupRoutes = new Hono<AppEnv>();

targetGroupRoutes.use("*", authMiddleware);

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
  // A project-scoped API key may only write inside its bound project.
  if (!apiKeyScopeAllows(user, scope.projectId)) {
    return c.json({ error: "API key is not valid for this project" }, 403);
  }
  const projectId = scope.projectId;
  if (scope.scope === "project" && projectId !== null) {
    // Current-principal membership is checked BEFORE the shared-storage write.
    // The registration path rechecks it immediately before the insert; this
    // pre-check is what keeps a viewer or a removed member from ever creating
    // the file, and what makes the denial a typed 4xx instead of a post-write
    // cleanup.  An unanswerable lookup fails closed.
    const authorization = await authorizeProjectInputWrite({
      principal: { id: user.id, role: user.role },
      projectId,
    });
    if (!authorization.allowed) {
      if (authorization.reason === "not_authorized") {
        return c.json({ error: "Project membership does not permit target-group upload" }, 403);
      }
      if (authorization.reason === "invalid_request") {
        return c.json({ error: "Invalid projectId" }, 400);
      }
      return c.json({ error: "Target-group upload authorization is unavailable" }, 502);
    }
  }

  const uploadRoot = await resolveInputAssetUploadRoot();
  if (!uploadRoot) return c.json({ error: "Configured target-group upload root is invalid" }, 502);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outputName = Date.now() + "_" + randomUUID() + "_target_group_" + safeName;
  try {
    return await writeTargetGroupUpload(uploadRoot, outputName, Buffer.from(await file.arrayBuffer()), async (outputPath, contentSha256) => {
      const asset = await registerInputAssetFromServerPath({
        creatorUserId: user.id, scope: scope.scope, projectId: scope.projectId, kind: "target_group", absolutePath: outputPath, contentSha256,
      });
      return c.json({ targetGroupAssetId: asset.id });
    });
  } catch (error) {
    // The descriptor-anchored writer closes handles on failure but retains
    // unregistered bytes; pathname cleanup could delete a raced replacement.
    // A project-membership denial is an authorization decision by this
    // service, not an upstream producer failure.  Report it as a typed 403
    // with a message that does not disclose whether the project exists.
    if (error instanceof InputAssetRegistrationError && error.reason === "not_authorized") {
      return c.json({ error: "Project membership does not permit target-group upload" }, 403);
    }
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