import { Hono } from "hono";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { encryptString, decryptString, isEncryptionKeyConfigured } from "../services/encryption.js";
import type { AppEnv } from "../middleware/auth.js";

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.use("*", authMiddleware);

settingsRoutes.get("/", async (c) => {
  const user = c.get("user");

  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);

  if (!settings) {
    const [created] = await db
      .insert(userSettings)
      .values({ userId: user.id })
      .returning();
    return c.json(created);
  }

  // Decrypt GBIF password for the response
  if (settings.gbifPassword && isEncryptionKeyConfigured()) {
    try {
      (settings as Record<string, unknown>).gbifPassword = decryptString(settings.gbifPassword);
    } catch {
      (settings as Record<string, unknown>).gbifPassword = null;
    }
  }

  return c.json(settings);
});

settingsRoutes.put("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const allowed = [
    "defaultModelId",
    "pinnedModelIds",
    "defaultBiovars",
    "defaultClimateSource",
    "defaultClimateRes",
    "defaultCvStrategy",
    "defaultCvK",
    "defaultBackgroundN",
    "defaultPaReplications",
    "theme",
    "tablePageSize",
    "compactMode",
    "gbifUsername",
    "gbifPassword",
    "gbifEmail",
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      // Encrypt GBIF password at rest
      if (key === "gbifPassword" && body[key] !== null && body[key] !== "") {
        if (isEncryptionKeyConfigured()) {
          updates[key] = encryptString(String(body[key]));
        }
      } else {
        updates[key] = body[key];
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const [existing] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);

  let result;
  if (existing) {
    [result] = await db
      .update(userSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id))
      .returning();
  } else {
    [result] = await db
      .insert(userSettings)
      .values({ userId: user.id, ...updates })
      .returning();
  }

  return c.json(result);
});

settingsRoutes.delete("/", async (c) => {
  const user = c.get("user");

  await db
    .delete(userSettings)
    .where(eq(userSettings.userId, user.id));

  const [reset] = await db
    .insert(userSettings)
    .values({ userId: user.id })
    .returning();

  return c.json(reset);
});
