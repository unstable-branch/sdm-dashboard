import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import { db } from "../db/index.js";
import { inputAssets, projectMembers } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import {
  InputAssetRegistrationError,
  registerInputAssetFromServerPath,
  resolveInputAsset,
  updateInputAssetState,
} from "../services/input-assets.js";

export const boundaryRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_ALIASES = [
  "file_path",
  "filePath",
  "path",
  "maskFile",
  "mask_file",
  "boundaryFile",
  "boundary_file",
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

async function canCreateProjectBoundary(userId: string, projectId: string | null): Promise<boolean> {
  if (projectId === null) return true;
  try {
    const [membership] = await db.select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return membership?.role === "editor" || membership?.role === "admin";
  } catch {
    return false;
  }
}

async function resolveBoundaryForRead(user: { id: string; role: string }, assetId: string, destinationProjectId: string | null = null) {
  return resolveInputAsset({
    assetId,
    principal: { id: user.id, role: user.role },
    action: "read",
    expectedKind: "custom_boundary",
    destinationProjectId,
  });
}

boundaryRoutes.use("*", authMiddleware);

boundaryRoutes.get("/boundary/default", async (c) => {
  try {
    const user = c.get("user");
    if (PATH_ALIASES.some((key) => c.req.query(key) !== undefined)) {
      return c.json({ error: "Path-based boundary inputs are not supported; use boundaryAssetId." }, 400);
    }
    const resolution = c.req.query("resolution");
    const type = c.req.query("type");
    const country = c.req.query("country");
    const boundaryAssetId = c.req.query("boundaryAssetId") || c.req.query("boundary_asset_id");
    const projectId = c.req.query("projectId") || null;
    if (projectId !== null && !isAssetId(projectId)) return c.json({ error: "Invalid projectId" }, 400);
    const body: Record<string, unknown> = {};
    if (resolution) body.resolution = resolution;
    if (type === "custom") {
      if (!boundaryAssetId || country) {
        return c.json({ error: "Custom boundaries require boundaryAssetId; path aliases are not supported." }, 400);
      }
      if (!isAssetId(boundaryAssetId)) return c.json({ error: "Invalid boundaryAssetId" }, 400);
      const resolved = await resolveBoundaryForRead(user, boundaryAssetId, projectId);
      if (!resolved.ok) return c.json({ error: "Boundary not found" }, 404);
      body.type = "custom";
      body.file_path = resolved.absolutePath;
    } else {
      if (type) body.type = type;
      if (country) body.country = country;
    }
    const res = await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/default", body);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch boundary";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.post("/boundary/upload", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.parseBody();
    if (hasPathAlias(body as Record<string, unknown>)) {
      return c.json({ error: "Path-based boundary inputs are not supported; use boundaryAssetId." }, 400);
    }
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    const scope = uploadScope(body.projectId);
    if (!scope) return c.json({ error: "Invalid projectId" }, 400);
    if (!(await canCreateProjectBoundary(user.id, scope.projectId))) {
      return c.json({ error: "Project membership does not permit boundary upload" }, 403);
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const res = await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/upload", {
      file_name: file.name,
      file_content: base64,
    });
    const producedPath = (res as Record<string, unknown>)?.file_path;
    if (typeof producedPath !== "string" || !producedPath.startsWith("/")) {
      return c.json({ error: "Boundary producer did not return a server-owned file" }, 502);
    }

    let asset;
    try {
      asset = await registerInputAssetFromServerPath({
        creatorUserId: user.id,
        scope: scope.scope,
        projectId: scope.projectId,
        kind: "custom_boundary",
        absolutePath: producedPath,
      });
    } catch (error) {
      const message = error instanceof InputAssetRegistrationError ? error.message : "Boundary registration failed";
      return c.json({ error: message }, 502);
    }

    const client = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: "boundary_uploaded",
      entity: "input_asset",
      entityId: asset.id,
      ...client,
      details: { fileName: file.name, fileSize: file.size, scope: scope.scope, projectId: scope.projectId },
    });

    return c.json({ boundaryAssetId: asset.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Boundary upload failed";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/list", async (c) => {
  try {
    const user = c.get("user");
    const projectId = c.req.query("projectId") || null;
    if (projectId !== null && !isAssetId(projectId)) return c.json({ error: "Invalid projectId" }, 400);
    const rows = await db.select().from(inputAssets).where(eq(inputAssets.kind, "custom_boundary"));
    const boundaries = [];
    for (const row of rows) {
      if (projectId !== null) {
        if (row.scope !== "project" || row.projectId !== projectId) continue;
      } else if (row.scope !== "private" || row.creatorUserId !== user.id) {
        continue;
      }
      const resolved = await resolveInputAsset({
        assetId: row.id,
        principal: { id: user.id, role: user.role },
        action: "read",
        expectedKind: "custom_boundary",
        destinationProjectId: projectId,
      });
      if (!resolved.ok) continue;
      boundaries.push({
        boundaryAssetId: row.id,
        contentSize: row.contentSize,
        createdAt: row.createdAt,
      });
    }
    return c.json({ boundaries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list boundaries";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.post("/boundary/delete/:id", async (c) => {
  try {
    const user = c.get("user");
    const boundaryAssetId = c.req.param("id");
    if (!isAssetId(boundaryAssetId)) return c.json({ error: "Invalid boundaryAssetId" }, 400);
    const resolved = await resolveInputAsset({
      assetId: boundaryAssetId,
      principal: { id: user.id, role: user.role },
      action: "use",
      expectedKind: "custom_boundary",
    });
    if (!resolved.ok) return c.json({ error: "Boundary not found" }, 404);
    if (!(await updateInputAssetState(boundaryAssetId, "deleted"))) {
      return c.json({ error: "Boundary deletion failed" }, 502);
    }

    const client = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: "boundary_deleted",
      entity: "input_asset",
      entityId: boundaryAssetId,
      ...client,
    });
    return c.json({ boundaryAssetId, state: "deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete boundary";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/countries", async (c) => {
  try {
    const user = c.get("user");
    const res = await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/countries", {});
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch countries";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/extent", async (c) => {
  try {
    const user = c.get("user");
    if (PATH_ALIASES.some((key) => c.req.query(key) !== undefined)) {
      return c.json({ error: "Path-based boundary inputs are not supported; use boundaryAssetId." }, 400);
    }
    const boundaryAssetId = c.req.query("boundaryAssetId") || c.req.query("boundary_asset_id");
    const type = c.req.query("type");
    const resolution = c.req.query("resolution");
    const country = c.req.query("country");
    const bufferDeg = c.req.query("buffer_deg") || "2";
    const projectId = c.req.query("projectId") || null;
    if (projectId !== null && !isAssetId(projectId)) return c.json({ error: "Invalid projectId" }, 400);
    if (type === "custom" && (!boundaryAssetId || country)) {
      return c.json({ error: "Custom boundaries require boundaryAssetId; path aliases are not supported." }, 400);
    }
    const body: Record<string, unknown> = { buffer_deg: Number(bufferDeg) };
    if (boundaryAssetId) {
      if (!isAssetId(boundaryAssetId)) return c.json({ error: "Invalid boundaryAssetId" }, 400);
      const resolved = await resolveBoundaryForRead(user, boundaryAssetId, projectId);
      if (!resolved.ok) return c.json({ error: "Boundary not found" }, 404);
      body.file_path = resolved.absolutePath;
    }
    if (type) body.type = type;
    if (resolution) body.resolution = resolution;
    if (country) body.country = country;
    const res = await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/extent", body);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute extent";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.post("/boundary/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json() as Record<string, unknown>;
    if (hasPathAlias(body as Record<string, unknown>)) {
      return c.json({ error: "Path-based boundary inputs are not supported; use boundaryAssetId." }, 400);
    }
    const scope = uploadScope(body.projectId);
    if (!scope) return c.json({ error: "Invalid projectId" }, 400);
    if (!(await canCreateProjectBoundary(user.id, scope.projectId))) {
      return c.json({ error: "Project membership does not permit boundary download" }, 403);
    }
    const producerBody = {
      type: body.type,
      resolution: body.resolution,
      country: body.country,
    };
    const [status, data] = await plumberClient.withUser(user.id).withRole(user.role).postRaw("/api/v1/data/boundary/download", producerBody);
    if (status >= 400) return c.json(data, status as 400 | 404 | 500);
    const producedPath = (data as Record<string, unknown>)?.file && typeof (data as Record<string, unknown>).file === "object"
      ? ((data as Record<string, unknown>).file as Record<string, unknown>).file_path
      : undefined;
    if ((data as Record<string, unknown>)?.status !== "success" || typeof producedPath !== "string" || !producedPath.startsWith("/")) {
      return c.json({ error: "Boundary producer did not return a completed server-owned file" }, 502);
    }
    let asset;
    try {
      asset = await registerInputAssetFromServerPath({
        creatorUserId: user.id,
        scope: scope.scope,
        projectId: scope.projectId,
        kind: "custom_boundary",
        absolutePath: producedPath,
      });
    } catch (error) {
      const message = error instanceof InputAssetRegistrationError ? error.message : "Boundary registration failed";
      return c.json({ error: message }, 502);
    }
    const client = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: "boundary_downloaded",
      entity: "input_asset",
      entityId: asset.id,
      ...client,
      details: { scope: scope.scope, projectId: scope.projectId },
    });
    return c.json({
      status: (data as Record<string, unknown>).status,
      message: (data as Record<string, unknown>).message,
      boundaryAssetId: asset.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download boundary";
    return c.json({ error: message }, 502);
  }
});
