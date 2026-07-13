import { createMiddleware } from "hono/factory";

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("X-XSS-Protection", "1; mode=block");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});
