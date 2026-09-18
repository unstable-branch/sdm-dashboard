import { basename } from "node:path";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { inputAssets } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import {
  InputAssetRegistrationError,
  registerInputAssetFromServerPath,
  resolveInputAsset,
  updateInputAssetState,
} from "../services/input-assets.js";
import { plumberClient } from "../services/plumber.js";

export const boundaryRoutes = new Hono<AppEnv>();

boundaryRoutes.use("*", authMiddleware);

function assetError(reason: string): { error: string } {
  return { error: reason === "unavailable" ? "Boundary asset service unavailable" : "Boundary not found" };
}

async function resolveBoundary(user: { id: string; role: string }, assetId: string, action: "read" | "use" = "read") {
  return resolveInputAsset({
    assetId,
    principal: { id: user.id, role: user.role },
    action,
    expectedKind: "custom_boundary",
  });
}

boundaryRoutes.get("/boundary/default", async (c) => {
  try {
    const user = c.get("user");
    const resolution = c.req.query("resolution");
    const type = c.req.query("type");
    const country = c.req.query("country");
    const assetId = c.req.query("asset_id") || c.req.query("assetId");
    if (c.req.query("file_path")) return c.json({ error: "Path-based boundary access is not supported" }, 400);

    const body: Record<string, unknown> = {};
    if (type === "custom") {
      if (!assetId) return c.json({ error: "Boundary asset ID required" }, 400);
      const resolved = await resolveBoundary(user, assetId, "read");
      if (!resolved.ok) return c.json(assetError(resolved.reason), resolved.reason === "unavailable" ? 503 : 404);
      body.type = "custom";
      body.file_path = resolved.absolutePath;
    } else {
      if (assetId) return c.json({ error: "Boundary asset ID is only valid for custom boundaries" }, 400);
      if (resolution) body.resolution = resolution;
      if (type) body.type = type;
      if (country) body.country = country;
    }
    const result = await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/default", body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch boundary";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.post("/boundary/upload", async (c) => {
  let producerPath: string | null = null;
  let registeredAssetId: string | null = null;
  try {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

    const result = await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/upload", {
      file_name: file.name,
      file_content: Buffer.from(await file.arrayBuffer()).toString("base64"),
    }) as Record<string, unknown>;
    producerPath = typeof result.file_path === "string" ? result.file_path : null;
    if (!producerPath) throw new InputAssetRegistrationError("Boundary producer did not return a file");

    const asset = await registerInputAssetFromServerPath({
      creatorUserId: user.id,
      scope: "private",
      kind: "custom_boundary",
      absolutePath: producerPath,
    });
    registeredAssetId = asset.id;

    await logAction({
      userId: user.id,
      action: "boundary_uploaded",
      entity: "input_asset",
      entityId: asset.id,
      ...extractClientInfo(c),
      details: { fileName: file.name, fileSize: asset.contentSize },
    });

    return c.json({
      assetId: asset.id,
      asset_id: asset.id,
      file_name: file.name,
      file_size: asset.contentSize,
    });
  } catch (err) {
    if (registeredAssetId) await updateInputAssetState(registeredAssetId, "quarantined");
    if (producerPath) {
      const user = c.get("user");
      await plumberClient.withUser(user.id).withRole(user.role)
        .post("/api/v1/data/boundary/delete", { file_path: producerPath })
        .catch(() => undefined);
    }
    const message = err instanceof InputAssetRegistrationError ? "Boundary registration failed" : "Boundary upload failed";
    return c.json({ error: message }, err instanceof InputAssetRegistrationError ? 503 : 502);
  }
});

boundaryRoutes.get("/boundary/list", async (c) => {
  try {
    const user = c.get("user");
    const rows = await db.select().from(inputAssets).where(and(
      eq(inputAssets.creatorUserId, user.id),
      eq(inputAssets.scope, "private"),
      eq(inputAssets.kind, "custom_boundary"),
      eq(inputAssets.state, "ready"),
    ));
    const boundaries = (await Promise.all(rows.map(async (asset) => {
      const resolved = await resolveBoundary(user, asset.id, "read");
      if (!resolved.ok) return null;
      return {
        assetId: asset.id,
        asset_id: asset.id,
        file_name: basename(asset.storageLocator),
        file_size: asset.contentSize ?? 0,
        created_at: asset.createdAt.toISOString(),
      };
    }))).filter((value) => value !== null);
    return c.json({ boundaries });
  } catch {
    return c.json({ error: "Boundary asset service unavailable" }, 503);
  }
});

boundaryRoutes.delete("/boundary/delete/:id", async (c) => {
  try {
    const user = c.get("user");
    const assetId = decodeURIComponent(c.req.param("id"));
    const resolved = await resolveBoundary(user, assetId, "use");
    if (!resolved.ok) return c.json(assetError(resolved.reason), resolved.reason === "unavailable" ? 503 : 404);

    if (!(await updateInputAssetState(assetId, "quarantined"))) {
      return c.json({ error: "Boundary deletion could not be started" }, 503);
    }
    await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/delete", {
      file_path: resolved.absolutePath,
    });
    if (!(await updateInputAssetState(assetId, "deleted"))) {
      return c.json({ error: "Boundary deletion could not be finalized" }, 503);
    }

    await logAction({
      userId: user.id,
      action: "boundary_deleted",
      entity: "input_asset",
      entityId: assetId,
      ...extractClientInfo(c),
    });
    return c.json({ ok: true, assetId, asset_id: assetId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete boundary";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/countries", async (c) => {
  try {
    const user = c.get("user");
    return c.json(await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/countries", {}));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch countries" }, 502);
  }
});

boundaryRoutes.get("/boundary/extent", async (c) => {
  try {
    const user = c.get("user");
    if (c.req.query("file_path")) return c.json({ error: "Path-based boundary access is not supported" }, 400);
    const type = c.req.query("type");
    const assetId = c.req.query("asset_id") || c.req.query("assetId");
    const body: Record<string, unknown> = { buffer_deg: Number(c.req.query("buffer_deg") || "2") };
    if (type === "custom" || assetId) {
      if (type !== "custom" || !assetId) return c.json({ error: "Custom boundary asset ID required" }, 400);
      const resolved = await resolveBoundary(user, assetId, "use");
      if (!resolved.ok) return c.json(assetError(resolved.reason), resolved.reason === "unavailable" ? 503 : 404);
      body.type = "custom";
      body.file_path = resolved.absolutePath;
    } else {
      if (type) body.type = type;
      const resolution = c.req.query("resolution");
      const country = c.req.query("country");
      if (resolution) body.resolution = resolution;
      if (country) body.country = country;
    }
    return c.json(await plumberClient.withUser(user.id).withRole(user.role).post("/api/v1/data/boundary/extent", body));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to compute extent" }, 502);
  }
});

boundaryRoutes.post("/boundary/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const [status, data] = await plumberClient.withUser(user.id).withRole(user.role).postRaw("/api/v1/data/boundary/download", body);
    return c.json(data, status >= 400 ? (status as 400 | 404 | 500) : 200);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to download boundary" }, 502);
  }
});
