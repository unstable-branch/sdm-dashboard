import { Hono } from "hono";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { encryptString, decryptString, isEncryptionKeyConfigured } from "../services/encryption.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.use("*", authMiddleware);

settingsRoutes.get("/", async (c) => {
  const user = c.get("user");

  try {
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

    // Return boolean flags instead of plaintext passwords
    (settings as Record<string, unknown>).hasGbifPassword = !!settings.gbifPassword;
    (settings as Record<string, unknown>).gbifPassword = null;
    (settings as Record<string, unknown>).hasAlaApiKey = !!settings.alaApiKey;
    (settings as Record<string, unknown>).alaApiKey = null;

    return c.json(settings);
  } catch (err) {
    console.warn("[settings] Failed to load user settings:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Failed to load settings" }, 500);
  }
});

settingsRoutes.put("/", async (c) => {
  const user = c.get("user");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

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
    "alaApiKey",
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === "gbifPassword" || key === "alaApiKey") {
        if (body[key] === null) {
          updates[key] = null;
        } else if (body[key] !== "") {
          if (isEncryptionKeyConfigured()) {
            updates[key] = encryptString(String(body[key]));
          } else {
            return c.json({ error: "DATA_ENCRYPTION_KEY not configured. Cannot store credentials." }, 503);
          }
        }
      } else {
        updates[key] = body[key];
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  try {
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

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "setting_updated",
      entity: "user_settings",
      entityId: result?.id ?? null,
      ...client,
      details: { updatedKeys: Object.keys(updates) },
    });

    return c.json(result);
  } catch (err) {
    console.warn("[settings] Failed to update settings:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Failed to update settings" }, 500);
  }
});

settingsRoutes.delete("/", async (c) => {
  const user = c.get("user");

  try {
    await db
      .delete(userSettings)
      .where(eq(userSettings.userId, user.id));

    const [reset] = await db
      .insert(userSettings)
      .values({ userId: user.id })
      .returning();

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "setting_reset",
      entity: "user_settings",
      entityId: reset?.id ?? null,
      ...client,
    });

    return c.json(reset);
  } catch (err) {
    console.warn("[settings] Failed to reset settings:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Failed to reset settings" }, 500);
  }
});
