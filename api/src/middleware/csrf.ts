import { createMiddleware } from "hono/factory";
import { createHash, timingSafeEqual } from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getKnownOrigins(): string[] {
  const raw = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function getCsrfSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.CSRF_SECRET;
  if (!secret) {
    throw new Error("CSRF secret not configured — set JWT_SECRET or CSRF_SECRET");
  }
  return secret;
}

function validateToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const payload = parts[0];
  const expectedSig = createHash("sha256").update(payload + getCsrfSecret()).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

export const csrfMiddleware = createMiddleware(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  if (c.req.header("X-API-Key")) {
    await next();
    return;
  }

  const origin = c.req.header("Origin");
  const referer = c.req.header("Referer");
  const host = c.req.header("Host") || c.req.header("x-forwarded-host");

  if (!origin && !referer) {
    return c.json({ error: "CSRF validation failed: missing Origin/Referer" }, 403);
  }

  // Allow known frontend origins (handles SSH tunnel / proxy scenarios)
  if (origin) {
    const knownOrigins = getKnownOrigins().map(o => new URL(o).host);
    try {
      const originHost = new URL(origin).host;
      if (knownOrigins.includes(originHost)) {
        await next();
        return;
      }
    } catch {
      return c.json({ error: "CSRF validation failed: invalid Origin" }, 403);
    }
  }

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (host && originHost !== host) {
        return c.json({ error: "CSRF validation failed: Origin mismatch" }, 403);
      }
    } catch {
      return c.json({ error: "CSRF validation failed: invalid Origin" }, 403);
    }
  } else if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (host && refererHost !== host) {
        return c.json({ error: "CSRF validation failed: Referer mismatch" }, 403);
      }
    } catch {
      return c.json({ error: "CSRF validation failed: invalid Referer" }, 403);
    }
  }

  // Validate X-CSRF-Token when present (defense-in-depth)
  const token = c.req.header("X-CSRF-Token");
  if (token && !validateToken(token)) {
    return c.json({ error: "CSRF validation failed: invalid token" }, 403);
  }

  await next();
});
