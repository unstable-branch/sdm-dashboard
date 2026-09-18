import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { inputAssets, projectMembers, projects, users } from "../db/schema.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { ensureDefaultProject, isUuid } from "../services/access.js";
import {
  InputAssetRegistrationError,
  registerInputAssetFromServerPath,
  resolveInputAsset,
  updateInputAssetState,
} from "../services/input-assets.js";

const MAX_TARGET_GROUP_BYTES = 100 * 1024 * 1024;
const PROJECT_ROOT = resolve(process.env.SDM_PROJECT_ROOT || join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const TARGET_GROUP_ROOT = resolve(
  process.env.SDM_INPUT_ASSET_TARGET_GROUP_ROOT || join(PROJECT_ROOT, "data", "uploads", "target-groups"),
);

class TargetGroupValidationError extends Error {}
class TargetGroupAuthorizationError extends Error {}
class TargetGroupQuotaError extends Error {}

function validateTargetGroupTable(buffer: Buffer): void {
  const firstLines = buffer.toString("utf8", 0, Math.min(buffer.length, 64 * 1024)).split(/\r?\n/);
  const header = firstLines.find((line) => line.trim().length > 0);
  const hasData = firstLines.slice((header ? firstLines.indexOf(header) : -1) + 1).some((line) => line.trim().length > 0);
  if (!header || !hasData) throw new TargetGroupValidationError("Target-group table is empty");
  const delimiter = header.includes("\t") && !header.includes(",") ? "\t" : ",";
  const columns = header.split(delimiter).map((name) => name.replace(/^\uFEFF/, "").replace(/^['\"]|['\"]$/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase());
  const hasLongitude = columns.some((name) => ["longitude", "lon", "x", "decimallongitude"].includes(name));
  const hasLatitude = columns.some((name) => ["latitude", "lat", "y", "decimallatitude"].includes(name));
  if (!hasLongitude || !hasLatitude) {
    throw new TargetGroupValidationError("Target-group table must contain longitude and latitude columns");
  }
}

export const targetGroupRoutes = new Hono<AppEnv>();

targetGroupRoutes.use("*", authMiddleware);

type ProjectMembershipRole = "admin" | "editor" | "viewer";

// Model execution currently has no project selector and uses this same helper.
// Keep target-group resources in that one explicit default-project context.
async function destinationProject(
  user: { id: string; email: string; role: string },
  requireUse: boolean,
): Promise<{ projectId: string; membershipRole: ProjectMembershipRole }> {
  const projectId = await ensureDefaultProject(user);
  const [membership] = await db.select({ role: projectMembers.role }).from(projectMembers).where(and(
    eq(projectMembers.projectId, projectId),
    eq(projectMembers.userId, user.id),
  )).limit(1);
  if (!membership || (requireUse && membership.role === "viewer")) {
    throw new TargetGroupAuthorizationError("Target-group project access denied");
  }
  return { projectId, membershipRole: membership.role };
}

async function removeTargetGroupFile(path: string): Promise<void> {
  const candidate = resolve(path);
  if (candidate === TARGET_GROUP_ROOT || !candidate.startsWith(TARGET_GROUP_ROOT + sep)) {
    throw new InputAssetRegistrationError("Target-group storage is unsafe");
  }
  await unlink(candidate);
}

async function removeTargetGroupFileIfPresent(path: string): Promise<void> {
  try {
    await removeTargetGroupFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function targetGroupPathFromLocator(locator: string): string | null {
  const prefix = "target_groups/";
  if (typeof locator !== "string" || !locator.startsWith(prefix)) return null;
  const relativePath = locator.slice(prefix.length);
  if (!relativePath || relativePath.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const candidate = resolve(TARGET_GROUP_ROOT, relativePath);
  return candidate.startsWith(TARGET_GROUP_ROOT + sep) ? candidate : null;
}

async function reserveTargetGroupQuota(userId: string, bytes: number): Promise<void> {
  const [reserved] = await db.update(users).set({
    storageUsedBytes: sql`${users.storageUsedBytes} + ${bytes}`,
  }).where(and(
    eq(users.id, userId),
    sql`${users.storageUsedBytes} + ${bytes} <= ${users.storageQuotaBytes}`,
  )).returning({ id: users.id });
  if (!reserved) throw new TargetGroupQuotaError("Storage quota exceeded");
}

async function finalizeTargetGroupDeletion(assetId: string, creatorUserId: string, bytes: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [deleted] = await tx.update(inputAssets).set({
      state: "deleted",
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(inputAssets.id, assetId), eq(inputAssets.state, "quarantined")))
      .returning({ id: inputAssets.id });
    if (!deleted) throw new Error("Target-group deletion state changed");

    const [accounted] = await tx.update(users).set({
      storageUsedBytes: sql`GREATEST(0, ${users.storageUsedBytes} - ${bytes})`,
    }).where(eq(users.id, creatorUserId)).returning({ id: users.id });
    if (!accounted) throw new Error("Target-group creator accounting is unavailable");
  });
}

targetGroupRoutes.post("/target-groups/upload", async (c) => {
  let path: string | null = null;
  let temporaryPath: string | null = null;
  let assetId: string | null = null;
  try {
    const user = c.get("user");
    const body = await c.req.parseBody();
    if (body.projectId !== undefined || body.project_id !== undefined) {
      return c.json({ error: "Target-group project selection is not supported in the model flow" }, 400);
    }
    const { projectId } = await destinationProject(user, true);
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "No target-group CSV uploaded" }, 400);
    if (file.size > MAX_TARGET_GROUP_BYTES) return c.json({ error: "Target-group file is too large" }, 413);
    const extension = extname(file.name).toLowerCase();
    if (![".csv", ".tsv", ".txt"].includes(extension)) {
      return c.json({ error: "Target-group input must be CSV, TSV, or TXT" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    validateTargetGroupTable(buffer);
    await mkdir(TARGET_GROUP_ROOT, { recursive: true });
    const safeName = basename(file.name, extension).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "target-group";
    path = join(TARGET_GROUP_ROOT, `${randomUUID()}-${safeName}${extension}`);
    temporaryPath = `${path}.tmp.${process.pid}`;
    await writeFile(temporaryPath, buffer, { flag: "wx" });
    await rename(temporaryPath, path);
    temporaryPath = null;

    const asset = await registerInputAssetFromServerPath({
      creatorUserId: user.id,
      scope: "project",
      projectId,
      kind: "target_group",
      absolutePath: path,
    });
    assetId = asset.id;

    await reserveTargetGroupQuota(user.id, Number(asset.contentSize || 0));

    return c.json({
      targetGroupAssetId: asset.id,
      target_group_asset_id: asset.id,
      fileName: file.name,
      contentSize: asset.contentSize,
      projectId,
    });
  } catch (error) {
    if (assetId) await updateInputAssetState(assetId, "quarantined");
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
    if (path) await removeTargetGroupFile(path).catch(() => undefined);
    if (error instanceof TargetGroupValidationError) return c.json({ error: error.message }, 400);
    if (error instanceof TargetGroupAuthorizationError) return c.json({ error: "Target-group project access denied" }, 403);
    if (error instanceof TargetGroupQuotaError) return c.json({ error: "Storage quota exceeded" }, 413);
    return c.json({ error: "Target-group asset service unavailable" }, 503);
  }
});

targetGroupRoutes.get("/target-groups", async (c) => {
  try {
    if (c.req.query("projectId") !== undefined || c.req.query("project_id") !== undefined) {
      return c.json({ error: "Target-group project selection is not supported in the model flow" }, 400);
    }
    const user = c.get("user");
    const { projectId } = await destinationProject(user, false);
    const rows = await db.select().from(inputAssets).where(and(
      eq(inputAssets.projectId, projectId),
      eq(inputAssets.scope, "project"),
      eq(inputAssets.kind, "target_group"),
      eq(inputAssets.state, "ready"),
    ));
    const assets = (await Promise.all(rows.map(async (asset) => {
      const resolved = await resolveInputAsset({
        assetId: asset.id,
        principal: { id: user.id, role: user.role },
        action: "read",
        expectedKind: "target_group",
        destinationProjectId: projectId,
      });
      if (!resolved.ok) return null;
      return {
        targetGroupAssetId: asset.id,
        target_group_asset_id: asset.id,
        fileName: basename(asset.storageLocator).replace(/^[0-9a-f-]{36}-/i, ""),
        contentSize: asset.contentSize ?? 0,
        createdAt: asset.createdAt.toISOString(),
        projectId,
      };
    }))).filter((asset) => asset !== null);
    return c.json({ targetGroups: assets });
  } catch {
    return c.json({ error: "Target-group asset service unavailable" }, 503);
  }
});

targetGroupRoutes.delete("/target-groups/:assetId", async (c) => {
  try {
    if (c.req.query("projectId") !== undefined || c.req.query("project_id") !== undefined) {
      return c.json({ error: "Target-group project selection is not supported in the model flow" }, 400);
    }
    const user = c.get("user");
    const { projectId, membershipRole } = await destinationProject(user, false);
    const assetId = decodeURIComponent(c.req.param("assetId"));
    if (!isUuid(assetId)) return c.json({ error: "Target-group asset not found" }, 404);

    const [asset] = await db.select().from(inputAssets).where(eq(inputAssets.id, assetId)).limit(1);
    if (!asset || asset.scope !== "project" || asset.projectId !== projectId || asset.kind !== "target_group" ||
        !isUuid(asset.creatorUserId) || !["ready", "quarantined"].includes(asset.state)) {
      return c.json({ error: "Target-group asset not found" }, 404);
    }
    const [project] = await db.select({ ownerId: projects.ownerId }).from(projects)
      .where(eq(projects.id, projectId)).limit(1);
    const canManage = membershipRole === "admin" ||
      (project?.ownerId === user.id && membershipRole !== "viewer") ||
      (asset.creatorUserId === user.id && membershipRole === "editor");
    if (!canManage) return c.json({ error: "Target-group asset not found" }, 404);

    let deletionPath: string | null;
    if (asset.state === "ready") {
      const resolved = await resolveInputAsset({
        assetId,
        principal: { id: user.id, role: user.role },
        action: "use",
        expectedKind: "target_group",
        destinationProjectId: projectId,
      });
      if (!resolved.ok) {
        return c.json({ error: resolved.reason === "unavailable" ? "Target-group asset service unavailable" : "Target-group asset not found" }, resolved.reason === "unavailable" ? 503 : 404);
      }
      deletionPath = resolved.absolutePath;
      if (!(await updateInputAssetState(assetId, "quarantined"))) {
        return c.json({ error: "Target-group deletion could not be started" }, 503);
      }
    } else {
      deletionPath = targetGroupPathFromLocator(asset.storageLocator);
    }
    if (!deletionPath) return c.json({ error: "Target-group deletion is awaiting recovery" }, 503);
    await removeTargetGroupFileIfPresent(deletionPath);
    await finalizeTargetGroupDeletion(assetId, asset.creatorUserId, Number(asset.contentSize || 0));
    return c.json({ ok: true, targetGroupAssetId: assetId, target_group_asset_id: assetId });
  } catch (error) {
    if (error instanceof TargetGroupAuthorizationError) return c.json({ error: "Target-group project access denied" }, 403);
    return c.json({ error: "Target-group asset service unavailable" }, 503);
  }
});
