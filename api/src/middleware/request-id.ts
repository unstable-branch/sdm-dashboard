import { createMiddleware } from "hono/factory";
import { randomUUID } from "crypto";
import type { AppEnv } from "./auth.js";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._\-]{8,128}$/;

// Sets a per-request UUID (or echoes a caller-provided value) so audit logs,
// structured logs, and downstream calls can be correlated. Without this
// middleware the audit_logs.requestId column was always null.
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const id = incoming && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  await next();
});
