import { createMiddleware } from "hono/factory";
import { createHash, timingSafeEqual } from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getKnownOrigins(): string[] {
  const raw = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function getCsrfSecret(): string {
  return process.env.CSRF_SECRET || "";
}

function validateToken(token: string): boolean {
  const secret = getCsrfSecret();
  // If a token is supplied but the server has no secret configured, the
  // token cannot be valid. Reject rather than silently accept.
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const payload = parts[0];
  const expectedSig = createHash("sha256").update(payload + secret).digest("hex");
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
  const host = c.req.header("x-forwarded-host") || c.req.header("Host");

  if (!origin && !referer) {
    return c.json({ error: "CSRF validation failed: missing Origin/Referer" }, 403);
  }

  // Allow known frontend origins (handles SSH tunnel / proxy scenarios)
  if (origin) {
    let knownOrigins: string[];
    try {
      knownOrigins = getKnownOrigins().map(o => new URL(o).host);
    } catch {
      return c.json({ error: "CSRF validation failed: invalid origin configuration" }, 500);
    }
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
