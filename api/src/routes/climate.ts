import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { climateRateLimit } from "../middleware/rate-limit.js";
import { longCache } from "../middleware/cache.js";
import { authMiddleware, optionalAuth } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import {
  InputAssetRegistrationError,
  registerSystemClimateCollectionFromServerPath,
  resolveInputAsset,
  updateInputAssetState,
} from "../services/input-assets.js";

export const climateRoutes = new Hono<AppEnv>();

type ClimateUser = { id: string; role: string };
type ClimateRecord = Record<string, unknown>;

// These values are request aliases, never an authority for a download. Reject
// them before forwarding a request to Plumber so a path cannot be resurrected
// by a future producer response or persisted job config.
const CLIMATE_PATH_ALIASES = new Set([
  "path", "filepath", "directory", "dir", "files",
  "manifestpath", "worldclimdir", "futureworldclimdir", "futureworldclimdir2",
]);

class ClimateManifestContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClimateManifestContractError";
  }
}

function containsClimatePathAlias(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    visited += 1;
    if (visited > 10_000) return true;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current as ClimateRecord)) {
      const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      if (CLIMATE_PATH_ALIASES.has(normalized)) return true;
      pending.push(child);
    }
  }
  return false;
}

function producerOwnerMatches(record: ClimateRecord, user: ClimateUser, requireOwner: boolean): boolean {
  const owner = record.owner_user_id ?? record.ownerUserId ?? record.user_id ?? record.userId;
  if (owner === undefined) return !requireOwner;
  return owner === user.id || user.role === "admin";
}

function trustedManifestPath(record: ClimateRecord, user: ClimateUser, requireOwner: boolean): string {
  if (!producerOwnerMatches(record, user, requireOwner)) {
    throw new ClimateManifestContractError("Climate producer response is not authorized for this user");
  }
  // `manifest_path` is an internal, server-produced response contract. No
  // client path, directory, or member list is accepted as a substitute.
  const manifestPath = record.manifest_path;
  if (typeof manifestPath !== "string" || !manifestPath.startsWith("/")) {
    throw new ClimateManifestContractError("Completed climate response lacks trusted manifest_path");
  }
  return manifestPath;
}

async function registerCompletedClimateCollection(record: ClimateRecord, user: ClimateUser, requireOwner: boolean): Promise<string> {
  const asset = await registerSystemClimateCollectionFromServerPath({
    creatorUserId: user.id,
    absolutePath: trustedManifestPath(record, user, requireOwner),
  });
  return asset.id;
}

function publicClimateStatus(record: ClimateRecord, climateCollectionId?: string): ClimateRecord {
  const result: ClimateRecord = {};
  for (const key of ["id", "type", "status", "started_at", "completed_at", "error", "error_category"]) {
    if (record[key] !== undefined && typeof record[key] !== "object") result[key] = record[key];
  }
  if (climateCollectionId) result.climateCollectionId = climateCollectionId;
  return result;
}

function publicClimateScenario(record: ClimateRecord, climateCollectionId: string): ClimateRecord {
  const result: ClimateRecord = { climateCollectionId };
  for (const key of ["id", "type", "source", "gcm", "ssp", "period", "resolution", "is_averaged", "file_count", "size_bytes"]) {
    if (record[key] !== undefined && (typeof record[key] === "string" || typeof record[key] === "boolean" || typeof record[key] === "number")) {
      result[key] = record[key];
    }
  }
  return result;
}

climateRoutes.use("*", climateRateLimit);
climateRoutes.use("/download", authMiddleware);
climateRoutes.use("/delete/*", authMiddleware);
climateRoutes.use("/status/*", authMiddleware);
climateRoutes.use("*", optionalAuth);

climateRoutes.get("/scenarios", authMiddleware, longCache, async (c) => {
  try {
    const user = c.get("user");
    const response = await plumberClient.withUser(user.id).withRole(user.role).getClimateScenarios();
    const scenarios: ClimateRecord[] = [];
    for (const scenario of response.scenarios || []) {
      if (!scenario || typeof scenario !== "object") continue;
      const record = scenario as ClimateRecord;
      if (record.status !== undefined && record.status !== "completed") continue;
      try {
        const climateCollectionId = await registerCompletedClimateCollection(record, user, false);
        scenarios.push(publicClimateScenario(record, climateCollectionId));
      } catch (error) {
        if (error instanceof InputAssetRegistrationError && error.reason === "deleted") continue;
        throw error;
      }
    }
    return c.json({ scenarios });
  } catch (e) {
    if (e instanceof ClimateManifestContractError || e instanceof InputAssetRegistrationError) {
      return c.json({ error: e.message, code: "CLIMATE_MANIFEST_UNAVAILABLE" }, 502);
    }
    console.warn("[climate]", e instanceof Error ? e.message : String(e));
    return c.json({
      error: "Plumber unavailable",
      code: "PLUMBER_UNAVAILABLE",
      message: e instanceof Error ? e.message : String(e),
    }, 502);
  }
});

climateRoutes.get("/check", async (c) => {
  try {
    const source = c.req.query("source") || "worldclim";
    const resolution = c.req.query("resolution") || c.req.query("res") || "10";
    const biovars = c.req.query("biovars") || "";
    const gcm = c.req.query("gcm") || "";
    const ssp = c.req.query("ssp") || "";
    const period = c.req.query("period") || "";

    const result = await plumberClient.getClimateCheck({ source, resolution, biovars, gcm, ssp, period });
    return c.json(result);
  } catch (e) {
    console.warn("[climate]", e instanceof Error ? e.message : String(e));
    return c.json({
      error: "Plumber unavailable",
      code: "PLUMBER_UNAVAILABLE",
      message: e instanceof Error ? e.message : String(e),
    }, 502);
  }
});

climateRoutes.post("/download", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const type = (body.type as string) || "cmip6";
    const user = c.get("user");
    if (containsClimatePathAlias(body)) {
      return c.json({ error: "Climate paths and file lists are not accepted; use an opaque climate collection ID" }, 400);
    }

    if (!["cmip6", "cmip6_average", "worldclim", "chelsa"].includes(type)) {
      return c.json({ error: "Invalid download type. Must be: cmip6, cmip6_average, worldclim, chelsa" }, 400);
    }

    // Validate resolution per type
    const res = body.res !== undefined ? Number(body.res) : undefined;
    const validResolutions: Record<string, number[]> = {
      worldclim: [2.5, 5, 10],
      chelsa: [0.5],
      cmip6: [2.5, 5, 10],
      cmip6_average: [2.5, 5, 10],
    };
    if (res !== undefined && !validResolutions[type]?.includes(res)) {
      return c.json({
        error: `Invalid resolution '${body.res}' for type '${type}'. Valid: ${validResolutions[type].join(", ")}`,
      }, 400);
    }

    if (type === "cmip6_average" && (!Array.isArray(body.gcm_list) || body.gcm_list.length < 2)) {
      return c.json({ error: "Multi-GCM averaging requires at least 2 GCMs in gcm_list" }, 400);
    }

    const plumberData = await plumberClient.withUser(user.id).withRole(user.role).downloadClimate(body as Record<string, unknown>);

    const client = extractClientInfo(c);
    await logAction({
      userId: user.id,
      action: "climate_download_started",
      entity: "climate",
      entityId: (plumberData as Record<string, unknown>).job_id as string ?? null,
      ...client,
      details: { type: body.type, resolution: body.res, source: body.source },
    });

    const response = plumberData as ClimateRecord;
    if (response.status === "completed") {
      try {
        const climateCollectionId = await registerCompletedClimateCollection(response, user, true);
        return c.json({ jobId: response.job_id, status: "completed", climateCollectionId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Climate manifest registration failed";
        return c.json({ error: message, code: "CLIMATE_MANIFEST_UNAVAILABLE" }, 502);
      }
    }
    return c.json({ jobId: response.job_id, status: response.status === "failed" ? "failed" : "queued" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Climate download failed";
    return c.json({ error: message }, 502);
  }
});

climateRoutes.post("/delete/:climateCollectionId", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "Climate collection not found" }, 404);

  const climateCollectionId = c.req.param("climateCollectionId");
  const resolved = await resolveInputAsset({
    assetId: climateCollectionId,
    principal: { id: user.id, role: user.role },
    action: "read",
    expectedKind: "climate_collection",
  });
  if (!resolved.ok || resolved.asset.scope !== "system") {
    return c.json({ error: "Climate collection not found" }, 404);
  }
  const updated = await updateInputAssetState(climateCollectionId, "deleted");
  if (!updated) return c.json({ error: "Climate collection lifecycle update failed" }, 503);

  await logAction({
    userId: user.id,
    action: "climate_collection_deleted",
    entity: "input_asset",
    entityId: climateCollectionId,
    ...extractClientInfo(c),
  });
  return c.json({ ok: true, climateCollectionId, state: "deleted" });
});

// Climate cancel is handled by the /api/v1/downloads/cancel/:jobId dispatch route,
// which routes climate_ ids to Plumber /api/v1/climate/cancel/<id> and other prefixes
// (cov_, data-) to /api/v1/jobs/cancel/<id>. The legacy /api/v1/climate/cancel/:jobId
// route has been removed because its ownership check queried the `runs` table, which
// never holds climate jobs, leaving any authenticated user able to cancel any job.

// Climate status remains here for backward compatibility but new code should use
// /api/v1/downloads/status/:jobId for prefix-aware dispatch.
climateRoutes.get("/status/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const user = c.get("user");
    const result = await plumberClient.withUser(user.id).withRole(user.role).getClimateStatus(jobId);
    if (result.status === "completed") {
      const climateCollectionId = await registerCompletedClimateCollection(result, user, true);
      return c.json(publicClimateStatus(result, climateCollectionId));
    }
    return c.json(publicClimateStatus(result));
  } catch (error) {
    if (error instanceof ClimateManifestContractError || error instanceof InputAssetRegistrationError) {
      return c.json({ error: error.message, code: "CLIMATE_MANIFEST_UNAVAILABLE" }, 502);
    }
    return c.json({ status: "unknown" }, 502);
  }
});
