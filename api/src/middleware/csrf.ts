import { createMiddleware } from "hono/factory";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

  const token = c.req.header("X-CSRF-Token");
  if (!token) {
    return c.json({ error: "CSRF validation failed: missing token" }, 403);
  }

  await next();
});
