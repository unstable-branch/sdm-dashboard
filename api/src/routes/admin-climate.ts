import { Hono, type Context } from "hono";
import { authMiddleware, requireRole, type AppEnv } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { extractClientInfo, logAction } from "../services/audit.js";
import {
  ClimateCollectionError,
  getAdminClimateCollection,
  listAdminClimateCollections,
  MAX_CLIMATE_COLLECTION_PAGE,
  publishClimateCollection,
} from "../services/climate-collections.js";

export const adminClimateRoutes = new Hono<AppEnv>();

adminClimateRoutes.use("*", authMiddleware);
adminClimateRoutes.use("*", requireRole(["admin"]));
adminClimateRoutes.use("*", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "admin-climate" }));

const collectionStates = ["staging", "ready", "quarantined", "deleted"] as const;
const collectionKinds = ["current_baseline", "future_scenario", "derived_future"] as const;

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined | null {
  if (value === undefined || value === "") return undefined;
  return allowed.includes(value as T) ? value as T : null;
}

function errorResponse(c: Context<AppEnv>, error: unknown) {
  if (error instanceof ClimateCollectionError) {
    const status = error.code === "invalid_request" ? 400
      : error.code === "not_found" ? 404
        : error.code === "forbidden" ? 403
          : error.code === "conflict" ? 409
            : 503;
    return c.json({ error: error.message, code: `CLIMATE_COLLECTION_${error.code.toUpperCase()}` }, status);
  }
  return c.json({ error: "Climate collection service unavailable", code: "CLIMATE_COLLECTION_UNAVAILABLE" }, 503);
}

adminClimateRoutes.get("/collections", async (c) => {
  const state = parseEnum(c.req.query("state"), collectionStates);
  const kind = parseEnum(c.req.query("kind"), collectionKinds);
  const page = Number(c.req.query("page") || "1");
  const limit = Number(c.req.query("limit") || "25");
  if (state === null || kind === null || !Number.isSafeInteger(page) || page < 1 || page > MAX_CLIMATE_COLLECTION_PAGE
    || !Number.isSafeInteger(limit) || limit < 1) {
    return c.json({ error: "Invalid climate collection filters", code: "CLIMATE_COLLECTION_INVALID_REQUEST" }, 400);
  }
  try {
    return c.json(await listAdminClimateCollections({ state, kind, page, limit }));
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminClimateRoutes.get("/collections/:id", async (c) => {
  try {
    const collection = await getAdminClimateCollection(c.req.param("id"));
    if (!collection) return c.json({ error: "Climate collection not found", code: "CLIMATE_COLLECTION_NOT_FOUND" }, 404);
    return c.json(collection);
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminClimateRoutes.post("/collections/:id/publish", async (c) => {
  try {
    const user = c.get("user");
    const published = await publishClimateCollection(c.req.param("id"), user.id);
    await logAction({
      userId: user.id,
      action: "climate_collection_published",
      entity: "climate_collection",
      entityId: published.id,
      ...extractClientInfo(c),
      details: { state: published.state, manifestSha256: published.manifestSha256 },
    });
    return c.json(published);
  } catch (error) {
    return errorResponse(c, error);
  }
});
